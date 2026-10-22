import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const packages = ['react', 'react-dom', 'zod'];
const scheduler = createRequire(require.resolve('react-dom')).resolve('scheduler/package.json');
const paths = packages.map(p => require.resolve(`${p}/package.json`)).concat(scheduler);
let output = 'EXIT. runtime dependency notices\n\n';
for (const file of paths) {
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  const base = path.dirname(file); let license;
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) { try { license = await readFile(path.join(base, name), 'utf8'); break; } catch { /* Try standard license filename. */ } }
  if (!license) throw new Error(`Missing license for ${pkg.name}`);
  output += `${pkg.name} ${pkg.version}\n${license}\n\n`;
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt', output);
