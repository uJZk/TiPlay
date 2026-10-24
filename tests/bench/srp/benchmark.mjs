// SPDX-License-Identifier: GPL-3.0-only
// Genuine Chromium/WebCrypto client setup; original tssrp6a BigInt powers are the baseline.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { listen, closeServer } from '../../web-e2e/resources.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../../site/play/', import.meta.url));
const csp = (await readFile(resolve(root, 'index.html'), 'utf8')).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
const benchmarkRoot = fileURLToPath(new URL('./', import.meta.url));
const binary = await readFile(resolve(benchmarkRoot, 'libtommath/libtommath.wasm')), compressed = gzipSync(binary);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') return response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp }).end('<!doctype html><title>SRP benchmark</title>');
    const base = pathname.startsWith('/benchmark/') ? benchmarkRoot : root;
    const path = resolve(base, pathname.startsWith('/benchmark/') ? pathname.slice('/benchmark/'.length) : pathname.slice(1));
    if (!path.startsWith(base.replace(/\/$/, '') + sep) || !/\.(js|wasm)$/.test(path)) return response.writeHead(404).end();
    if (path.endsWith('libtommath.wasm')) return response.writeHead(200, { 'Content-Type': 'application/wasm',
      'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' }).end(compressed);
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await readFile(path));
  } catch (_) { response.writeHead(404).end(); }
});
let browser;
try {
  await listen(server, '127.0.0.1');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { BrowserSrpRoutines, pairingRoutines, pairingTranscript } = await import('/rtc-pairing.js');
    const { loadSrpMath } = await import('/benchmark/libtommath/libtommath.js');
    const { createCandidateRoutines } = await import('/benchmark/candidate.js');
    const { SRPParameters } = await import('/vendor/tssrp6a/parameters.js');
    const { SRPClientSession } = await import('/vendor/tssrp6a/session-client.js');
    const { bigIntToArrayBuffer } = await import('/vendor/tssrp6a/utils.js');
    const parameters = new SRPParameters(SRPParameters.PrimeGroup[2048], SRPParameters.H.SHA256), N = parameters.primeGroup.N;
    // Reuse identical, production-size operands rather than favoring a short test-vector nonce.
    const a = (N >> 3n) + 0x1309cafec0ffee49n, b = (N >> 2n) + 0x135cafefeed25n, salt = 0x50ee25badc0ffeen;
    let reference;
    async function client(wasm) {
      const routines = wasm ? createCandidateRoutines(BrowserSrpRoutines, parameters) : pairingRoutines();
      routines.generatePrivateValue = () => a;
      try {
        const start = await new SRPClientSession(routines).step1('TiPlay browser', '1234'), proof = await start.step2(salt, b);
        const identity = [proof.A, proof.M1, proof.S].map(value => value.toString(16)).join(':');
        if (reference && identity !== reference) throw new Error('Native/WASM proof mismatch');
        reference ??= identity;
        // Native hashing, proof verification, key import and transcript HMAC are included.
        await proof.step3(await routines.computeServerEvidence(proof.A, proof.M1, proof.S));
        const key = await crypto.subtle.importKey('raw', await routines.hashPadded(bigIntToArrayBuffer(proof.S)),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
        const transcript = pairingTranscript(['TiPlay-RTC-SRP6a-v1', 'benchmark', 'session', proof.A, b, salt, 'offer', 'answer', 1]);
        const binding = await crypto.subtle.sign('HMAC', key, transcript);
        if (!await crypto.subtle.verify('HMAC', key, binding, transcript)) throw new Error('Invalid benchmark binding');
      } finally { routines.dispose?.(); }
    }
    let started = performance.now(); await client(false); const initialNativeClientMs = performance.now() - started;
    started = performance.now(); await loadSrpMath(); await client(true); const initialWasmFetchCompileClientMs = performance.now() - started;
    const native = [], wasm = [];
    for (let trial = 0; trial < 21; trial++) for (const mode of trial % 2 ? [true, false] : [false, true]) {
      started = performance.now(); await client(mode);
      if (trial > 0) (mode ? wasm : native).push(performance.now() - started);
    }
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    return { initialNativeClientMs, initialWasmFetchCompileClientMs, nativeClientMedianMs: median(native), wasmClientMedianMs: median(wasm),
      measuredTrialsPerBackend: native.length, threeModularPowers: true, matchingProofs: true, nativeWebCrypto: true,
      fullHeapDisposalIncluded: true, productionCspApplied: true };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ browser: await browser.version(), ...result, binaryBytes: binary.length, gzipBytes: compressed.length,
    transport: 'loopback HTTP, no-store gzip; Internet latency/vehicle performance unmeasured' }, null, 2));
} finally { await browser?.close(); await closeServer(server); }
