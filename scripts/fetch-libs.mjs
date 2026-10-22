import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libs = path.join(root, 'companion', 'neoforge-1.21.1', 'libs');
const props = Object.fromEntries(
  fs
    .readFileSync(path.join(root, 'companion', 'neoforge-1.21.1', 'gradle.properties'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const createJar = path.join(libs, `create-1.21.1-${props.create_version}.jar`);

if (!fs.existsSync(createJar)) {
  const res = await fetch(`https://api.modrinth.com/v2/project/create/version?loaders=%5B%22neoforge%22%5D&game_versions=%5B%221.21.1%22%5D`, { headers: { 'User-Agent': 'ponder-studio-build' } });
  const versions = await res.json();
  const v = versions.find((x) => x.version_number.replace(/^mc1\.21\.1-/, '').split('+')[0] === props.create_version);
  if (!v) throw new Error(`Create ${props.create_version} for NeoForge 1.21.1 is not on Modrinth`);
  const file = v.files.find((f) => f.primary) ?? v.files[0];
  const bytes = Buffer.from(await (await fetch(file.url, { headers: { 'User-Agent': 'ponder-studio-build' } })).arrayBuffer());
  if (crypto.createHash('sha512').update(bytes).digest('hex') !== file.hashes.sha512) throw new Error('Create download failed its SHA-512 check');
  fs.mkdirSync(libs, { recursive: true });
  fs.writeFileSync(createJar, bytes);
  console.log(`Downloaded ${file.filename}`);
}

const nested = unzipSync(fs.readFileSync(createJar), { filter: (f) => f.name.startsWith('META-INF/jarjar/') && f.name.endsWith('.jar') });
for (const [name, bytes] of Object.entries(nested)) {
  const base = path.basename(name);
  if (!/^(ponder|flywheel)-neoforge/.test(base)) continue;
  fs.writeFileSync(path.join(libs, base), bytes);
  console.log(`Extracted ${base}`);
}
