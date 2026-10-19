// Generates the synthetic sample workbooks in ./samples plus MANIFEST.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSamples } from '../server/xlsx/samples.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
fs.mkdirSync(dir, { recursive: true });
const samples = await buildSamples();
const manifest = {};
for (const [file, { buffer, description, expect }] of samples) {
  fs.writeFileSync(path.join(dir, file), buffer);
  manifest[file] = { description, expect };
}
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${samples.size} sample workbooks to ${dir}`);
