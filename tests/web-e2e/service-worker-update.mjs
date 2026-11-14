// SPDX-License-Identifier: GPL-3.0-only
// Real Chromium: deterministic takeover windows, durable owners, module Worker/Wasm and legacy migration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const assets = '["./","client.js","decoder-worker.js","audio-worklet.js","child.js","late.js","probe.wasm"]';
const production = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8');
// Previously published workers had no durable client ownership or versioned module URLs.
const legacyHandlers = "self.addEventListener('install', event => {\n  // Bypass the HTTP cache (GitHub Pages sends max-age=600) so a new version never stores older files.\n  const requests = ASSETS.map(path => new Request(path, { cache: 'reload' }));\n  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(requests)).then(() => self.skipWaiting()));\n});\n\nself.addEventListener('activate', event => {\n  event.waitUntil((async () => {\n    const keys = await caches.keys();\n    const old = keys.filter(key => key.startsWith('tiplay-play-') && key !== CACHE);\n    if (old.length) {\n      const root = new URL('./', self.location), index = new URL('index.html', self.location);\n      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });\n      const pages = windows.filter(client => {\n        const url = new URL(client.url);\n        return url.origin === root.origin && (url.pathname === root.pathname || url.pathname === index.pathname);\n      });\n      // Waiting for navigation inside activate deadlocks: its fetch waits for activation.\n      void Promise.allSettled(pages.map(client => client.navigate(client.url)))\n        .then(() => Promise.all(old.map(key => caches.delete(key)))).catch(() => {});\n    }\n  })());\n});\n\nself.addEventListener('fetch', event => {\n  const { request } = event;\n  if (request.method !== 'GET') return;\n  const url = new URL(request.url);\n  url.search = url.hash = '';\n  if (!OWN.has(url.href)) return;\n  event.respondWith(caches.open(CACHE)\n    .then(cache => cache.match(request, { ignoreSearch: true }))\n    .then(cached => cached ?? fetch(request)));\n});\n";
const original = production.slice(0, production.indexOf('const ROOT =')) + legacyHandlers;
const appSource = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
const registrationExpression = /navigator\.serviceWorker\.register\((new URL\('sw\.js', [^)]+\))/.exec(appSource)?.[1];
assert.ok(registrationExpression, 'Use the actual production service-worker registration expression.');
let phase = 'baseline', legacy = false, failNavigation = false, navigationAttempts = 0;
const mismatches = [], observations = [];
const hardDeadline = setTimeout(() => { console.error('PROOF hard deadline', { phase, legacy, navigationAttempts }); process.exit(1); },90000);
function script(response, source) {
  const bytes = gzipSync(source);
  response.setHeader('Content-Type', 'text/javascript');
  response.setHeader('Content-Encoding', 'gzip'); response.setHeader('Content-Length', bytes.length); response.end(bytes);
}
const phaseNumber = () => ({ baseline: 1, updated: 2, newer: 3 })[phase];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'), path = url.pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/navigation-policy') { navigationAttempts++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ fail: failNavigation })); return; }
  if (path === '/mismatch') { let body = ''; for await (const part of request) body += part; mismatches.push(JSON.parse(body)); response.end('ok'); return; }
  if (path === '/app/sw.js') {
    let source = (legacy && phase === 'baseline' ? original : production)
      .replace(/const ASSETS = \[.*?\];/, 'const ASSETS = ' + assets + ';')
      .replace(/const VERSION = '[^']+';/, `const VERSION = '${phase}-fixture';`);
    // Hold real WindowClient.navigate calls across several real Worker creations.
    // Client identities and the production fetch/owner logic remain unchanged.
    source = source.replace('client.navigate(client.url)', '__testNavigate(client)');
    source += `\nasync function __testNavigate(client){const policy=await(await fetch('/navigation-policy')).json();if(policy.fail)throw Error('Test navigation rejection');await new Promise(resolve=>setTimeout(resolve,500));return client.navigate(client.url);}`;
    response.setHeader('Content-Type', 'text/javascript'); response.end(source); return;
  }
  if (path === '/app/client.js') {
    script(response, `window.clientVersion=${JSON.stringify(phase)};window.checks=0;window.takeovers=0;navigator.serviceWorker.addEventListener('controllerchange',()=>window.takeovers++);
      function check(worker){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker response timed out')),3000);worker.onmessage=e=>{clearTimeout(timer);if(!e.data.ok)reject(Error('Worker protocol mismatch'));else resolve(e.data)};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message||'Worker unavailable'))};worker.postMessage(window.clientVersion);});}
      window.workerVersion=async()=>{const worker=new Worker(new URL('./decoder-worker.js',import.meta.url),{type:'module'});try{const result=await check(worker);window.checks++;return result;}finally{worker.terminate();}};
      window.retainWorker=async()=>{window.retainedWorker=new Worker(new URL('./decoder-worker.js',import.meta.url),{type:'module'});return check(window.retainedWorker)};
      window.checkRetained=()=>check(window.retainedWorker);
      document.querySelector('button').onclick=async()=>{window.workletResult=null;try{const context=new AudioContext();await context.resume();
        await context.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url));
        const node=new AudioWorkletNode(context,'tiplay-sw-proof'),silent=context.createGain();silent.gain.value=0;
        node.port.onmessage=async event=>{window.workletResult=event.data;node.disconnect();await context.close();};node.connect(silent).connect(context.destination);
      }catch(error){window.workletResult={failed:true};}};
      navigator.serviceWorker.register(${registrationExpression},{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});
      setInterval(()=>window.workerVersion().catch(()=>{}),100);`); return;
  }
  if (path === '/app/decoder-worker.js') {
    script(response, `import {phase as childPhase} from './child.js';let sequence=0;
      onmessage=async e=>{try{const late=await import('./late.js?probe='+(++sequence));const resource=new URL('./probe.wasm',import.meta.url);const wasm=await WebAssembly.instantiate(await(await fetch(resource)).arrayBuffer());
      const result={expected:e.data,actual:${JSON.stringify(phase)},child:childPhase,late:late.phase,wasm:wasm.instance.exports.version(),metaPinned:import.meta.url.includes('/__tiplay_cache__/'),wasmPinned:resource.pathname.includes('/__tiplay_cache__/')};
      result.ok=result.expected===result.actual&&result.child===result.expected&&result.late===result.expected&&result.wasm===({baseline:1,updated:2,newer:3})[result.expected];if(!result.ok)fetch('/mismatch',{method:'POST',body:JSON.stringify(result)});postMessage(result);
      }catch(error){postMessage({ok:false,resourceFailed:true});}};`); return;
  }
  if (path === '/app/child.js' || path === '/app/late.js') { script(response, `export const phase=${JSON.stringify(phase)};`); return; }
  if (path === '/app/audio-worklet.js') {
    script(response, `import {phase} from './child.js';registerProcessor('tiplay-sw-proof',class extends AudioWorkletProcessor{
      constructor(){super();this.port.postMessage({phase:${JSON.stringify(phase)},child:phase,metaPinned:import.meta.url.includes('/__tiplay_cache__/')});}
      process(){return true;}});`);return;
  }
  if (path === '/app/probe.wasm') {
    response.setHeader('Content-Type', 'application/wasm');
    response.end(Buffer.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,11,1,7,118,101,114,115,105,111,110,0,0,10,6,1,4,0,65,phaseNumber(),11])); return;
  }
  if (path === '/app/' || path === '/app/index.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><button>Silent Worklet check</button><script type="module" src="client.js"></script>'); return; }
  if (path === '/app/download/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>download</title>'); return; }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const cacheName = value => 'tiplay-play-' + value + '-fixture';
