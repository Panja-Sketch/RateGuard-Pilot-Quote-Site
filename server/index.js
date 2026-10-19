// Local / Cloud Run entry point.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FileStore, MemoryStore } from './store/store.js';
import { FileBlobStore, MemoryBlobStore } from './store/blobs.js';
import { createContext } from './context.js';
import { createApp, ROOT } from './app.js';
import { Auth } from './auth.js';

const env = process.env;
const dataDir = path.resolve(env.PILOT_DATA_DIR || path.join(ROOT, 'data'));
const useMemory = env.PILOT_STORE === 'memory';
const useFirestore = env.PILOT_STORE === 'firestore';

function loadSecret() {
  if (env.PILOT_AUTH_SECRET) return env.PILOT_AUTH_SECRET;
  if (useMemory || useFirestore) return crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  const f = path.join(dataDir, '.auth-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

// Optional cloud adapters are loaded lazily and are UNTESTED skeletons (docs/GOOGLE_CLOUD.md).
const store = useFirestore ? await (await import('./store/firestore.js')).createFirestoreStore() : useMemory ? new MemoryStore() : new FileStore(path.join(dataDir, 'pilot-store.json'));
const blobs = env.PILOT_BLOBS === 'gcs' ? await (await import('./store/gcs.js')).createGcsBlobStore() : useMemory ? new MemoryBlobStore() : new FileBlobStore(path.join(dataDir, 'blobs'));
const ctx = await createContext({ store, blobs, samplesDir: path.join(ROOT, 'samples'), seed: true });
const auth = new Auth({ mode: env.AUTH_MODE || 'demo', secret: loadSecret(), password: env.PILOT_DEMO_PASSWORD, clientPassword: env.PILOT_API_CLIENT_PASSWORD });
const app = createApp(ctx, auth, { corsOrigins: (env.PILOT_CORS_ORIGINS || '').split(',').map((s) => s.trim()), trustProxy: env.K_SERVICE !== undefined });

const port = Number(env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`\nRateGuard Pilot Quote Site (SYNTHETIC) listening on http://localhost:${port}`);
  console.log(`  store: ${useFirestore ? 'firestore (untested skeleton)' : useMemory ? 'memory (ephemeral)' : dataDir}   auth: ${auth.mode}`);
  if (auth.mode === 'demo') console.log(`  demo users: agent.demo, analyst.demo, approver.demo, admin.demo, rateguard.client${auth.usingDefaultPassword ? '  (default demo password – see README)' : ''}`);
});
const shutdown = () => { try { store.flush?.(); } catch { /* ignore */ } server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
