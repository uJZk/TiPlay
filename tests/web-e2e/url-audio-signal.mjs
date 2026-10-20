// SPDX-License-Identifier: GPL-3.0-only
// Render the production URL engine's AudioBufferSource graph, independent of mirror/worklet audio.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(fileURLToPath(new URL('../../site/play/', import.meta.url)));
const signal = fileURLToPath(new URL('../web/fixtures/url-audio-signal.mjs', import.meta.url));
const engineFile = process.env.TEST_URL_AUDIO_ENGINE || resolve(root, 'airplay-media.js');
const engineSource = readFileSync(engineFile), engineSha256 = createHash('sha256').update(engineSource).digest('hex');
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/harness') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>URL audio signal oracle</title>'); return; }
  if (path === '/airplay-media.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(engineSource); return; }
  const target = path === '/signal-fixture.mjs' ? signal : resolve(root, '.' + path);
  if (target !== signal && !target.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try { response.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(target)) ? 'text/javascript' : 'application/octet-stream'); response.end(readFileSync(target)); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
  console.log(JSON.stringify({ engineSha256, browser: await browser.version(), oracle: 'native OfflineAudioContext production graph versus native whole-buffer reference' }));
  const results = [];
  for (const [sourceRate, contextRate, quantize] of [[44100, 48000, true], [44100, 44100, true], [48000, 48000, false], [48000, 44100, false]]) {
    const result = await page.evaluate(async ({ sourceRate, contextRate, quantize }) => {
      const { createMediaEngine } = await import('/airplay-media.js');
      const { urlAudioSample } = await import('/signal-fixture.mjs');
      let offline;
      let wall = 0, audioClock = 0, next = 0;
      const callbacks = new Map(), sources = [], constructorOptions = [], packetFrames = 1024, origin = 100, duration = 3;
      const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
      // The deterministic clock creates the actual production graph before native rendering.
      // This isolates graph/PCM/resampler continuity; it does not simulate a live device deadline.
      class Context {
        constructor(options = {}) {
          constructorOptions.push({ ...options });
          offline = new OfflineAudioContext(2, (options.sampleRate || contextRate) * 3, options.sampleRate || contextRate);
          this.state = 'suspended'; this.destination = offline.destination; this.sampleRate = offline.sampleRate;
        }
        get currentTime() { return audioClock; }
        createGain() { return offline.createGain(); }
        createBuffer(...args) { return offline.createBuffer(...args); }
        createBufferSource() {
          const node = offline.createBufferSource(), start = node.start.bind(node);
          node.start = time => { sources.push({ time, node }); start(time); };
          return node;
        }
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
      }
      const track = { canDecode: async () => true, isLive: async () => false };
      class Input {
        async getPrimaryVideoTrack() { return null; }
        async getPrimaryAudioTrack() { return track; }
        async getFirstTimestamp() { return origin; }
        async getDurationFromMetadata() { return origin + duration; }
        dispose() {}
      }
      class AudioBufferSink {
        buffers(start) {
          let index = Math.max(0, Math.floor((start - origin) * sourceRate / packetFrames + 1e-6)), closed = false;
          return { [Symbol.asyncIterator]() { return this; }, async return() { closed = true; return { done: true }; }, async next() {
            if (closed || index * packetFrames >= duration * sourceRate) return { done: true };
            const first = index++ * packetFrames, stamp = origin + first / sourceRate;
            return { done: false, value: { timestamp: quantize ? Math.round(stamp * 1e6) / 1e6 : stamp,
              duration: packetFrames / sourceRate, buffer: { sampleRate: sourceRate, numberOfChannels: 2, length: packetFrames,
                duration: packetFrames / sourceRate, getChannelData: channel => Float32Array.from({ length: packetFrames }, (_, i) => urlAudioSample(first + i, channel, sourceRate)) } } };
          } };
        }
      }
      const media = createMediaEngine(null, { library: { Input, AudioBufferSink, UrlSource: class {}, ALL_FORMATS: [] }, AudioContext: Context,
        presenter: { present() {}, clear() {}, dispose() {} }, now: () => wall,
        requestFrame: callback => { callbacks.set(++next, callback); return next; }, cancelFrame: id => callbacks.delete(id) });
      try {
        await media.load('https://fixture.test/continuous-url-audio.mp4'); await flush();
        const playing = media.play(); void playing.catch(() => {}); await flush();
        const jitter = [1 / 60, 0.0166, 0.0167, 0.02, 0.0133];
        for (let tick = 0; tick < 220 && media.currentTime < 2; tick++) {
          wall += jitter[tick % jitter.length]; const graphRate = offline?.sampleRate || contextRate;
          audioClock = Math.floor(wall * graphRate / 128) * 128 / graphRate;
          const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(); await flush();
        }
        await playing;
        const anchor = sources[0]?.time;
        if (!Number.isFinite(anchor) || media.error) throw new Error('URL engine did not schedule available PCM');
        const nativeGraphRate = offline.sampleRate;
        let actual = await offline.startRendering();
        if (nativeGraphRate !== contextRate) {
          // A source-rate context reaches the output device through one continuous resampler.
          // Reproduce that boundary once for the complete rendered graph, not once per source node.
          const deviceEquivalent = new OfflineAudioContext(2, contextRate * 3, contextRate);
          const wholeGraph = deviceEquivalent.createBufferSource(); wholeGraph.buffer = actual;
          wholeGraph.connect(deviceEquivalent.destination); wholeGraph.start();
          actual = await deviceEquivalent.startRendering();
        }
        const referenceContext = new OfflineAudioContext(2, contextRate * 3, contextRate);
        const referenceBuffer = referenceContext.createBuffer(2, sourceRate * duration, sourceRate);
        for (let channel = 0; channel < 2; channel++) referenceBuffer.copyToChannel(Float32Array.from({ length: sourceRate * duration }, (_, frame) => urlAudioSample(frame, channel, sourceRate)), channel);
        const referenceSource = referenceContext.createBufferSource(); referenceSource.buffer = referenceBuffer;
        referenceSource.connect(referenceContext.destination); referenceSource.start(anchor);
        const reference = await referenceContext.startRendering();
        const left = actual.getChannelData(0), right = actual.getChannelData(1), expected = reference.getChannelData(0), expectedRight = reference.getChannelData(1);
        let errorEnergy = 0, energy = 0, maximumError = 0, maximumStepResidual = 0, zeroFrames = 0, maximumZeroRun = 0, zeroRun = 0;
        const first = Math.round((anchor + 0.1) * contextRate), last = Math.round((anchor + 1.8) * contextRate);
        for (let frame = first; frame < last; frame++) {
          const error = left[frame] - expected[frame]; errorEnergy += error ** 2; energy += expected[frame] ** 2;
          maximumError = Math.max(maximumError, Math.abs(error));
          maximumStepResidual = Math.max(maximumStepResidual, Math.abs(left[frame] - left[frame - 1] - expected[frame] + expected[frame - 1]));
          if (Math.abs(left[frame]) < 1e-9 && Math.abs(right[frame]) < 1e-9 && Math.abs(expectedRight[frame]) > 1e-6) { zeroFrames++; maximumZeroRun = Math.max(maximumZeroRun, ++zeroRun); }
          else zeroRun = 0;
        }
        const relativeErrorDb = errorEnergy ? 10 * Math.log10(errorEnergy / energy) : -300;
        const requestedContextRate = constructorOptions[0]?.sampleRate;
        return { sourceRate, outputRate: contextRate, requestedContextRate: requestedContextRate ?? null, nativeGraphRate,
          quantize, graphNodes: sources.length, measuredSeconds: (last - first) / contextRate,
          maximumError, maximumStepResidual, zeroFrames, maximumZeroRun, relativeErrorDb,
          signalPreserved: requestedContextRate === sourceRate && nativeGraphRate === sourceRate
            && zeroFrames === 0 && relativeErrorDb < -70 && maximumStepResidual < 0.001 };
      } finally { media.dispose(); }
    }, { sourceRate, contextRate, quantize });
    results.push(result); console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  assert.ok(results.every(result => result.signalPreserved), 'Production URL AudioBufferSource graph differs from native whole-buffer reference');
  console.log(JSON.stringify({ browser: await browser.version(), result: 'URL audio signal checks passed' }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
