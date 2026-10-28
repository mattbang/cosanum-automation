import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = await readFile(join(root, 'index.html'), 'utf8');
const app = await readFile(join(root, 'app.js'), 'utf8');
const core = await readFile(join(root, 'core.js'), 'utf8');
const config = await readFile(join(root, 'config.js'), 'utf8');
for (const required of ['id="notice"', 'id="error"', 'id="case-view"', 'id="complete-action"', 'aria-live="polite"']) {
  if (!html.includes(required)) throw new Error(`Static page is missing required accessible state: ${required}`);
}
if (!html.includes('type="module" src="./app.js"') || !html.includes('href="./styles.css"')) throw new Error('Static page asset references are incomplete.');
if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(`${app}\n${core}`)) throw new Error('Participant view must not use browser storage.');
if (!/apiOrigin:\s*''/.test(config) || !/googleClientId:\s*''/.test(config)) throw new Error('Unconfigured identity and API settings must remain fail-closed.');
console.log('Static participant page references, accessible status regions, storage boundary, and fail-closed defaults are valid.');
