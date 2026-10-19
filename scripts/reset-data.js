// Deletes ./data (local synthetic store, uploaded workbooks, auth secret). The next start re-seeds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.PILOT_DATA_DIR || path.join(root, 'data'));
if (path.basename(dir) !== 'data' && !process.env.PILOT_DATA_DIR) throw new Error('Refusing to delete an unexpected directory');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. The next "npm start" will re-seed synthetic data.`);
