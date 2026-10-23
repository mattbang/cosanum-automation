import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(resolve(root, 'data/demo_fixture.json'), 'utf8'));
const output = `// Generated from ignored data/demo_fixture.json. Keep this file out of Git.\nfunction getPrivateFixture_() {\n  return ${JSON.stringify(fixture, null, 2)};\n}\n`;
writeFileSync(resolve(root, 'apps-script/PrivateFixture.gs'), output);
console.log('Wrote ignored apps-script/PrivateFixture.gs');
