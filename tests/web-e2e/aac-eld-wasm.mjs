// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, closeServer } from './resources.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const play = resolve(repo, 'site/play'), fixtures = resolve(repo, 'tests/web/fixtures/aac-eld');
const index = await readFile(resolve(play, 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)?.[1];
assert.ok(csp?.includes("'wasm-unsafe-eval'") && !csp.split(/\s+/).includes("'unsafe-eval'"));
const identityPaths = ['aac-eld-software.js', 'aac-eld-worker.js', 'vendor/aac-eld/aac-eld.js', 'vendor/aac-eld/aac-eld.wasm'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = async () => Object.fromEntries(await Promise.all(identityPaths.map(async path => [path, sha(await readFile(resolve(play, path)))])));
const before = await identity(), errors = [], external = [];
const oracle = JSON.parse(await readFile(resolve(fixtures, 'pcm-sha256.json'), 'utf8'));
let fault = '', genericMime = false, browser;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>AAC-ELD WASM check</title>'); return; }
    const [root, relative] = pathname.startsWith('/play/') ? [play, pathname.slice(6)]
      : pathname.startsWith('/fixtures/') ? [fixtures, pathname.slice(10)] : [null];
    if (!root) throw new Error('Unknown route');
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    if (path.endsWith('/aac-eld.wasm') && fault) {
      const failure = fault; fault = '';
      if (failure === 'http') { response.writeHead(503).end(); return; }
      response.setHeader('Content-Type', 'application/wasm'); response.end(new Uint8Array([0, 1, 2])); return;
    }
    response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript'
      : extname(path) === '.wasm' && !genericMime ? 'application/wasm' : 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
try {
  await listen(server, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking'] });
  const context = await browser.newContext();
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  const result = await page.evaluate(async oracle => {
    const { createSoftwareEldDecoder } = await import('/play/aac-eld-software.js');
    const config = (rate, channels, frames) => ({ codec: 'aac-eld', sampleRate: rate, channels,
      samplesPerFrame: frames, bitDepth: 16, asc: [0xf8, rate === 44100 ? 0xe8 : 0xe6, (channels << 5) | (frames === 480 ? 0x10 : 0), 0] });
    const profiles = [];
    for (const rate of [44100, 48000]) for (const channels of [1, 2]) for (const frames of [480, 512]) {
      const name = `${rate}-${channels}-${frames}`;
      const buffer = await (await fetch(`/fixtures/${name}-tone.bin`)).arrayBuffer(), view = new DataView(buffer);
      const decoder = createSoftwareEldDecoder(config(rate, channels, frames));
      const pcm = [];
      try {
        await decoder.ready;
        for (let offset = 8; offset < buffer.byteLength;) {
          const length = view.getUint32(offset, true); offset += 4;
          const input = new Uint8Array(buffer, offset, length), retained = input.slice(); offset += length;
          const output = await decoder.decode(input);
          if (input.length !== retained.length || input.some((value, index) => value !== retained[index])) throw new Error('Transport packet was detached or modified');
          if (output.byteLength !== frames * channels * 2) throw new Error('Invalid PCM shape');
          pcm.push(new Uint8Array(output));
        }
        const joined = new Uint8Array(pcm.reduce((count, bytes) => count + bytes.length, 0));
        let at = 0; for (const bytes of pcm) { joined.set(bytes, at); at += bytes.length; }
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', joined))].map(value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== oracle[name]) throw new Error(`Independent PCM oracle mismatch: ${name}`);
        profiles.push({ name, frames: pcm.length, sha256: hash });
      } finally { decoder.close(); }
    }
    globalThis.__eldConfig = config(44100, 2, 480);
    return { profiles, userAgent: navigator.userAgent };
  }, oracle);
  assert.equal(result.profiles.length, 8); assert.ok(result.profiles.every(profile => profile.frames === 12));
  for (const failure of ['http', 'corrupt']) {
    fault = failure;
    const retired = await page.evaluate(async () => {
      const { createSoftwareEldDecoder } = await import('/play/aac-eld-software.js');
      const decoder = createSoftwareEldDecoder(globalThis.__eldConfig);
      try { await decoder.ready; return false; } catch { return true; } finally { decoder.close(); }
    });
    assert.equal(retired, true, `${failure} initialization retires the worker`);
    assert.equal(fault, '', 'the real worker requested the defective binary');
    assert.equal(await page.evaluate(async () => {
      const { createSoftwareEldDecoder } = await import('/play/aac-eld-software.js');
      const decoder = createSoftwareEldDecoder(globalThis.__eldConfig);
      try { await decoder.ready; return true; } finally { decoder.close(); }
    }), true, 'a new epoch retries a failed initialization');
    fault = failure;
    assert.equal(await page.evaluate(async failure => {
      globalThis.__eldLoader = await import(`/play/vendor/aac-eld/aac-eld.js?case=${failure}`);
      try { await globalThis.__eldLoader.createEldDecoder(); return false; } catch { return true; }
    }, failure), true, 'the actual loader rejects a defective module');
    assert.equal(fault, '');
    assert.equal(await page.evaluate(async () => {
      const decoder = await globalThis.__eldLoader.createEldDecoder();
      try { return decoder.backend === 'wasm'; } finally { decoder.close(); }
    }), true, 'a rejected compilation does not poison the same module loader cache');
  }
  genericMime = true;
  assert.equal(await page.evaluate(async () => {
    const { createSoftwareEldDecoder } = await import('/play/aac-eld-software.js');
    for (let count = 0; count < 6; count++) {
      const decoder = createSoftwareEldDecoder(globalThis.__eldConfig);
      decoder.close();
      try { await decoder.ready; throw new Error('Close unexpectedly completed initialization'); }
      catch (cause) { if (cause.name !== 'AbortError') throw cause; }
    }
    const decoder = createSoftwareEldDecoder(globalThis.__eldConfig);
    try {
      await decoder.ready;
      const waiting = decoder.decode(new Uint8Array([1])); decoder.close();
      try { await waiting; return false; } catch (cause) { return cause.name === 'AbortError'; }
    } finally { decoder.close(); }
  }), true, 'close cancels initialization/decode and releases instance slots; generic MIME uses byte compilation');
  assert.deepEqual(await identity(), before, 'browser validation did not change shipped code');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ ...result, csp, binarySha256: before['vendor/aac-eld/aac-eld.wasm'],
    initializationFailures: ['http', 'corrupt'], retries: true, cancellation: true, genericMime: true }, null, 2));
  console.log('AAC-ELD WASM: all checks passed');
} finally { await browser?.close(); await closeServer(server); }
