import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'extension.json'), 'utf8'));
const min = process.argv.find((a) => a.startsWith('--modsmith='))?.split('=')[1];
if (min) manifest.modsmith = min;
for (const f of [manifest.main, manifest.style, ...manifest.contributes.mods.map((m) => m.file)]) {
  if (!fs.existsSync(path.join(ext, f))) throw new Error(`${f} is missing; run npm run build:web and npm run build:companion first`);
}
const files = {};
const walk = (dir) => {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files[path.relative(ext, full).replace(/\\/g, '/')] = new Uint8Array(fs.readFileSync(full));
  }
};
walk(ext);
files['extension.json'] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
const bytes = zipSync(files, { level: 9, mtime: new Date('2026-01-01T00:00:00Z') });
const out = path.join(root, 'dist', `${manifest.id}-${manifest.version}${min ? `-modsmith${min}` : ''}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);
console.log(`${out}\n  ${bytes.length} bytes\n  sha256 ${crypto.createHash('sha256').update(bytes).digest('hex')}`);
