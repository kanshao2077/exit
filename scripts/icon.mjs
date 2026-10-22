import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  // The bundled Codex Node runtime supplies sharp alongside its executable.
  sharp = require(resolve(dirname(process.execPath), '../node_modules/sharp'));
}

const icons = fileURLToPath(new URL('../public/icons/', import.meta.url));
const source = fileURLToPath(new URL('../docs/icon-source.png', import.meta.url));
const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = info.width;
let minY = info.height;
let maxX = -1;
let maxY = -1;

// Find the supplied black E and orange dot, ignoring its textured white margins.
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    if (Math.min(data[i], data[i + 1], data[i + 2]) < 160) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

if (maxX < minX || maxY < minY) throw new Error('Icon source has no visible artwork.');
const size = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 1.14);
const left = Math.max(0, Math.min(info.width - size, Math.round((minX + maxX + 1 - size) / 2)));
const top = Math.max(0, Math.min(info.height - size, Math.round((minY + maxY + 1 - size) / 2)));

for (const target of [16, 32, 48, 128]) {
  await sharp(source)
    .extract({ left, top, width: size, height: size })
    .resize(target, target, { kernel: 'lanczos3' })
    .png()
    .toFile(resolve(icons, `icon${target}.png`));
}

console.log(`Generated 16/32/48/128 px icons from source.png (crop ${left},${top},${size},${size}).`);
