// SPDX-License-Identifier: GPL-3.0-only
// Install the real production Service Worker, then execute cached WASM with networking offline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, closeServer, History } from './resources.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const prefix = '/nested/play/';
const source = await readFile(resolve(root, 'sw.js'), 'utf8');
const assets = JSON.parse(/const ASSETS = (\[[^\n]+\]);/.exec(source)?.[1]);
const version = /const VERSION = '([^']+)'/.exec(source)?.[1];
assert.ok(version); assert.ok(assets.length > 1);
const archive = path => /(?:\.zip|\.tar\.(?:gz|bz2|xz))$|(?:^|\/)source\//i.test(path);
assert.equal(assets.some(archive), false, 'legal/source archives must remain downloadable without occupying the playback cache');
const wasmPaths = assets.filter(path => path.endsWith('.wasm'));
assert.deepEqual([...wasmPaths].sort(), ['vendor/aac-eld/aac-eld.wasm', 'vendor/soundtouch/soundtouch.simd.wasm',
  'vendor/soundtouch/soundtouch.wasm', 'vendor/soxr/soxr.wasm', 'wasm/audio-core.wasm'].sort());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = [...new Set([...assets.map(path => path === './' ? 'index.html' : path), 'sw.js'])];
const identity = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(resolve(root, path)))])));
const before = await identity();
const fixture = await readFile(new URL('../web/fixtures/aac-eld/44100-2-480-tone.bin', import.meta.url));
const packets = [];
for (let offset = 8; offset < fixture.length;) {
  const length = fixture.readUInt32LE(offset); offset += 4;
  assert.ok(length > 0 && offset + length <= fixture.length);
  packets.push([...fixture.subarray(offset, offset + length)]); offset += length;
}
const golden = JSON.parse(await readFile(new URL('../web/fixtures/aac-eld/pcm-sha256.json', import.meta.url), 'utf8'))['44100-2-480'];
const requests = new History(), errors = new History(), externals = new History(), offlineResponses = new History();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
let browser, offline = false;
const server = createServer(async (request, response) => {
  requests.push(request.url);
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) throw new Error('Unknown route');
    const relative = pathname.slice(prefix.length) || 'index.html';
    const path = resolve(root, relative);
    if (!path.startsWith(root.replace(/\/$/, '') + sep)) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});

