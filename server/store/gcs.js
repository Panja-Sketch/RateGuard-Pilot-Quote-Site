// OPTIONAL, UNTESTED SKELETON of the blob store on Cloud Storage (see docs/GOOGLE_CLOUD.md).
// Requires: npm i @google-cloud/storage   (not a dependency of this project). ADC only; no keys.
export async function createGcsBlobStore({ bucket = process.env.PILOT_GCS_BUCKET } = {}) {
  if (!bucket) throw new Error('PILOT_BLOBS=gcs needs PILOT_GCS_BUCKET.');
  let Storage;
  try { ({ Storage } = await import('@google-cloud/storage')); } catch { throw new Error('PILOT_BLOBS=gcs needs "npm i @google-cloud/storage" (optional dependency).'); }
  const b = new Storage().bucket(bucket);
  const name = (key) => { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid blob key'); return `workbooks/${key}.xlsx`; };
  return {
    async put(key, buf) { await b.file(name(key)).save(buf, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', resumable: false }); },
    async get(key) { const f = b.file(name(key)); const [exists] = await f.exists(); return exists ? (await f.download())[0] : null; },
  };
}
