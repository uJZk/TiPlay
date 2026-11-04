// SPDX-License-Identifier: GPL-3.0-only
// Real-browser update checks, paired-link retention and offline use.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const assets = '["./","client.js","decoder-worker.js"]';
const baselineCache = 'tiplay-play-baseline-fixture';
const production = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8')
  .replace(/const ASSETS = \[.*?\];/, 'const ASSETS = ' + assets + ';');
let phase = 'baseline', browser, mismatches = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/app/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(production.replace(/const VERSION = '[^']+';/, `const VERSION = '${phase}-fixture';`));
  } else if (path === '/app/client.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`window.clientVersion=${JSON.stringify(phase)};window.workerVersion=()=>new Promise((resolve,reject)=>{const worker=new Worker('./decoder-worker.js');worker.onmessage=event=>{worker.terminate();resolve(event.data)};worker.onerror=reject;worker.postMessage(window.clientVersion);});navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{});setInterval(()=>window.workerVersion().catch(()=>{}),100);`);
  } else if (path === '/app/decoder-worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`onmessage=e=>{if(e.data!==${JSON.stringify(phase)})fetch('/mismatch?expected='+e.data+'&actual='+${JSON.stringify(phase)},{method:'POST'});postMessage(${JSON.stringify(phase)});};`);
  } else if (path === '/mismatch') { mismatches.push(request.url); response.end('ok'); }
  else if (path === '/app/' || path === '/app/index.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><script src="client.js"></script>'); }
  else if (path === '/app/download/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>download</title>'); }
  else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext(), first = await context.newPage();
  await first.goto(origin + '/app/?t=phone#c=1234');
  await first.evaluate(async () => navigator.serviceWorker.ready);
  await first.reload();
  assert.equal(await first.evaluate(() => window.clientVersion), 'baseline');
  assert.equal(await first.evaluate(() => window.workerVersion()), 'baseline');
  phase = 'updated';
  await first.reload();
  async function verify(expected) {
    await first.waitForFunction(value => window.clientVersion === value, expected, { timeout: 20000 });
    assert.equal(await first.evaluate(() => window.workerVersion()), expected);
    assert.equal(new URL(first.url()).hash, '#c=1234');
    await first.waitForTimeout(300);
    assert.deepEqual(mismatches, [], 'old pages must not load new worker protocols during takeover');
  }
  await verify('updated');
  // The installed new page checks for later releases itself whenever it is loaded.
  phase = 'newer';
  await first.reload();
  await verify('newer');
  const keys = await first.evaluate(() => caches.keys());
  assert.ok(keys.includes('tiplay-play-newer-fixture')); assert.ok(!keys.includes(baselineCache));
  await context.setOffline(true);
  await first.reload();
  assert.equal(await first.evaluate(() => window.clientVersion), 'newer');
  assert.equal(await first.evaluate(() => window.workerVersion()), 'newer');
  await context.setOffline(false);
  await context.close();
  const freshContext = await browser.newContext(), fresh = await freshContext.newPage();
  await fresh.goto(origin + '/app/?t=new#c=9876');
  await fresh.waitForFunction(() => window.clientVersion === 'newer');
  assert.equal(new URL(fresh.url()).hash, '#c=9876');
  await freshContext.close();
  console.log(JSON.stringify({ browser: browser.version(), refreshChecksUpdate: true,
    pairedLinkPreserved: true, firstInstall: true, offline: true }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
