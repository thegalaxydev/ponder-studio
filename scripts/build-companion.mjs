import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'companion', 'neoforge-1.21.1');

function findJdk(min) {
  const roots = ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu', '/usr/lib/jvm'];
  const homes = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);
  for (const r of roots) if (fs.existsSync(r)) for (const d of fs.readdirSync(r)) homes.push(path.join(r, d));
  for (const h of homes) {
    const rel = path.join(h, 'release');
    if (!fs.existsSync(path.join(h, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')) || !fs.existsSync(rel)) continue;
    const m = fs.readFileSync(rel, 'utf8').match(/JAVA_VERSION="(\d+)/);
    if (m && Number(m[1]) >= min) return h;
  }
  return null;
}

const jdk = findJdk(21);
if (!jdk) {
  console.error('No JDK 21 or newer found');
  process.exit(1);
}
const java = path.join(jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const res = spawnSync(java, ['-classpath', path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--console=plain', 'build'], { cwd: dir, stdio: 'inherit', env: { ...process.env, JAVA_HOME: jdk } });
if (res.status !== 0) process.exit(res.status ?? 1);
const version = fs.readFileSync(path.join(dir, 'gradle.properties'), 'utf8').match(/^version=(.+)$/m)[1].trim();
const built = path.join(dir, 'build', 'libs', `ponder-studio-companion-neoforge-1.21.1-${version}.jar`);
const out = path.join(root, 'extension', 'mods');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(built, path.join(out, 'ponder-studio-companion-neoforge-1.21.1.jar'));
console.log(`companion -> ${path.join(out, 'ponder-studio-companion-neoforge-1.21.1.jar')}`);
