#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const maxBodyBytes = 8192;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function localOrigin(request, server) {
  const address = request.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) throw httpError(403, 'Nur lokale Verbindungen sind erlaubt.');
  const port = server.address()?.port;
  const host = request.headers.host;
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) throw httpError(403, 'Ungültiger lokaler Host.');
  const origin = `http://${host}`;
  if (request.headers.origin && request.headers.origin !== origin) throw httpError(403, 'Fremde Webseiten dürfen diesen Prototyp nicht aufrufen.');
  const site = request.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw httpError(403, 'Nur Anfragen derselben lokalen Seite sind erlaubt.');
  if (request.method === 'POST' && request.headers.origin !== origin) throw httpError(403, 'Schreibzugriff benötigt den Ursprung der lokalen Seite.');
  return origin;
}

function readJson(request) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) throw httpError(415, 'JSON-Inhalt erforderlich.');
  if (request.headers['content-encoding']) throw httpError(415, 'Komprimierte Anfragen werden nicht unterstützt.');
  const length = request.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes)) throw httpError(413, 'Anfrage ist zu gross.');
  return new Promise((resolveBody, reject) => {
    let size = 0, failed = false;
    const chunks = [];
    request.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        failed = true;
        chunks.length = 0;
        reject(httpError(413, 'Anfrage ist zu gross.'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(httpError(400, 'Ungültiges JSON.')); }
    });
    request.on('aborted', () => reject(httpError(400, 'Anfrage wurde abgebrochen.')));
    request.on('error', () => reject(httpError(400, 'Anfrage konnte nicht gelesen werden.')));
  });
}

export function createPrototypeServer({ runtime }) {
  const html = readFileSync(resolve(root, 'scripts/prototype/index.html'), 'utf8');
  const calls = new Map([
    ['catalogue', (input, actor) => runtime.catalogue(actor)],
    ['preview', (input, actor) => runtime.preview(input, actor)],
    ['saveRequest', (input, actor) => runtime.saveRequest(input, actor)],
    ['snapshot', (input, actor) => runtime.snapshot(actor)],
    ['setClock', (input, actor) => runtime.setClock(input, actor)],
    ['reset', (input, actor) => runtime.reset(input, actor)]
  ]);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const json = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      localOrigin(request, server);
      if (request.method === 'GET' && request.url === '/') {
        const nonce = randomBytes(18).toString('base64');
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; font-src 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`
        });
        response.end(html.replaceAll('__CSP_NONCE__', nonce));
        return;
      }
      if (request.method === 'GET' && request.url === '/api/bootstrap') {
        json(200, { identities: runtime.identities() });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/api') throw httpError(404, 'Diese lokale Route ist nicht verfügbar.');
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['method', 'actor', 'input'].includes(key))) throw httpError(400, 'Ungültige Anfrage.');
      if (!calls.has(body.method)) throw httpError(400, 'Diese Aktion ist im lokalen Prototyp nicht verfügbar.');
      if (!body.actor || typeof body.actor !== 'object' || Array.isArray(body.actor) || Object.keys(body.actor).sort().join(',') !== 'personKey,role' || typeof body.actor.role !== 'string' || typeof body.actor.personKey !== 'string') throw httpError(400, 'Eine bekannte synthetische Rolle ist erforderlich.');
      json(200, { result: calls.get(body.method)(body.input, body.actor) });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      response.setHeader('Connection', 'close');
      json(error.status || 400, { error: error.message || 'Die lokale Aktion ist fehlgeschlagen.' });
      request.resume();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.LOCAL_PROTOTYPE_PORT || 4174);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('LOCAL_PROTOTYPE_PORT must be an integer from 0 to 65535.');
  if (process.argv.length > 2) throw new Error('Use LOCAL_PROTOTYPE_DATA_DIR to choose a dedicated synthetic data directory.');
  const { openPrototype } = await import('./prototype/runtime.mjs');
  const runtime = openPrototype({ dataDir: resolve(process.env.LOCAL_PROTOTYPE_DATA_DIR || resolve(root, 'data/local-prototype')) });
  const server = createPrototypeServer({ runtime });
  const close = () => { server.closeAllConnections(); server.close(() => runtime.close()); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.once('exit', () => runtime.close());
  server.once('error', error => {
    runtime.close();
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use; choose LOCAL_PROTOTYPE_PORT.` : `Local prototype could not start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Local synthetic prototype: http://127.0.0.1:${server.address().port}/`));
}
