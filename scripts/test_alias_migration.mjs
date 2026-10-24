import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(fs.readFileSync('fixtures/synthetic_demo.json', 'utf8'));
const oldHeaders = ['person_key','email','demo_role','demo_marker'];
const data = [oldHeaders.concat(['','']), ...fixture.People.map(row => row.slice(0, 4).concat(['','']))];
const original = data.map(row => row.slice(0, 4));
let writes = 0;
const sheet = {
  getLastRow: () => data.length,
  getRange: (row, col, height = 1, width = 1) => ({
    getValues: () => data.slice(row - 1, row - 1 + height).map(r => r.slice(col - 1, col - 1 + width)),
    setValues: values => { writes++; values.forEach((v, i) => v.forEach((x, j) => { data[row - 1 + i][col - 1 + j] = x; })); return this; },
    setBackground: () => ({ setFontColor: () => ({ setFontWeight: () => {} }) })
  }),
  autoResizeColumns: () => {}
};
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync('apps-script/Schema.gs', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('apps-script/Setup.gs', 'utf8'), ctx);
const book = { getSheetByName: name => name === 'People' ? sheet : null };
ctx.migrateDemoSchemaV2ToV3_(book, fixture);
assert.deepEqual(data.map(row => row.slice(0, 4)), original);
assert.deepEqual(data[0].slice(4), ['persona_id','display_alias']);
assert.deepEqual(data.slice(1).map(row => row.slice(4)), fixture.People.map(row => row.slice(4)));
const firstWrites = writes;
ctx.migrateDemoSchemaV2ToV3_(book, fixture);
assert.equal(writes, firstWrites);
console.log('Pass: v2 People rows migrate to aliases without changing existing fields; rerun is inert.');
