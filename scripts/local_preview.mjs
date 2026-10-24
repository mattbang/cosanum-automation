#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'apps-script/Index.html');
const adapter = resolve(root, 'scripts/local_preview_adapter.js');
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');

export function renderPreview(html, adapterCode, nonce) {
  if (!html.includes('<script>') || !html.includes('<body>')) throw new Error('Index.html structure changed; preview injection stopped');
  const banner = `<style>#offlinePreviewBanner{position:sticky;top:0;z-index:10000;background:#57204f;color:white;padding:12px 18px;font:700 15px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px #0005}#offlinePreviewBanner small{display:block;font-weight:400}#offlinePreviewNotice{position:fixed;bottom:12px;left:12px;right:12px;z-index:10001;max-width:780px;margin:auto;background:#fff3cd;color:#422000;border:2px solid #a65a00;border-radius:8px;padding:12px;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px #0004}#offlinePreviewNotice[hidden]{display:none}</style><div id="offlinePreviewBanner" role="status">OFFLINE PREVIEW · SYNTHETIC DATA · READ ONLY<small>No Google connection. Buttons that save, send, book, or change data are blocked.</small></div><div id="offlinePreviewNotice" role="alert" hidden></div>`;
  return html.replace('<body>', `<body>${banner}`)
    .replace('<script>', `<script nonce="${nonce}">${adapterCode}</script><script nonce="${nonce}">`);
}

export function createPreviewServer() {
  return createServer(async (request, response) => {
    // No static file server: even encoded paths and private fixtures are inaccessible.
    if (request.method !== 'GET' || request.url !== '/') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('Not found');
      return;
    }
    try {
      const [html, adapterCode] = await Promise.all([readFile(source, 'utf8'), readFile(adapter, 'utf8')]);
      const nonce = randomBytes(16).toString('base64');
      const body = renderPreview(html, adapterCode, nonce);
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`Preview unavailable: ${error.message}`);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createPreviewServer().listen(port, '127.0.0.1', function () {
    console.log(`Offline preview: http://127.0.0.1:${this.address().port}/`);
  });
}
