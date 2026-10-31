// SPDX-License-Identifier: GPL-3.0-only
// Optional real-browser lifecycle check: NODE_PATH=/path/to/playwright-core/node_modules
// CHROMIUM=/path/to/chromium node tests/web-e2e/service-worker-update.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const assets = '["./","client.js","decoder-worker.js"]';
const legacyCache = 'tiplay-play-legacy-fixture', updatedCache = 'tiplay-play-updated-fixture';
const production = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8')
  .replace(/const VERSION = '[^']+';/, "const VERSION = 'updated-fixture';")
  .replace(/const ASSETS = \[.*?\];/, 'const ASSETS = ' + assets + ';');
// The previously published policy forced activation and claimed existing pages.
// It has already activated before the replacement production script is installed.
const legacy = `const CACHE=${JSON.stringify(legacyCache)}, ASSETS=${assets};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(path,{cache:'reload'})))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => { const url=new URL(event.request.url);url.search='';
  if(ASSETS.some(path=>new URL(path,self.location).href===url.href))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreSearch:true})).then(value=>value||fetch(event.request)));
});`;
let phase = 'legacy', browser;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/app/sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(phase === 'legacy' ? legacy : production); }
  else if (path === '/app/client.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`window.clientVersion=${JSON.stringify(phase)};window.workerVersion=()=>new Promise((resolve,reject)=>{const worker=new Worker('./decoder-worker.js');worker.onmessage=event=>{worker.terminate();resolve(event.data)};worker.onerror=reject;});`);
  } else if (path === '/app/decoder-worker.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(`postMessage(${JSON.stringify(phase)});`); }
  else if (path === '/app/' || path === '/app/index.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><script src="client.js"></script>'); }
  else if (path === '/observer.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>outside SW scope</title>'); }
  else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext(), first = await context.newPage();
  await first.goto(origin + '/app/');
  await first.evaluate(async () => { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; });
  await first.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await first.reload();
  const second = await context.newPage(); await second.goto(origin + '/app/');
  for (const page of [first, second]) assert.equal(await page.evaluate(() => window.workerVersion()), 'legacy');
  phase = 'updated';
  await first.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await first.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed');
  for (const page of [first, second]) {
    assert.equal(await page.evaluate(() => window.clientVersion), 'legacy');
    assert.equal(await page.evaluate(() => window.workerVersion()), 'legacy');
  }
  assert.ok((await first.evaluate(() => caches.keys())).includes(legacyCache));
  await first.close();
  assert.equal(await second.evaluate(() => window.workerVersion()), 'legacy');
  assert.equal(await second.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.state), 'installed');
  // This observer cannot keep the /app/ registration alive as a controlled client.
  const observer = await context.newPage(); await observer.goto(origin + '/observer.html');
  assert.equal(await observer.evaluate(() => navigator.serviceWorker.controller), null);
  await second.close();
  await observer.waitForFunction(async ({ oldCache, newCache }) => {
    const registration = await navigator.serviceWorker.getRegistration('/app/'), keys = await caches.keys();
    return registration?.active?.state === 'activated' && !registration.waiting && keys.includes(newCache) && !keys.includes(oldCache);
  }, { oldCache: legacyCache, newCache: updatedCache });
  const current = await context.newPage(); await current.goto(origin + '/app/');
  assert.equal(await current.evaluate(() => window.clientVersion), 'updated');
  assert.equal(await current.evaluate(() => window.workerVersion()), 'updated');
  await context.close();
  const initialContext = await browser.newContext(), initial = await initialContext.newPage();
  await initial.goto(origin + '/app/');
  await initial.evaluate(async () => { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; });
  assert.equal(await initial.evaluate(() => navigator.serviceWorker.controller), null, 'activation must not claim an uncontrolled document');
  await initial.reload(); assert.ok(await initial.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await initialContext.close();
  console.log(JSON.stringify({ browser: browser.version(), legacyToUpdated: true, twoActivePagesKeepLegacyWorker: true,
    activatesOnlyAfterAllLegacyPagesExit: true, newPageGetsUpdatedMainAndWorker: true, uncontrolledDocumentNotClaimed: true }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
