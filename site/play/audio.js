/*! SPDX-License-Identifier: GPL-3.0-only */
import { presentationTime } from './clock-sync.js';
import { readAudioRecords } from './audio-protocol.js';
import { initialPlaybackPlans } from './playback-window.js';
import { createAirPlayAudioDecoder } from './airplay-audio-decoder.js';
import { MAX_AUDIO_AHEAD_BYTES, MAX_DECODED_PACKET_BYTES } from './audio-buffer-policy.js';
import { pcmStats, measurePcm } from './audio-pcm-stats.js';

/** Playback only. Android owns demand-driven car Bluetooth capture and speech playback. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {}, onTiming = () => {}, onQueued = () => {}, onMode = () => {} }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, voiceRevision = null, voiceState = 'idle', voiceError = null;
  let queuedBytes = 0, capacity = null, audioError = null, disposed = false;
  let retryTimer = null;
  let clock = null, delayPlans = initialPlaybackPlans(), timedPackets = 0, fallbackPackets = 0;
  let clockBase = null, playbackGeneration = 0;
  let debugEnabled = false, pcmMetrics = null, workletMetrics = null, reportAt = null;
  let diagnosticRevision = 0;
  let processorErrors = 0, recoveries = 0, processorFailed = false, recoveryAttempts = 0, recoveryTimer = null;
  const plansByMode = {};
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
  const now = () => performance.timeOrigin + performance.now();
  const debugSnapshot = () => ({
    processorErrors, recoveries, processorFailed, recoveryAttempts,
    contextState: context?.state ?? 'unavailable', contextTimeMs: context ? context.currentTime * 1000 : null,
    contextRate: context?.sampleRate ?? null, contextBaseLatencyMs: context?.baseLatency * 1000,
    contextOutputLatencyMs: context?.outputLatency * 1000, clockBase,
    clockOffsetMs: clock?.offset ?? null, clockAgeMs: clock ? now() - clock.at : null, clockRttMs: clock?.rtt ?? null,
    pcmPackets: pcmMetrics?.packets ?? 0, pcmFrames: pcmMetrics?.frames ?? 0,
    pcmNonzero: pcmMetrics?.nonzero ?? 0, pcmPeak: pcmMetrics?.peak ?? 0,
    ...workletMetrics,
    renderReportAgeMs: reportAt === null ? null : now() - reportAt,
    renderAgeMs: clockBase !== null && workletMetrics ? now() - clockBase - workletMetrics.renderTimeMs : null,
    decoder: packetDecoder.stats(),
  });
  const snapshot = () => ({ supported: support, enabled, sound: context?.state === 'running',
    bluetooth: voiceState, browserMuted: false, error: voiceError ?? audioError,
    timedPackets, fallbackPackets, queuedBytes, processorErrors, recoveries, processorFailed,
    ...(debugEnabled ? { debug: debugSnapshot() } : {}) });
  const notify = () => onState(snapshot());
  const auth = () => { const { code, session } = credentials(); return `c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}`; };
  function debug(value) {
    const next = value === true;
    if (next === debugEnabled) return;
    debugEnabled = next; diagnosticRevision++; pcmMetrics = next ? pcmStats() : null; workletMetrics = null; reportAt = null;
    packetDecoder.debug(next); node?.port.postMessage({ debug: next, diagnosticRevision }); notify();
  }
  function retireNode() {
    if (!node) return;
    node.onprocessorerror = null; node.port.onmessage = null;
    node.disconnect?.(); node = null; workletMetrics = null; reportAt = null;
  }
  function recoverProcessor() {
    if (disposed || !connection || connection.aborted || !enabled || context?.state !== 'running') return;
    if (recoveryAttempts >= 2) { audioError = 'Audio processor failed repeatedly.'; notify(); return; }
    recoveryAttempts++;
    const expected = connection;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (disposed || connection !== expected || expected.aborted || !enabled) return;
      try {
        installNode(); recoveries++; processorFailed = false;
        stream(expected); notify();
      } catch (_) { retireNode(); audioError = 'Audio processor could not restart.'; recoverProcessor(); notify(); }
    }, 100);
  }
  function installNode() {
    const installed = new AudioWorkletNode(context, 'tiplay-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node = installed; installed.connect(context.destination);
    installed.port.onmessage = ({ data }) => {
      if (disposed || node !== installed) return;
      if (data.consumed && data.generation === playbackGeneration) {
        queuedBytes = Math.max(0, queuedBytes - data.consumed); capacity?.(); capacity = null;
      }
      if (debugEnabled && data.diagnosticRevision === diagnosticRevision && data.diagnostics) { workletMetrics = data.diagnostics; reportAt = now(); }
    };
    installed.onprocessorerror = () => {
      if (disposed || node !== installed) return;
      processorErrors++; processorFailed = true; audioError = 'Audio processor failed.';
      stopStream(); retireNode(); recoverProcessor(); notify();
    };
    installed.port.postMessage({ debug: debugEnabled, diagnosticRevision });
  }
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
    packetDecoder.reset();
    releaseEncoded();
    playbackGeneration++; clockBase = null;
    clearTimeout(retryTimer); retryTimer = null;
    request?.abort(); request = null;
    node?.port.postMessage({ reset: true });
    queuedBytes = 0; capacity?.(); capacity = null;
  }
  function publishPcm(record) {
    if (pcmMetrics) measurePcm(pcmMetrics, record.pcm, record.channels);
    if (disposed || !node || context?.state !== 'running') return;
    if (!record.pcm.byteLength && record.flags & 2) encodedReservations.delete(record.type);
    else if (record.flags & 1) releaseEncoded(record.type);
    if (record.flags & 1 && queuedBytes + record.pcm.byteLength > MAX_AUDIO_AHEAD_BYTES) throw new Error('Decoded buffered audio exceeds its playback memory limit.');
    if (record.pcm.byteLength) onMode(record.mode);
    record.sourceTime = presentationTime(record.presentationMs, clock);
    const hasPcm = record.pcm.byteLength > 0;
    if (hasPcm) {
      if (Number.isFinite(record.sourceTime)) { timedPackets++; onTiming(record.sourceTime, record.mode); }
      else fallbackPackets++;
    }
    clockBase ??= now() - context.currentTime * 1000;
    node.port.postMessage({ plans: delayPlans, plansByMode, clockBase });
    record.generation = playbackGeneration;
    queuedBytes += record.pcm.byteLength;
    node.port.postMessage(record, [record.pcm]);
    if (hasPcm) onQueued(record.mode);
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
        if (record.kind === 2 && record.type === 5) { route({ revision: record.epoch }); continue; }
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
    clearTimeout(recoveryTimer); recoveryTimer = null;
    try {
      // Creating/resuming the context happens before awaiting, preserving user activation.
      context ??= new AudioContext({ latencyHint: 'interactive' });
      const resumed = context.resume();
      ready ??= context.audioWorklet.addModule(new URL('audio-worklet.js', import.meta.url)).then(() => {
        if (disposed) return;
        installNode();
      });
      // Load the worklet even while autoplay waits for the first gesture.
      Promise.all([ready, resumed]).then(() => { if (!disposed) {
        if (!node) installNode();
        processorFailed = false; audioError = null; stream(connection); notify();
      } }).catch(failure => { if (!disposed) { audioError = failure.message; notify(); } });
      await ready;
      if (disposed) return;
      notify();
    } catch (failure) { if (!disposed) { audioError = failure.message; notify(); } }
  }
  return {
    activate, debug, stats: snapshot,
    clock(value) { clock = value; },
    delay(value, mode) {
      if (mode) plansByMode[mode] = value;
      else delayPlans = value;
      node?.port.postMessage({ plans: delayPlans, plansByMode });
    },
    reset() { packetDecoder.reset(); releaseEncoded(); playbackGeneration++; clockBase = null; queuedBytes = 0; node?.port.postMessage({ reset: true }); capacity?.(); capacity = null; },
    start() { activate(); },
    gesture() { if (!disposed && (context?.state !== 'running' || processorFailed)) { recoveryAttempts = 0; activate(); } },
    attach(signal, hello) {
      this.stop(); voiceRevision = null; connection = signal; support = hello.audio === true;
      recoveryAttempts = 0;
      signal.addEventListener('abort', () => { if (connection === signal) this.stop(); }, { once: true });
      if (!node && processorFailed) activate(); else stream(signal);
      notify();
    },
    status(status) {
      debug(status.debug);
      const changed = enabled !== (status.audio !== false);
      enabled = status.audio !== false;
      route(status.voice);
      if (!enabled) stopStream();
      else if (changed) {
        if (!node && processorFailed) { recoveryAttempts = 0; activate(); }
        else stream(connection);
      }
      notify();
    },
    stop() { clearTimeout(recoveryTimer); recoveryTimer = null; connection = null; stopStream(); voiceError = null; voiceState = 'idle'; notify(); },
    dispose() { disposed = true; this.stop(); retireNode(); packetDecoder.dispose(); context?.close().catch(() => {}); context = null; ready = null; },
  };
}
