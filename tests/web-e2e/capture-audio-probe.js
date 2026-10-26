// SPDX-License-Identifier: GPL-3.0-only
import { createBrowserAudio } from '/play/audio.js';
import { loadAudioCore } from '/play/wasm/audio-core.js';
import { constantDelay } from '/play/delay-plan.js';
import { createCaptureReplay } from '/e2e/capture-replay.mjs';

const config = await (await fetch('/fixture.json')).json();
const payload = new Uint8Array(await (await fetch('/audio.bin')).arrayBuffer());
const NativeAudioContext = globalThis.AudioContext;
const nativeConnect = AudioNode.prototype.connect;
let signalTap = null;
if (config.captureWaveform) AudioNode.prototype.connect = function(destination, ...rest) {
  const tap = this.context.__captureOutput;
  if (tap && this !== tap && this instanceof AudioWorkletNode && destination === this.context.destination) {
    nativeConnect.call(this, tap, ...rest); return destination;
  }
  return nativeConnect.call(this, destination, ...rest);
};
globalThis.AudioContext = class extends NativeAudioContext {
  constructor(options) {
    super({ ...options, sampleRate: config.contextRate });
    if (config.captureWaveform) {
      const add = this.audioWorklet.addModule.bind(this.audioWorklet), chunks = [];
      let finish;
      const ready = add('/e2e/capture-output-worklet.js').then(() => {
        const tap = this.__captureOutput = new AudioWorkletNode(this, 'capture-output', { outputChannelCount: [2] });
        tap.port.onmessage = ({ data }) => { if (data.pcm) chunks.push(data); if (data.done) finish?.(); };
        nativeConnect.call(tap, this.destination);
        signalTap = { flush: () => new Promise(resolve => { finish = resolve; tap.port.postMessage({ flush: true }); }),
          snapshot: () => ({ sampleRate: this.sampleRate, channels: 2,
            chunks: chunks.map(({ pcm, ...rest }) => ({ ...rest, base64: btoa(String.fromCharCode(...new Uint8Array(pcm))) })) }) };
      });
      this.audioWorklet.addModule = async url => { await ready; return add(url); };
    }
  }
};
await loadAudioCore();
let audio, replay, stop, ticker, sampler;
globalThis.captureReady = true;
globalThis.captureResult = null;
document.getElementById('start').onclick = async () => {
  const errors = [], snapshots = [];
  const referenceEvents = [], lastReferenceStates = new Map();
  let playingReferences = 0;
  stop = new AbortController();
  audio = createBrowserAudio({ credentials: () => ({}), fetchPhone: () => { throw Error('Unexpected phone fetch'); },
    onState: state => { if (state.error && !errors.includes(state.error)) errors.push(state.error); },
    onAudioReference: reference => {
      if (reference?.state === 'playing') playingReferences++;
      if (!config.captureWaveform || !reference) return;
      const key = `${reference.mode}:${reference.type}`;
      const values = Object.fromEntries(['type', 'epoch', 'generation', 'state', 'contextTimeMs',
        'sourceDeadlineRejectedFrames', 'lastRecoveryReason', 'sourceDeadlineState'].map(k => [k, reference[k]]));
      const signature = JSON.stringify({ ...values, contextTimeMs: null });
      if (lastReferenceStates.get(key) !== signature) { referenceEvents.push(values); lastReferenceStates.set(key, signature); }
    } });
  audio.status({ audio: true, debug: config.debug });
  await audio.activate();
  const start = performance.now() + 250, localOrigin = performance.timeOrigin + start;
  const sourceOrigin = config.originEpochMillis + config.startMs - config.clockOffsetMs;
  const clock = () => ({ version: 2, generation: 1, serverOriginMs: sourceOrigin, localOriginMs: localOrigin,
    rate: 1, offset: localOrigin - sourceOrigin, at: performance.timeOrigin + performance.now(),
    rtt: 6, uncertaintyMs: 5, offsetConfidence: 1, rateConfidence: 1, state: 'tracking' });
  audio.clock(clock());
  audio.delay({ audio: constantDelay(config.delayMs), video: constantDelay(0) }, 'carplay');
  replay = createCaptureReplay({ events: config.events, startAtMs: start, signal: stop.signal, holdOpenAtEnd: true,
    readRange: async (offset, length) => payload.subarray(offset, offset + length) });
  audio.attach(stop.signal, { audio: true }, () => replay.stream);
  ticker = setInterval(() => audio.clock(clock()), 250);
  sampler = setInterval(() => snapshots.push({ elapsedMs: performance.now() - start, audio: audio.stats() }), 1000);
  globalThis.captureStarted = true;
  setTimeout(async () => {
    const result = { errors, snapshots, playingReferences, replay: replay.stats(), final: audio.stats(),
      boundary: 'Captured encoded audio and Android send timing, desktop native output clock; no original video/network replay.' };
    clearInterval(ticker); clearInterval(sampler);
    if (signalTap) {
      await signalTap.flush();
      result.waveform = signalTap.snapshot(); result.referenceEvents = referenceEvents;
    }
    stop.abort(); audio.dispose();
    globalThis.captureResult = result;
  }, config.durationMs + 250);
};
