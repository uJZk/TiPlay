/*! SPDX-License-Identifier: GPL-3.0-only */
import { presentationTime } from './clock-sync.js';
import { readAudioRecords } from './audio-protocol.js';
import { initialPlaybackPlans } from './playback-window.js';

const MAX_AUDIO_AHEAD_BYTES = 1024 * 1024;

/** Playback only. Android owns demand-driven car Bluetooth capture and speech playback. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {}, onTiming = () => {}, onQueued = () => {}, onMode = () => {} }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, voiceRevision = null, voiceState = 'idle', voiceError = null;
  let queuedBytes = 0, capacity = null, audioError = null, disposed = false;
  let retryTimer = null;
  let clock = null, delayPlans = initialPlaybackPlans(), timedPackets = 0, fallbackPackets = 0;
  const plansByMode = {};
  let clockBase = null, playbackGeneration = 0;
  const snapshot = () => ({ supported: support, enabled, sound: context?.state === 'running',
    bluetooth: voiceState, browserMuted: false, error: voiceError ?? audioError,
    timedPackets, fallbackPackets, queuedBytes });
  const notify = () => onState(snapshot());
  const auth = () => { const { code, session } = credentials(); return `c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}`; };
  // Android separates speech from music; Bluetooth state never resets or mutes browser playback.
  function route(next) {
    if (!next || !Number.isInteger(next.revision)) return;
    if (voiceRevision !== null && ((next.revision - voiceRevision) | 0) < 0) return;
    voiceRevision = next.revision;
    if (next.state) voiceState = next.state;
    if ('error' in next) voiceError = next.error;
    notify();
  }
  function stopStream() {
    playbackGeneration++; clockBase = null;
    clearTimeout(retryTimer); retryTimer = null;
    request?.abort(); request = null;
    node?.port.postMessage({ reset: true });
    queuedBytes = 0; capacity?.(); capacity = null;
  }
  async function stream(signal) {
    stopStream();
    if (!support || !enabled || !node || context.state !== 'running' || !signal || signal.aborted) return;
    const abort = request = new AbortController();
    const stop = () => abort.abort();
    signal.addEventListener('abort', stop, { once: true });
    try {
      const response = await fetchPhone(`/audio?${auth()}`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
      audioError = null; notify();
      for await (const record of readAudioRecords(response.body)) {
        if (abort.signal.aborted) break;
        if (record.type === 5) { route({ revision: record.epoch }); continue; }
        // Read through the producer's two-second music lead so the same HTTP stream
        // can deliver a following navigation/call packet without waiting for music.
        while ((record.flags & 1) && queuedBytes >= MAX_AUDIO_AHEAD_BYTES && !abort.signal.aborted) {
          await new Promise(resolve => { capacity = resolve; });
        }
        if (abort.signal.aborted) break;
        if (record.pcm.byteLength) onMode(record.mode);
        record.sourceTime = presentationTime(record.presentationMs, clock);
        const hasPcm = record.pcm.byteLength > 0;
        if (hasPcm) {
          if (Number.isFinite(record.sourceTime)) { timedPackets++; onTiming(record.sourceTime, record.mode); }
          else fallbackPackets++;
        }
        clockBase ??= performance.timeOrigin + performance.now() - context.currentTime * 1000;
        node.port.postMessage({ plans: delayPlans, plansByMode, clockBase });
        record.generation = playbackGeneration;
        queuedBytes += record.pcm.byteLength;
        node.port.postMessage(record, [record.pcm]);
        if (hasPcm) onQueued(record.mode);
      }
    } catch (failure) {
      if (!abort.signal.aborted) { audioError = String(failure.message); notify(); }
    } finally {
      signal.removeEventListener('abort', stop);
      if (request === abort) {
        request = null; node?.port.postMessage({ reset: true }); queuedBytes = 0;
        if (!abort.signal.aborted && connection === signal && enabled) retryTimer = setTimeout(() => stream(signal), 1000);
      }
    }
  }
  async function activate() {
    if (disposed) return;
    try {
      // Creating/resuming the context happens before awaiting, preserving user activation.
      context ??= new AudioContext({ latencyHint: 'interactive' });
      const resumed = context.resume();
      ready ??= context.audioWorklet.addModule(new URL('audio-worklet.js', import.meta.url)).then(() => {
        if (disposed) return;
        node = new AudioWorkletNode(context, 'tiplay-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        node.connect(context.destination);
        node.port.onmessage = ({ data }) => {
          if (data.consumed && data.generation === playbackGeneration) {
            queuedBytes = Math.max(0, queuedBytes - data.consumed); capacity?.(); capacity = null;
          }
        };
      });
      // Load the worklet even while autoplay waits for the first gesture.
      Promise.all([ready, resumed]).then(() => { if (!disposed) { audioError = null; stream(connection); notify(); } }).catch(failure => { if (!disposed) { audioError = failure.message; notify(); } });
      await ready;
      if (disposed) return;
      notify();
    } catch (failure) { if (!disposed) { audioError = failure.message; notify(); } }
  }
  return {
    activate, stats: snapshot,
    clock(value) { clock = value; },
    delay(value, mode) {
      if (mode) plansByMode[mode] = value;
      else delayPlans = value;
      node?.port.postMessage({ plans: delayPlans, plansByMode });
    },
    reset() { playbackGeneration++; clockBase = null; queuedBytes = 0; node?.port.postMessage({ reset: true }); capacity?.(); capacity = null; },
    start() { activate(); },
    gesture() { if (!disposed && context?.state !== 'running') activate(); },
    attach(signal, hello) {
      this.stop(); voiceRevision = null; connection = signal; support = hello.audio === true;
      signal.addEventListener('abort', () => { if (connection === signal) this.stop(); }, { once: true });
      stream(signal); notify();
    },
    status(status) {
      const changed = enabled !== (status.audio !== false);
      enabled = status.audio !== false;
      route(status.voice);
      if (!enabled) stopStream();
      else if (changed) stream(connection);
      notify();
    },
    stop() { connection = null; stopStream(); voiceError = null; voiceState = 'idle'; notify(); },
    dispose() { disposed = true; this.stop(); context?.close().catch(() => {}); context = null; ready = null; node = null; },
  };
}
