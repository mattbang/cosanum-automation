#!/usr/bin/env node
// Check the real dev command through an address that a container port forwarder can reach.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

const address = Object.values(networkInterfaces()).flat()
  .find(entry => entry?.family === 'IPv4' && !entry.internal)?.address;
if (!address) throw new Error('No non-loopback IPv4 interface is available for the container preview smoke check.');

const child = spawn(process.execPath, ['scripts/local_preview.mjs'], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT: '0', PREVIEW_HOST: '0.0.0.0' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let errorOutput = '';
child.stderr.setEncoding('utf8').on('data', chunk => { errorOutput += chunk.slice(0, 2000); });

try {
  const port = await new Promise((resolvePort, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Preview did not announce its port within 10 seconds.')), 10000);
    const finish = result => { clearTimeout(timeout); result(); };
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
      const match = output.match(/Offline preview: http:\/\/localhost:(\d+)\//);
      if (match) finish(() => resolvePort(Number(match[1])));
    });
    child.once('error', error => finish(() => reject(error)));
    child.once('exit', code => finish(() => reject(new Error(`Preview exited before startup (code ${code}): ${errorOutput}`))));
  });
  const origin = `http://${address}:${port}`;
  const page = await fetch(`${origin}/`, { signal: AbortSignal.timeout(10000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /OFFLINE PREVIEW · SYNTHETIC DATA · READ ONLY/);
  assert.equal((await fetch(`${origin}/.clasp.json`, { signal: AbortSignal.timeout(10000) })).status, 404);
  console.log('PASS dev command serves the read-only preview on the container network interface');
} finally {
  child.kill();
}
