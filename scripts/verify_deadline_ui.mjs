// Optional local Chrome check. Uses a fresh profile and the read-only synthetic preview.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPreviewServer } from './local_preview.mjs';

const executable = process.env.COSANUM_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'training-deadline-ui-'));
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let chrome, socket;
try {
  chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
  let launchError;
  chrome.on('error', error => { launchError = error; });
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert(port, 'Chrome must expose its isolated debugging port');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    clearTimeout(waiting.timeout); pending.delete(message.id);
    if (message.error) waiting.reject(Error(message.error.message)); else waiting.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error('Chrome timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
    throw Error('UI condition did not become true: ' + expression);
  }
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await until("document.querySelector('#loginButton') && !document.querySelector('#loginButton').disabled");
  await evaluate("document.querySelector('#loginButton').click()");
  await until("document.querySelector('#deadlineQueue button')");
  assert.equal(await evaluate("document.querySelectorAll('#deadlineQueue article').length"), 1);
  assert.match(await evaluate("document.querySelector('#deadlineQueue').textContent"), /3 Kalendertage überfällig/);
  await evaluate("document.querySelector('#auditSearch').value='unrelated old search';document.querySelector('#deadlineQueue button').click()");
  assert.equal(await evaluate("document.querySelector('#auditSearch').value"), 'SAMPLE-EXCEPTION-P01');
  assert.equal(await evaluate("document.querySelector('#auditState').value"), 'all');
  assert.equal(await evaluate("document.querySelectorAll('#auditRows details').length"), 1);
  assert.equal(await evaluate("document.querySelector('#auditRows details').open"), true);
  assert.match(await evaluate("document.querySelector('#auditRows').textContent"), /3 Kalendertage überfällig/);
  await evaluate("document.querySelector('[data-view=hub]').click()");
  await evaluate("document.querySelector('#deadlineScope').value='SAMPLE-EXCEPTION-P01';document.querySelector('#deadlineScope').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#deadlineApprovalRow').hidden"), false);
  assert.match(await evaluate("document.querySelector('#deadlineHistory').textContent"), /DEMO-ONBOARDING@1/);
  await evaluate("document.querySelector('#deadlineReason').value='Synthetic blocked write check';document.querySelector('#deadlinePolicyApproved').checked=true;document.querySelector('#deadlineSave').click()");
  await until("document.querySelector('#deadlineStatus').textContent.includes('blocked saveRequestDeadline')");
  assert.equal(await evaluate("document.querySelectorAll('#deadlineQueue article').length"), 1);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(tmpdir(), 'training-deadline-desktop.png');
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'deadline controls must not overflow at width ' + width);
  }
  assert.deepEqual(errors, [], 'owner app must render without uncaught browser exceptions');
  console.log('PASS deadline queue, exact-case navigation, source history, blocked preview save and 1440/390px layouts. Screenshot: ' + path);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const stopped = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM'); await stopped;
  }
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
