// OPTIONAL, UNTESTED SKELETON of the repository interface on Firestore (see docs/GOOGLE_CLOUD.md).
// It was written against the documented client API but has never been run against Firestore or the
// emulator in this repository. Treat it as a starting point, not a verified adapter.
// Requires: npm i @google-cloud/firestore   (not a dependency of this project)
// Uses Application Default Credentials only; no keys are read from or written to the repo.
import { clone } from '../engine/util.js';
import { COLLECTIONS } from './store.js';

export async function createFirestoreStore({ prefix = process.env.PILOT_FIRESTORE_PREFIX || 'pilot_', projectId } = {}) {
  let Firestore;
  try { ({ Firestore } = await import('@google-cloud/firestore')); } catch { throw new Error('PILOT_STORE=firestore needs "npm i @google-cloud/firestore" (optional dependency).'); }
  const db = new Firestore(projectId ? { projectId } : {});
  const col = (name) => db.collection(`${prefix}${name}`);
  return {
    async get(name, id) { const s = await col(name).doc(id).get(); return s.exists ? s.data() : null; },
    async put(name, doc) { await col(name).doc(doc.id).set(clone(doc)); return doc; },
    async delete(name, id) { await col(name).doc(id).delete(); },
    // NOTE: loads whole collections; fine at pilot scale, replace with queries/indexes before growing.
    async list(name, filter) { const snap = await col(name).get(); const all = snap.docs.map((d) => d.data()); return filter ? all.filter(filter) : all; },
    async count(name) { const snap = await col(name).count().get(); return snap.data().count; },
    async clear() { for (const c of COLLECTIONS) { const snap = await col(c).get(); await Promise.all(snap.docs.map((d) => d.ref.delete())); } },
  };
}
