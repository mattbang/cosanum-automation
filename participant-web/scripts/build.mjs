import { mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'dist');
const assets = ['index.html', 'config.js', 'core.js', 'app.js', 'styles.css'];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of assets) await copyFile(join(root, asset), join(output, asset));
console.log(`Built ${assets.length} static participant assets into dist/`);
