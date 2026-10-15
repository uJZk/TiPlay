/*! SPDX-License-Identifier: GPL-3.0-only */
import { presentationTime } from './clock-sync.js';
import { readAudioRecords } from './audio-protocol.js';
import { initialPlaybackPlans } from './playback-window.js';
import { createAirPlayAudioDecoder } from './airplay-audio-decoder.js';

const MAX_AUDIO_AHEAD_BYTES = 1024 * 1024;
const MAX_DECODED_PACKET_BYTES = 64 * 1024;

/** Playback only. Android owns demand-driven car Bluetooth capture and speech playback. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {}, onTiming = () => {}, onQueued = () => {}, onMode = () => {} }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, voiceMuted = false, voiceRevision = null, voiceState = 'idle', voiceError = null;
  let queuedBytes = 0, capacity = null, audioError = null, disposed = false;
  let retryTimer = null;
  let clock = null, delayPlans = initialPlaybackPlans(), timedPackets = 0, fallbackPackets = 0;
  let clockBase = null, playbackGeneration = 0;
  const encodedReservations = new Map();
  const reservedBytes = () => [...encodedReservations.values()].reduce((total, bytes) => total + bytes, 0);
  const releaseEncoded = type => {
    if (type === undefined) encodedReservations.clear();
    else encodedReservations.set(type, Math.max(0, (encodedReservations.get(type) || 0) - MAX_DECODED_PACKET_BYTES));
    capacity?.(); capacity = null;
  };
  const packetDecoder = createAirPlayAudioDecoder({
    onPcm: record => publishPcm(record),
    onError: cause => { releaseEncoded(); audioError = cause.message || String(cause); notify(); },
  });
  const snapshot = () => ({ supported: support, enabled, sound: !voiceMuted && context?.state === 'running',
    bluetooth: voiceState, browserMuted: voiceMuted, error: voiceError ?? audioError,
    timedPackets, fallbackPackets, queuedBytes });
  const notify = () => onState(snapshot());
  const auth = () => { const { code, session } = credentials(); return `c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}`; };
  function route(next, fromRecord = false) {
    if (!next || !Number.isInteger(next.revision)) return;
    if (voiceRevision !== null && ((next.revision - voiceRevision) | 0) < 0) return;
    voiceRevision = next.revision;
    const changed = voiceMuted !== (next.muted === true);
    voiceMuted = next.muted === true;
    if (next.state) voiceState = next.state;
    if ('error' in next) voiceError = next.error;
    if (!voiceMuted) { voiceState = 'idle'; voiceError = null; }
    if (changed) {
      packetDecoder.reset();
      releaseEncoded();
      playbackGeneration++; clockBase = null; queuedBytes = 0;
      node?.port.postMessage({ reset: true, muted: voiceMuted });
      capacity?.(); capacity = null;
      // A status can overtake an HTTP body: retire that body instead of playing its buffered past.
      if (!fromRecord) stream(connection);
    }
    notify();
  }
  function stopStream() {
    packetDecoder.reset();
    releaseEncoded();
    playbackGeneration++; clockBase = null;
    clearTimeout(retryTimer); retryTimer = null;
    request?.abort(); request = null;
    node?.port.postMessage({ reset: true });
    queuedBytes = 0; capacity?.(); capacity = null;
  }
  function publishPcm(record) {
    if (disposed || voiceMuted || !node || context?.state !== 'running') return;
    if (!record.pcm.byteLength && record.flags & 2) encodedReservations.delete(record.type);
    else if (record.flags & 1) releaseEncoded(record.type);
    if (record.flags & 1 && queuedBytes + record.pcm.byteLength > MAX_AUDIO_AHEAD_BYTES) throw new Error('Decoded buffered audio exceeds its playback memory limit.');
    if (record.pcm.byteLength) onMode(record.mode);
    record.sourceTime = presentationTime(record.presentationMs, clock);
    const hasPcm = record.pcm.byteLength > 0;
    if (hasPcm) {
      if (Number.isFinite(record.sourceTime)) { timedPackets++; onTiming(record.sourceTime); }
      else fallbackPackets++;
    }
    clockBase ??= performance.timeOrigin + performance.now() - context.currentTime * 1000;
    node.port.postMessage({ plans: delayPlans, clockBase });
    record.generation = playbackGeneration;
    queuedBytes += record.pcm.byteLength;
    node.port.postMessage(record, [record.pcm]);
    if (hasPcm) onQueued();
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
        if (record.kind === 2 && record.type === 5) { route({ revision: record.epoch, muted: Boolean(record.flags & 16) }, true); continue; }
        if (voiceMuted) continue;
        if (record.kind === 6) {
          const configured = await packetDecoder.configure(record);
          if (!abort.signal.aborted && configured) { audioError = null; notify(); }
          continue;
        }
        if (record.kind === 7) {
          if (record.flags & 1) {
            while (queuedBytes + reservedBytes() + MAX_DECODED_PACKET_BYTES > MAX_AUDIO_AHEAD_BYTES && !abort.signal.aborted) {
              await new Promise(resolve => { capacity = resolve; });
            }
            if (abort.signal.aborted) break;
            encodedReservations.set(record.type, (encodedReservations.get(record.type) || 0) + MAX_DECODED_PACKET_BYTES);
          }
          const accepted = await packetDecoder.decode(record);
          if (!accepted && record.flags & 1) releaseEncoded(record.type);
          continue;
        }
        // A CarPlay stream or an ordinary PCM reset retires late output from the old encoded epoch.
        if ((record.flags & 2) || record.mode === 'carplay') packetDecoder.reset(record.type);
        // Read through the producer's two-second music lead so the same HTTP stream
        // can deliver a following navigation/call packet without waiting for music.
        while ((record.flags & 1) && queuedBytes >= MAX_AUDIO_AHEAD_BYTES && !abort.signal.aborted) {
          await new Promise(resolve => { capacity = resolve; });
        }
        if (abort.signal.aborted) break;
        if (voiceMuted) continue;
        publishPcm(record);
      }
    } catch (failure) {
      if (!abort.signal.aborted) { audioError = String(failure.message); notify(); }
    } finally {
      signal.removeEventListener('abort', stop);
      if (request === abort) {
        packetDecoder.reset();
        releaseEncoded();
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
        node.port.postMessage({ muted: voiceMuted });
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
    delay(value) { delayPlans = value; node?.port.postMessage({ plans: delayPlans }); },
    reset() { packetDecoder.reset(); releaseEncoded(); playbackGeneration++; clockBase = null; queuedBytes = 0; node?.port.postMessage({ reset: true }); capacity?.(); capacity = null; },
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
    stop() { connection = null; stopStream(); voiceMuted = false; voiceError = null; voiceState = 'idle'; node?.port.postMessage({ muted: false }); notify(); },
    dispose() { disposed = true; this.stop(); packetDecoder.dispose(); context?.close().catch(() => {}); context = null; ready = null; node = null; },
  };
}
