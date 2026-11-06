import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = await readFile(join(root, 'index.html'), 'utf8');
const app = await readFile(join(root, 'app.js'), 'utf8');
const core = await readFile(join(root, 'core.js'), 'utf8');
const config = await readFile(join(root, 'config.js'), 'utf8');
for (const required of ['id="notice"', 'id="error"', 'id="case-view"', 'id="participant-response"', 'id="answer-yes"', 'id="typed-name"', 'id="refresh-case"', 'aria-live="polite"']) {
  if (!html.includes(required)) throw new Error(`Static page is missing required accessible state: ${required}`);
}
if (!html.includes('type="module" src="./app.js"') || !html.includes('href="./styles.css"')) throw new Error('Static page asset references are incomplete.');
if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(`${app}\n${core}`)) throw new Error('Participant view must not use browser storage.');
if (!/apiOrigin:\s*''/.test(config) || !/googleClientId:\s*''/.test(config)) throw new Error('Unconfigured identity and API settings must remain fail-closed.');
if (!app.includes("'/participant-responses'") || !app.includes("window.history.replaceState")) throw new Error('Participant response route or immediate invitation cleanup is missing.');
if (app.indexOf('window.history.replaceState') > app.indexOf('readConfig(configValue)')) throw new Error('Invitation secrets must be removed before configuration checks.');
if (!app.includes('MAX_RESPONSE_ATTEMPTS = 3') || !app.includes('canRetryParticipantResponse(error, responseAttemptCount, MAX_RESPONSE_ATTEMPTS)') || !core.includes('attemptCount < maxAttempts')) throw new Error('Response retries must remain bounded.');
console.log('Static participant page references, accessible states, fragment cleanup, storage boundary, and fail-closed defaults are valid.');

const memberHtml = await readFile(join(root, 'member/index.html'), 'utf8');
const memberApp = await readFile(join(root, 'member/app.js'), 'utf8');
const memberCore = await readFile(join(root, 'member/core.js'), 'utf8');
for (const required of ['id="notice"', 'id="error"', 'id="loading-view"', 'id="login-view"', 'id="member-view"',
  'id="account-menu"', 'id="profile-dialog"', 'id="retry-logout"', 'id="task-content"', 'aria-live="polite"',
  'href="#main"', 'type="module" src="./app.js"', 'href="./styles.css"', 'content="noindex,nofollow"']) {
  if (!memberHtml.includes(required)) throw new Error(`Member page is missing an accessible state or asset: ${required}`);
}
if (/\b(localStorage|sessionStorage|indexedDB)\b|console\.(log|debug|info)/.test(`${memberApp}\n${memberCore}`))
  throw new Error('Member identity and training data must not be stored or logged in the browser.');
if (/<script[^>]+(?:src=["']https?:|src=["'][^"']*config)/i.test(memberHtml))
  throw new Error('Member identity must load only after explicit login, using server configuration.');
for (const asset of ['member/app.js', 'member/core.js']) execFileSync(process.execPath, ['--check', join(root, asset)], { stdio: 'pipe' });
console.log('Member assets, accessible states, explicit identity loading, module syntax, and browser data boundary are valid.');
