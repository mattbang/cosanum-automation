#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { projectMaterialCatalogue, findMaterialRevision, readPublishedRegister } from './register.mjs';
import { previewImport, stageImport } from './review.mjs';
import { demoPublishedPath, demoSources, resolveDemoFile } from './demo.mjs';

const maxBytes = 8 * 1024 * 1024;
const fromHere = path => fileURLToPath(new URL(path, import.meta.url));
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const usage = `Synthetic material register:
  node material-register/cli.mjs preview <edits.xlsx> [--published <snapshot.json>]
  node material-register/cli.mjs stage <edits.xlsx> --review <id> --reviewer <name> --out <batch.json> [--published <snapshot.json>]
  node material-register/cli.mjs catalogue --as-of YYYY-MM-DD [--published <snapshot.json>]
  node material-register/cli.mjs history <material_id> <revision> [--published <snapshot.json>]`;

function boundedFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('Input must be a local file of at most 8 MiB.');
  const bytes = readFileSync(path);
  if (bytes.length > maxBytes) throw new Error('Input exceeds 8 MiB.');
  return bytes;
}

function readWorkbook(path) {
  if (!/\.xlsx$/i.test(path)) throw new Error('Provide an .xlsx workbook.');
  const input = boundedFile(path);
  const programs = process.platform === 'win32' ? [['py', '-3'], ['python']] : [['python3'], ['python']];
  for (const [command, ...args] of programs) {
    const result = spawnSync(command, [...args, fromHere('read_xlsx.py')], {
      input, encoding: 'utf8', timeout: 15_000, maxBuffer: maxBytes,
    });
    if (result.error?.code === 'ENOENT') continue;
    if (result.status !== 0) throw new Error('The Excel reader did not complete.');
    return JSON.parse(result.stdout);
  }
  throw new Error('Python 3.11 or newer is required to read Excel.');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') {
    console.log(usage);
    process.exit(0);
  }
  const options = { published: { type: 'string' } };
  if (command === 'stage') {
    for (const key of ['review', 'reviewer', 'out']) options[key] = { type: 'string' };
  } else if (command === 'catalogue') {
    options['as-of'] = { type: 'string' };
  }
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true });
  const document = JSON.parse(boundedFile(values.published || demoPublishedPath));
  const published = document.snapshot ?? document;
  const { topicIds } = demoSources;

  if (command === 'preview' && positionals.length === 1) {
    const review = previewImport(readWorkbook(positionals[0]), published, topicIds, resolveDemoFile);
    print(review);
    if (review.errors.length) process.exitCode = 2;
  } else if (command === 'stage' && positionals.length === 1 && values.review && values.reviewer && values.out) {
    const batch = stageImport(readWorkbook(positionals[0]), published, topicIds, resolveDemoFile, {
      reviewId: values.review, reviewer: values.reviewer,
    });
    if (batch.appended.length) {
      writeFileSync(values.out, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    print({ batchId: batch.batchId, appendedRows: batch.appended.length, output: batch.appended.length ? values.out : null });
  } else if ((command === 'catalogue' && !positionals.length && values['as-of']) || (command === 'history' && positionals.length === 2)) {
    const read = readPublishedRegister(published, topicIds);
    if (read.errors.length) {
      print({ errors: read.errors });
      process.exitCode = 2;
    } else if (command === 'history') {
      print(findMaterialRevision(read.events, ...positionals));
    } else {
      print(projectMaterialCatalogue(read.events, values['as-of'], resolveDemoFile));
    }
  } else {
    throw new Error(usage);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