try {
  await listen(server, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`, address = origin + prefix;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    globalThis.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      globalThis.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externals.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (offline) offlineResponses.push({ url: response.url(), serviceWorker: response.fromServiceWorker() });
  });
  await page.goto(address);
  await page.waitForFunction(() => document.querySelector('#connect')?.textContent.trim().length > 0);
  await page.evaluate(async () => {
    let timeout;
    try {
      await Promise.race([(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      })(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Production Service Worker activation timed out.')), 30000); })]);
    } finally { clearTimeout(timeout); }
  });
  const installed = await page.evaluate(async () => {
    const keys = await caches.keys(), name = keys.find(key => key.startsWith('tiplay-play-'));
    return { names: keys, keys: (await (await caches.open(name)).keys()).map(request => request.url), violations: globalThis.__cspViolations,
      controller: navigator.serviceWorker.controller.scriptURL };
  });
  assert.deepEqual(installed.names, [`tiplay-play-${version}`]);
  assert.equal(installed.controller, address + 'sw.js');
  assert.deepEqual(installed.keys.sort(), assets.map(path => new URL(path, address).href).sort());
  assert.equal(installed.keys.some(archive), false); assert.deepEqual(installed.violations, []);
  const onlineRequests = requests.length;
  await context.setOffline(true); offline = true;
  const navigation = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(navigation.fromServiceWorker(), 'offline navigation comes from the real Service Worker');
  await page.waitForFunction(() => navigator.serviceWorker.controller && document.querySelector('#connect')?.textContent.trim().length > 0);
  assert.equal(await page.locator('#link-form').isVisible(), true);
  const result = await page.evaluate(async ({ wasmPaths, packets, golden }) => {
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    // navigator.onLine reports host connectivity on some CDP builds; an actual
    // uncached request must fail under the browser's offline network emulation.
    let networkRejected = false;
    try { await fetch('./uncached-offline-network-probe'); } catch { networkRejected = true; }
    require(networkRejected, 'An uncached network request fails while cached modules remain available');
    const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const binaries = {};
    for (const path of wasmPaths) {
      const response = await fetch(new URL(`${path}?offline-cache-check=1`, location.href));
      require(response.ok, `Cached module missing: ${path}`);
      const bytes = await response.arrayBuffer();
      require(WebAssembly.validate(bytes), `Cached bytes are not WebAssembly: ${path}`);
      binaries[path] = { sha256: await sha(bytes), bytes: bytes.byteLength };
    }
    const { loadAudioCore, AudioKernel } = await import('./wasm/audio-core.js');
    await loadAudioCore();
    const kernel = new AudioKernel(), input16 = Int16Array.from({ length: 512 }, (_, index) => [-32768, -16384, 0, 16384, 32767][index % 5]);
    const converted = new Float32Array(input16.length); kernel.pcm16(input16, 0, converted, 0, input16.length);
    require(converted.every((value, index) => value === input16[index] / 32768), 'Cached audio core converts exact PCM');
    const { loadSoxr, SoxrRuntime } = await import('./streaming-resampler.js');
    await loadSoxr();
    const runtime = new SoxrRuntime(), resampler = runtime.create(44100, 48000, 1);
    const input = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / 44100));
    const output = new Float32Array(512); let consumed = 0, produced = 0, nonzero = false;
    try {
      for (let call = 0; call < 24; call++) {
        const result = resampler.process(input.subarray(consumed), input.length - consumed, output);
        consumed += result.consumed; produced += result.produced;
        require(output.subarray(0, result.produced).every(Number.isFinite), 'Cached soxr output is finite');
        nonzero ||= output.subarray(0, result.produced).some(value => Math.abs(value) > 0.01);
        if (!result.consumed && !result.produced) break;
      }
    } finally { resampler.dispose(); }
    require(consumed > 0 && produced > 0 && nonzero, 'Cached soxr executes a real resampling stream');
    const { loadSoundTouch, soundTouchSimdSupported } = await import('./vendor/soundtouch/soundtouch.js');
    const tempo = [];
    for (const simd of soundTouchSimdSupported() ? [false, true] : [false]) {
      const engine = await loadSoundTouch({ simd, cache: false }), processor = engine.create(48000, 1.25);
      const signal = Float32Array.from({ length: 4800 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / 48000));
      try {
        const blocks = [processor.push(signal), processor.finish()].filter(Boolean);
        const frames = blocks.reduce((count, block) => count + block.length / 2, 0);
        require(frames === 3840, 'Cached SoundTouch preserves the requested duration');
        require(blocks.every(block => block.every(Number.isFinite)) && blocks.some(block => block.some(value => Math.abs(value) > 0.01)),
          'Cached SoundTouch produces a real finite tone');
        tempo.push({ backend: engine.backend, frames });
      } finally { processor.dispose(); }
    }
    const { createEldDecoder } = await import('./vendor/aac-eld/aac-eld.js');
    const { createSoftwareEldDecoder } = await import('./aac-eld-software.js');
    const direct = await createEldDecoder();
    const worker = createSoftwareEldDecoder({ codec: 'aac-eld', sampleRate: 44100, channels: 2, samplesPerFrame: 480,
      bitDepth: 16, asc: [0xf8, 0xe8, 0x50, 0] });
    const streams = { direct: [], worker: [] };
    try {
      await worker.ready;
      for (const packet of packets) {
        streams.direct.push(new Uint8Array(direct.decode(Uint8Array.from(packet), true).buffer));
        streams.worker.push(new Uint8Array(await worker.decode(Uint8Array.from(packet))));
      }
    } finally { direct.close(); worker.close(); }
    const aac = {};
    for (const [name, blocks] of Object.entries(streams)) {
      const joined = new Uint8Array(blocks.reduce((count, block) => count + block.length, 0));
      let offset = 0; for (const block of blocks) { joined.set(block, offset); offset += block.length; }
      aac[name] = { frames: blocks.length, sha256: await sha(joined) };
      require(aac[name].sha256 === golden, `Cached AAC-ELD ${name} matches the independent PCM golden`);
    }
    let archiveRejected = false;
    try { await fetch('./vendor/aac-eld/aac-eld-source.zip'); } catch { archiveRejected = true; }
    require(archiveRejected, 'Source archives are outside the offline playback cache');
    return { binaries, networkRejected, audioCoreSamples: converted.length, soxr: { consumed, produced }, tempo, aac, archiveRejected,
      violations: globalThis.__cspViolations, csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content };
  }, { wasmPaths, packets, golden });
  assert.deepEqual(result.violations, []); assert.deepEqual([...errors], []); assert.deepEqual([...externals], []);
  for (const path of wasmPaths) {
    assert.equal(result.binaries[path].sha256, before[path]);
    assert.ok(offlineResponses.some(response => new URL(response.url).pathname === prefix + path && response.serviceWorker),
      `${path} was delivered by the production Service Worker while offline`);
  }
  assert.equal(requests.length, onlineRequests, 'offline execution did not reach the static server');
  assert.deepEqual(await identity(), before, 'offline verification did not mutate runtime inputs');
  for (const history of [requests, errors, externals, offlineResponses]) history.assertComplete();
  const report = { browser: await browser.version(), cacheVersion: version, cachedEntries: assets.length,
    offlineReloadFromServiceWorker: true, sourceArchivesPrecached: false, runtimeInputsUnchanged: paths.length, ...result };
  if (process.env.WASM_OFFLINE_RESULT) await writeFile(process.env.WASM_OFFLINE_RESULT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log('Offline WASM: all checks passed');
} finally { await browser?.close(); await closeServer(server); }
