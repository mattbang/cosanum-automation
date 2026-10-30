const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const source = path.resolve(__dirname, '../src/deepLink.ts');
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = new Module(source, module);
compiled.filename = source;
compiled.paths = Module._nodeModulePaths(path.dirname(source));
compiled._compile(js, source);
const { participantCaseFromLink, participantDemoLink } = compiled.exports;

test('standalone participant links select only a syntactic local demo case', () => {
  assert.equal(participantDemoLink('CASE-S-1'), 'cosanum-training-demo://participant/CASE-S-1');
  assert.equal(participantCaseFromLink(participantDemoLink('CASE-M-1-2')), 'CASE-M-1-2');
  assert.equal(participantCaseFromLink('https://example.com/participant/CASE-S-1'), null);
  assert.equal(participantCaseFromLink('cosanum-training-demo://participant/../../CASE-S-1'), null);
  assert.equal(participantCaseFromLink('cosanum-training-demo://participant/CASE-S-1?token=bad'), null);
  assert.throws(() => participantDemoLink('CASE-S-1?token=bad'));
});
