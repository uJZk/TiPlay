// SPDX-License-Identifier: GPL-3.0-only
// Load the actual entry and CSP: an isolated photo harness misses img-src failures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const jpeg = await readFile(new URL('../web/fixtures/photo-exif6.jpg', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
let resources = 0;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/airplay-resource') {
      assert.equal(url.searchParams.get('c'), '1234');
      assert.equal(url.searchParams.get('s'), 'photo-smoke');
      assert.equal(url.searchParams.get('id'), '123');
      assert.equal(url.searchParams.get('r'), 'photo');
      resources++;
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      response.end(jpeg);
      return;
    }
    const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Invalid path');
    const bytes = await readFile(path);
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.end(bytes);
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.photoPolicyViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.photoPolicyViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof window.tiplayStats === 'object');
  await page.evaluate(async () => {
    const { createAirPlayControls } = await import('./airplay-controls.js');
    const stage = document.createElement('div'); stage.id = 'photo-smoke'; document.body.append(stage);
    window.photoControls = createAirPlayControls(stage, () => {}, 'en', {
      fetchPhone: (route, init) => fetch(route, init),
      credentials: () => ({ code: '1234', session: 'photo-smoke' }), host: () => location.host,
    });
    window.photoState = { id: 123, kind: 'photo', resource: 'photo', outputAllowed: false };
    window.photoControls.update(window.photoState);
  });
  await page.waitForFunction(() => document.querySelector('#photo-smoke img')?.naturalWidth > 0);
  const result = await page.evaluate(() => {
    const stage = document.querySelector('#photo-smoke'), image = stage.querySelector('img');
    const layer = stage.querySelector('.airplay-player'), stop = stage.querySelector('.airplay-stop');
    const hidden = layer.hidden && !stop.checkVisibility();
    window.photoControls.update({ ...window.photoState, outputAllowed: true });
    const shown = !layer.hidden && stop.checkVisibility() && stage.querySelector('img') === image;
    window.photoControls.update(window.photoState);
    const result = { hidden, shown, rehidden: layer.hidden && !stop.checkVisibility(),
      width: image.naturalWidth, height: image.naturalHeight, fit: image.style.objectFit,
      violations: window.photoPolicyViolations };
    window.photoControls.dispose(); stage.remove();
    return result;
  });
  assert.deepEqual(result, { hidden: true, shown: true, rehidden: true,
    width: 80, height: 120, fit: 'contain', violations: [] });
  assert.equal(resources, 1, 'Ownership changes reuse the decoded original resource');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: await browser.version(), photo: result, resources }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
