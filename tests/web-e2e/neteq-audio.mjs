// SPDX-License-Identifier: GPL-3.0-only
// Actual production AudioWorklet + official NetEq WASM under the production CSP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(resolve(root, 'index.html'), 'utf8'))[1];
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp }); response.end('<!doctype html><title>NetEq check</title>'); return; }
  try {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep) && !path.startsWith(root)) throw Error('Invalid path');
    const bytes = readFileSync(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Content-Security-Policy': csp });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = await page.evaluate(async () => {
    const { loadNetEq } = await import('/neteq.js');
    const { loadAudioCore } = await import('/wasm/audio-core.js');
    const [neteqModule, audioCoreModule] = await Promise.all([loadNetEq(), loadAudioCore()]);
    const results = [];
    for (const requestedRate of [48000]) {
      const context = new AudioContext({ sampleRate: requestedRate });
      await context.audioWorklet.addModule('/audio-worklet.js');
      const node = new AudioWorkletNode(context, 'tiplay-audio', { outputChannelCount: [2], processorOptions: { neteqModule, audioCoreModule } });
      const messages = [], failures = [];
      node.port.onmessage = ({ data }) => messages.push(data);
      node.onprocessorerror = () => failures.push('processor-error');
      const analyser = context.createAnalyser(); node.connect(analyser); analyser.connect(context.destination);
      node.port.postMessage({ debug: true, diagnosticRevision: 1, generation: 1 });
      // Production NetEq receives fallback PCM only. Native Opus is tested
      // through RTP; the vendor-only Opus/FEC unit tests remain separate.
      for (let i = 0; i < 100; i++) {
        if (i === 30) continue;
        const pcm = Int16Array.from({ length: 480 }, (_, frame) =>
          Math.sin((i * 480 + frame) * 2 * Math.PI * 700 / 48000) * 5000).buffer;
        node.port.postMessage({ type: 1, semanticType: 1, epoch: 1, generation: 1, flags: 0,
          mode: 'carplay', rate: 48000, channels: 1, decodeTimestampUs: i * 10000,
          arrivalLocalTimeMs: performance.now(), pcm }, [pcm]);
      }
      const pcm = Int16Array.from({ length: 48000 }, (_, i) => Math.sin(i * 2 * Math.PI * 997 / 48000) * 9000).buffer;
      node.port.postMessage({ type: 0, semanticType: 0, epoch: 1, generation: 1, flags: 0, mode: 'carplay', rate: 48000, channels: 1,
        arrivalLocalTimeMs: performance.now(), pcm }, [pcm]);
      await context.resume();
      await new Promise(resolve => setTimeout(resolve, 1300));
      const metrics = messages.filter(x => x.diagnostics).at(-1)?.diagnostics;
      node.port.postMessage({ type: 0, epoch: 2, generation: 1, flags: 2, ended: true, pcm: new ArrayBuffer(0) });
      node.port.postMessage({ type: 1, epoch: 2, generation: 1, flags: 2, ended: true, pcm: new ArrayBuffer(0) });
      results.push({ requestedRate, actualRate: context.sampleRate, failures, metrics });
      node.port.postMessage({ dispose: true }); node.disconnect(); analyser.disconnect(); await context.close();
    }
    return results;
  });
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.equal(result.actualRate, result.requestedRate); assert.deepEqual(result.failures, []);
    assert.ok(result.metrics.renderNonzero > 1000); assert.equal(result.metrics.stream0.backend, 'neteq');
    assert.equal(result.metrics.stream1.codec, 'pcm');
    assert.ok(result.metrics.renderPeak > .01 && result.metrics.renderPeak <= 1);
  }
  console.log(JSON.stringify({ browser: browser.version(), results, physicalOutputMeasured: false }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
