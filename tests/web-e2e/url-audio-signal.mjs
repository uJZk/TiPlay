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
    headless: true, args: ['--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
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
          node.start = (time, ...args) => { sources.push({ time, node }); start(time, ...args); };
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
  // Unlike the preceding Offline cases, the render clock and worklet keep
  // advancing while a real rAF callback is deliberately held on the main thread.
  // The capture observes native graph PCM before the OS/device output stage; it
  // cannot establish what a physical speaker emitted or diagnose device xruns.
  for (const sourceRate of [44100, 48000]) {
    const result = await page.evaluate(async sourceRate => {
      const { createMediaEngine } = await import('/airplay-media.js');
      const { createUrlAudioSchedulingFixture, urlAudioSample } = await import('/signal-fixture.mjs');
      const chunks = [];
      let h, fault = null, capture, capturedSignalFrames = 0;
      const moduleUrl = URL.createObjectURL(new Blob([`
        class Capture extends AudioWorkletProcessor {
          constructor() { super(); this.offset = 0; this.left = new Float32Array(2048); this.right = new Float32Array(2048); }
          process(inputs, outputs) {
            const input = inputs[0], output = outputs[0], frames = output[0].length;
            if (!this.offset) this.firstFrame = currentFrame;
            for (let channel = 0; channel < 2; channel++) {
              const data = input[channel], target = channel ? this.right : this.left;
              if (data) { target.set(data, this.offset); output[channel].set(data); }
              else target.fill(0, this.offset, this.offset + frames);
            }
            this.offset += frames;
            if (this.offset === this.left.length) {
              this.port.postMessage({ firstFrame: this.firstFrame, left: this.left, right: this.right }, [this.left.buffer, this.right.buffer]);
              this.offset = 0; this.left = new Float32Array(2048); this.right = new Float32Array(2048);
            }
            return true;
          }
        }
        registerProcessor('url-audio-capture', Capture);
      `], { type: 'text/javascript' }));
      // Install the monitor before the production graph exists. With autoplay
      // enabled Chrome may create a running context and never call resume().
      const nativeContext = new AudioContext({ sampleRate: sourceRate, latencyHint: 'interactive' });
      await nativeContext.audioWorklet.addModule(moduleUrl);
      capture = new AudioWorkletNode(nativeContext, 'url-audio-capture', { numberOfInputs: 1, numberOfOutputs: 1,
        channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2] });
      capture.port.onmessage = event => {
        chunks.push(event.data);
        for (const value of event.data.right) if (value > 0) capturedSignalFrames++;
      };
      capture.connect(nativeContext.destination);
      class CapturingContext {
        constructor(options) {
          if (options.sampleRate !== nativeContext.sampleRate) throw new Error('Prepared capture has a different audio format');
        }
        get sampleRate() { return nativeContext.sampleRate; }
        get currentTime() { return nativeContext.currentTime; }
        get state() { return nativeContext.state; }
        get destination() { return capture; }
        get baseLatency() { return nativeContext.baseLatency; }
        get outputLatency() { return nativeContext.outputLatency; }
        getOutputTimestamp() { return nativeContext.getOutputTimestamp(); }
        addEventListener(...args) { return nativeContext.addEventListener(...args); }
        createGain() { return nativeContext.createGain(); }
        createBuffer(...args) { return nativeContext.createBuffer(...args); }
        createBufferSource() { return nativeContext.createBufferSource(); }
        resume() { return nativeContext.resume(); }
        close() { return nativeContext.close(); }
      }
      const waitFor = async condition => {
        const deadline = performance.now() + 7000;
        while (!condition()) {
          if (performance.now() > deadline) throw new Error('Realtime URL audio capture timed out');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      h = createUrlAudioSchedulingFixture(createMediaEngine, { sampleRate: sourceRate, duration: 4, AudioContext: CapturingContext,
        now: () => performance.now() / 1000,
        requestFrame: callback => requestAnimationFrame(timestamp => {
          if (!fault && capturedSignalFrames >= 2048 && h.media.currentTime >= 0.5 && h.nodes.length) {
            const context = h.context(), tail = Math.max(...h.nodes.map(node => node.time + node.buffer.duration));
            const target = Math.ceil((tail + 0.005) * sourceRate / 128) * 128 / sourceRate;
            const deadline = performance.now() + 1200;
            // The worklet renders independently during this deliberately bounded
            // main-thread task. Native clock granularity and OS scheduling need
            // not reproduce Node's exact 5–10ms grace-window fault. Cache the
            // final clock observation rather than making an additional read.
            let observedClock = context.currentTime;
            while (observedClock < target && performance.now() < deadline) observedClock = context.currentTime;
            fault = { tail, lateMs: (observedClock - tail) * 1000 };
          }
          callback(timestamp);
        }), cancelFrame: id => cancelAnimationFrame(id) });
      try {
        await h.media.load('https://fixture.test/realtime-url-audio.mp4');
        const playing = h.media.play(); void playing.catch(() => {});
        await waitFor(() => fault && capturedSignalFrames > sourceRate + 2048 && h.media.currentTime >= 1.15);
        await playing;
        await new Promise(resolve => setTimeout(resolve, 80));
        const state = h.media.getPlaybackDiagnostics();
        let previous = null, skippedFrames = 0, repeatedFrames = 0, signalErrors = 0, measuredFrames = 0;
        let silenceRun = 0, totalSilenceFrames = 0, maximumSilenceFrames = 0, started = false;
        for (const chunk of chunks.sort((a, b) => a.firstFrame - b.firstFrame)) for (let index = 0; index < chunk.right.length; index++) {
          const identity = Math.round(chunk.right[index] * 2 ** 20) - 1;
          if (identity < 0) { if (started) silenceRun++; continue; }
          started = true; maximumSilenceFrames = Math.max(maximumSilenceFrames, silenceRun);
          totalSilenceFrames += silenceRun; silenceRun = 0;
          if (previous !== null) {
            skippedFrames += Math.max(0, identity - previous - 1);
            repeatedFrames += Math.max(0, previous - identity + 1);
          }
          if (Math.abs(chunk.left[index] - Math.fround(urlAudioSample(identity, 0, sourceRate))) > 1e-5) signalErrors++;
          previous = identity; measuredFrames++;
        }
        return { oracle: 'realtime AudioContext graph PCM captured on its independent AudioWorklet render thread',
          physicalOutputObserved: false, sourceRate, contextRate: h.context().sampleRate, lateMs: fault.lateMs,
          measuredFrames, skippedFrames, repeatedFrames, signalErrors, maximumSilenceMs: maximumSilenceFrames / sourceRate * 1000,
          renderedSilenceMs: totalSilenceFrames / sourceRate * 1000,
          audioScheduleUnderruns: state.audioScheduleUnderruns, audioScheduleUnderrunMs: state.audioScheduleUnderrunMs,
          stallCount: state.stallCount };
      } finally {
        h.media.dispose(); capture?.disconnect();
        if (nativeContext.state !== 'closed') await nativeContext.close();
        URL.revokeObjectURL(moduleUrl);
      }
    }, sourceRate);
    console.log(JSON.stringify(result));
    assert.equal(result.contextRate, sourceRate);
    assert.ok(result.lateMs > 0, 'the injected task must exhaust the submitted graph');
    assert.ok(result.measuredFrames > sourceRate, 'capture must include stable playback before and after the task');
    assert.equal(result.skippedFrames, 0); assert.equal(result.repeatedFrames, 0); assert.equal(result.signalErrors, 0);
    assert.ok(result.maximumSilenceMs > 0, 'the task must exhaust the submitted graph');
    assert.ok(result.audioScheduleUnderruns >= 1, 'native graph underrun must have diagnostic evidence');
    assert.ok(Math.abs(result.renderedSilenceMs - result.audioScheduleUnderrunMs) < 2 * 128 / sourceRate * 1000,
      'rendered silence and planned underrun must agree within two render quanta');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: await browser.version(), result: 'URL audio signal checks passed' }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