async function settle(check, message) {
  const limit = Date.now() + 10000;
  while (!(await check())) { if (Date.now() >= limit) throw Error(message); await new Promise(resolve => setTimeout(resolve,25)); }
}
async function open(context, token = '1234') {
  const page = await context.newPage();
  await page.goto(origin + '/app/?t=phone#c=' + token);
  await page.evaluate(async () => Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service worker ready timed out')),5000))]));
  await page.reload();
  await page.waitForFunction(() => window.workerVersion); await page.evaluate(() => window.workerVersion()); return page;
}
async function check(page, expected, pinned = true) {
  assert.equal(await page.evaluate(() => window.clientVersion), expected);
  const report = await page.evaluate(() => window.workerVersion()); assert.equal(report.actual, expected);
  if (pinned) { assert.equal(report.metaPinned,true); assert.equal(report.wasmPinned,true); }
}
async function checkWorklet(page,expected) {
  await page.click('button');await page.waitForFunction(()=>window.workletResult);
  const report=await page.evaluate(()=>window.workletResult);
  assert.equal(report.failed,undefined);assert.equal(report.phase,expected);assert.equal(report.child,expected);assert.equal(report.metaPinned,true);
}
async function update(page, next, number) {
  phase = next; const before = navigationAttempts;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await settle(() => navigationAttempts >= before + number, 'Expected real client navigation attempts');
}
async function ownerSummary(page) {
  return page.evaluate(async () => {
    const cache=await caches.open('tiplay-client-owners-v1'), values=[];
    for(const key of await cache.keys()){const response=await cache.match(key);if(response)values.push(await response.json());}
    return {versions:[...new Set(values.map(value=>value.cache).filter(Boolean))].sort(),blocked:values.filter(value=>value.blocked).length,
      urlsPersisted:values.some(value=>JSON.stringify(value).includes('http')||JSON.stringify(value).includes('#c=')||JSON.stringify(value).includes('?t='))};
  });
}
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  // A forced 500ms takeover window must keep the old module/Worker/child/Wasm together.
  {
    phase='baseline';legacy=false;failNavigation=false;const context=await browser.newContext(), page=await open(context);
    await check(page,'baseline'); const checks=await page.evaluate(()=>window.checks);
    await update(page,'updated',1);
    await page.waitForFunction(()=>window.clientVersion==='updated'); await check(page,'updated');
    assert.equal(new URL(page.url()).hash,'#c=1234');
    await update(page,'newer',1); await page.waitForFunction(()=>window.clientVersion==='newer'); await check(page,'newer');
    await context.setOffline(true); await page.reload(); await check(page,'newer'); await context.setOffline(false);
    const keys=await page.evaluate(()=>caches.keys());assert.ok(keys.includes(cacheName('newer')));
    assert.equal(mismatches.length,0);observations.push({scenario:'delayed-takeover',moduleWorkerAndWasm:true,pairingPreserved:true,offline:true,baselineChecks:checks});
    await context.close();
  }
  // Keep two different known owners alive through failed navigation and SW restart.
  {
    phase='baseline';legacy=false;failNavigation=true;const context=await browser.newContext(), first=await open(context);
    await first.evaluate(()=>window.retainWorker());await update(first,'updated',1);await check(first,'baseline');
    const second=await open(context,'9876');await check(second,'updated');
    await second.evaluate(()=>window.retainWorker());await update(second,'newer',2);
    await check(first,'baseline');await check(second,'updated');
    let keys=await first.evaluate(()=>caches.keys());assert.ok(keys.includes(cacheName('baseline'))&&keys.includes(cacheName('updated')));
    const cdp=await context.newCDPSession(first);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
    assert.equal((await first.evaluate(()=>window.checkRetained())).actual,'baseline');
    assert.equal((await second.evaluate(()=>window.checkRetained())).actual,'updated');
    await checkWorklet(first,'baseline');await checkWorklet(second,'updated');
    const owners=await ownerSummary(first);assert.equal(owners.urlsPersisted,false);
    assert.ok(owners.versions.includes(cacheName('baseline'))&&owners.versions.includes(cacheName('updated')));
    await context.setOffline(true);await check(first,'baseline');await check(second,'updated');await context.setOffline(false);
    failNavigation=false;await first.reload();await check(first,'newer');await second.reload();await check(second,'newer');
    await settle(async()=>{await second.evaluate(()=>window.workerVersion());const keys=await second.evaluate(()=>caches.keys());return !keys.includes(cacheName('baseline'))&&!keys.includes(cacheName('updated'));},'Unused old caches should retire after both clients leave');
    assert.equal(mismatches.length,0);observations.push({scenario:'failed-navigation-two-versions-and-restart',oldWorkersAndWasmPinned:true,silentWorkletAndChildPinned:true,durableOwners:true,oldCachesRetiredAfterClientsExit:true,urlsPersisted:false});
    await context.close();
  }
  // Legacy SWs have no ownership records: block, preserve all old caches, reload safely.
  {
    phase='baseline';legacy=true;failNavigation=true;const context=await browser.newContext(), page=await open(context);
    await check(page,'baseline',false);await page.evaluate(()=>window.retainWorker());
    await page.evaluate(async()=>{await caches.open('tiplay-play-stale-fixture');});
    await update(page,'updated',1);
    assert.equal(await page.evaluate(()=>window.workerVersion().then(()=>false,()=>true)),true);
    assert.equal(await page.evaluate(()=>window.checkRetained().then(()=>false,()=>true)),true);
    const cdp=await context.newCDPSession(page);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
    assert.equal(await page.evaluate(()=>window.workerVersion().then(()=>false,()=>true)),true);
    let keys=await page.evaluate(()=>caches.keys());assert.ok(keys.includes(cacheName('baseline'))&&keys.includes('tiplay-play-stale-fixture'));
    const owners=await ownerSummary(page);assert.ok(owners.blocked>0);assert.equal(owners.urlsPersisted,false);
    const fresh=await open(context,'5555');await check(fresh,'updated');
    failNavigation=false;await page.reload();await check(page,'updated');assert.equal(new URL(page.url()).hash,'#c=1234');
    await settle(async()=>{await page.evaluate(()=>window.workerVersion());const keys=await page.evaluate(()=>caches.keys());return !keys.includes(cacheName('baseline'))&&!keys.includes('tiplay-play-stale-fixture');},'Legacy caches should retire only after blocked clients exit');
    assert.equal(mismatches.length,0);observations.push({scenario:'legacy-unmapped-multiple-caches',unknownBlockedRatherThanGuessed:true,restartPreservedBlock:true,freshNavigationWorks:true,pairingPreserved:true});
    await context.close();
  }
  const result={browser:browser.version(),refreshChecksUpdate:true,pairedLinkPreserved:true,firstInstall:true,offline:true,checks:observations,mismatches};
  console.log(JSON.stringify(result));
} finally {clearTimeout(hardDeadline);await browser?.close();await new Promise(resolve=>server.close(resolve));}
