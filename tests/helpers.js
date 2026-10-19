import { MemoryStore } from '../server/store/store.js';
import { MemoryBlobStore } from '../server/store/blobs.js';
import { createContext } from '../server/context.js';
import { createApp } from '../server/app.js';
import { Auth } from '../server/auth.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXED_NOW = new Date('2026-10-18T12:00:00Z');
export const PASSWORD = 'test-password-123';
export const CLIENT_PASSWORD = 'test-client-456';

/** Fresh seeded in-memory context. `now` is mutable through ctx.setNow for time-dependent tests. */
export async function makeContext({ now = FIXED_NOW } = {}) {
  let current = now;
  const store = new MemoryStore();
  const clock = () => new Date(current);
  const ctx = await createContext({ store, blobs: new MemoryBlobStore(), clock, seed: true, samplesDir: path.join(ROOT, 'samples') });
  ctx.setNow = (d) => { current = new Date(d); };
  return ctx;
}

export const actors = {
  agent: { id: 'agent.demo', role: 'agent' },
  analyst: { id: 'analyst.demo', role: 'pricing_analyst' },
  approver: { id: 'approver.demo', role: 'pricing_approver' },
  admin: { id: 'admin.demo', role: 'admin' },
  client: { id: 'rateguard.client', role: 'api_client' },
};

/** Boots the real Express app on an ephemeral port with a seeded in-memory store. */
export async function startServer() {
  const ctx = await makeContext();
  const auth = new Auth({ mode: 'demo', secret: 'test-secret', password: PASSWORD, clientPassword: CLIENT_PASSWORD, clock: ctx.clock });
  const app = createApp(ctx, auth, {});
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokens = {};
  async function request(method, url, { user, body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (user) {
      if (!tokens[user]) {
        const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: user === 'rateguard.client' ? CLIENT_PASSWORD : PASSWORD }) });
        tokens[user] = (await r.json()).token;
      }
      h.authorization = `Bearer ${tokens[user]}`;
    }
    if (body !== undefined && !raw) h['content-type'] = 'application/json';
    const res = await fetch(`${base}${url}`, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return { ctx, auth, app, server, base, request, close: () => new Promise((r) => server.close(r)) };
}
