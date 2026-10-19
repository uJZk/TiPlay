/*! SPDX-License-Identifier: GPL-3.0-only */
import { presentationTime } from './clock-sync.js';
import { readAudioRecords } from './audio-protocol.js';
import { initialPlaybackPlans } from './playback-window.js';
import { createAirPlayAudioDecoder } from './airplay-audio-decoder.js';
import { MAX_AUDIO_AHEAD_BYTES, MAX_DECODED_PACKET_BYTES } from './audio-buffer-policy.js';
import { pcmStats, measurePcm } from './audio-pcm-stats.js';
import { createAudioOutputMapping } from './audio-output-clock.js';
import { createAudioCalibration } from './audio-calibration.js';

/** Playback only. Android owns demand-driven car Bluetooth capture and speech playback. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {}, onTiming = () => {}, onQueued = () => {}, onMode = () => {},
  onAudioReference = () => {} }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, voiceRevision = null, voiceState = 'idle', voiceError = null;
  let queuedBytes = 0, capacity = null, audioError = null, disposed = false;
  let retryTimer = null;
  let clock = null, delayPlans = initialPlaybackPlans(), timedPackets = 0, fallbackPackets = 0;
  let clockBase = null, playbackGeneration = 0;
  let debugEnabled = false, pcmMetrics = null, workletMetrics = null, reportAt = null;
  let diagnosticRevision = 0;
  let processorErrors = 0, recoveries = 0, processorFailed = false, recoveryAttempts = 0, recoveryTimer = null;
  let lastControlAt = -Infinity;
  let preparingNode = null, preparationSequence = 0, pendingPublish = null, pendingPcmBytes = 0, nodeConnected = false;
  let nodeInstallation = null;
  const calibrations = createAudioCalibration();
  const outputClock = createAudioOutputMapping(), playoutReferences = new Map();
  const plansByMode = {};
  const encodedReservations = new Map();
  const reservedBytes = () => [...encodedReservations.values()].reduce((total, bytes) => total + bytes, 0);
  const releaseEncoded = type => {
    if (type === undefined) encodedReservations.clear();
    else encodedReservations.set(type, Math.max(0, (encodedReservations.get(type) || 0) - MAX_DECODED_PACKET_BYTES));
    capacity?.(); capacity = null;
  };
  const packetDecoder = createAirPlayAudioDecoder({
    onPcm: record => { publishPcm(record).catch(cause => {
      if (disposed) return;
      stopStream(); audioError = cause.message || String(cause); notify();
    }); },
    onError: cause => { releaseEncoded(); audioError = cause.message || String(cause); notify(); },
  });
  const now = () => performance.timeOrigin + performance.now();
  const debugSnapshot = () => ({
    processorErrors, recoveries, processorFailed, recoveryAttempts,
    contextState: context?.state ?? 'unavailable', contextTimeMs: context ? context.currentTime * 1000 : null,
    contextRate: context?.sampleRate ?? null, contextBaseLatencyMs: context?.baseLatency * 1000,
    contextOutputLatencyMs: context?.outputLatency * 1000, clockBase,
    clockOffsetMs: clock?.offset ?? null, clockAgeMs: clock ? now() - clock.at : null, clockRttMs: clock?.rtt ?? null,
    clockRatePpm: clock?.rate === undefined ? null : (clock.rate - 1) * 1e6,
    clockGeneration: clock?.generation ?? null, clockUncertaintyMs: clock?.uncertaintyMs ?? null,
    clockRateConfidence: clock?.rateConfidence ?? null,
    deviceClockRatePpm: outputClock.deviceClock().ratePpm, deviceClockTargetRatePpm: outputClock.deviceClock().targetRatePpm,
    deviceClockConfidence: outputClock.deviceClock().confidence, deviceClockUncertaintyMs: outputClock.deviceClock().uncertaintyMs,
    deviceClockGeneration: outputClock.deviceClock().generation, deviceClockReason: outputClock.deviceClock().reason,
    ...outputClock.diagnostics(),
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
  function relativeClock() {
    if (!clock) return null;
    const origin = performance.timeOrigin;
    return clock.version === 2 ? { ...clock, localOriginMs: clock.localOriginMs - origin, at: clock.at - origin }
      : { version: 2, generation: 0, serverOriginMs: 0, localOriginMs: clock.offset - origin,
        rate: 1, at: clock.at - origin };
  }
  function controls(force = false) {
    if (!node || !context) return;
    const at = now();
    if (!force && at - lastControlAt < 20) return;
    lastControlAt = at;
    const output = outputClock.capture(context);
    node.port.postMessage({ clock: relativeClock(),
      deviceClock: outputClock.deviceClock(),
      contextAnchor: output ? { contextTimeMs: output.contextTimeMs, localTimeMs: output.performanceTimeMs - performance.timeOrigin } : null,
      outputLatencyMs: output?.outputLatencyMs ?? null, outputUncertaintyMs: output?.uncertaintyMs ?? null,
      localTimeOriginMs: performance.timeOrigin, suspended: context.state !== 'running',
      plans: delayPlans, plansByMode });
  }
  function invalidateOutput(state, clear = false) {
    outputClock.reset();
    if (clear) { playoutReferences.clear(); onAudioReference(null); return; }
    for (const [key, previous] of playoutReferences) {
      const reference = { ...previous, state, playoutState: state, audibleTimeMs: null, at: now() };
      playoutReferences.set(key, reference); onAudioReference(reference);
    }
  }
  function debug(value) {
    const next = value === true;
    if (next === debugEnabled) return;
    debugEnabled = next; diagnosticRevision++; pcmMetrics = next ? pcmStats() : null; workletMetrics = null; reportAt = null;
    packetDecoder.debug(next); node?.port.postMessage({ debug: next, diagnosticRevision }); notify();
  }
  function retireNode() {
    nodeConnected = false;
    if (preparingNode) { preparingNode.reject(new Error('Audio preparation was cancelled.')); preparingNode = null; }
    if (!node) return;
    node.onprocessorerror = null; node.port.onmessage = null;
    node.port.postMessage({ dispose: true });
    node.disconnect?.(); node = null; workletMetrics = null; reportAt = null;
    invalidateOutput('output-unavailable');
  }
  function recoverProcessor() {
    if (disposed || !connection || connection.aborted || !enabled || context?.state !== 'running') return;
    if (recoveryAttempts >= 2) { audioError = 'Audio processor failed repeatedly.'; notify(); return; }
    recoveryAttempts++;
    const expected = connection;
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      if (disposed || connection !== expected || expected.aborted || !enabled) return;
      try {
        await installNode();
        if (disposed || connection !== expected || expected.aborted || !enabled) return;
        recoveries++; processorFailed = false;
        stream(expected); notify();
      } catch (_) {
        if (disposed) return;
        audioError = 'Audio processor could not restart.'; recoverProcessor(); notify();
      }
    }, 100);
  }
  function installNode() {
    if (nodeConnected) return Promise.resolve();
    if (!nodeInstallation) nodeInstallation = prepareNode().finally(() => { nodeInstallation = null; });
    return nodeInstallation;
  }
  async function prepareNode() {
    const calibration = await calibrations.prepare(48000, context.sampleRate || 48000);
    if (disposed || !context) return;
    const installed = new AudioWorkletNode(context, 'tiplay-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node = installed; nodeConnected = false;
    const id = ++preparationSequence;
    let resolve, reject, connected = false;
    const prepared = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timeout = setTimeout(() => reject(new Error('Audio processor preparation timed out.')), 10000);
    preparingNode = { installed, reject };
    installed.port.onmessage = ({ data }) => {
      if (disposed || node !== installed) return;
      if (data.prepared === id) resolve();
      if (data.prepareError === id) reject(new Error(data.error || 'Audio processor preparation failed.'));
      if (data.consumed && data.generation === playbackGeneration) {
        queuedBytes = Math.max(0, queuedBytes - data.consumed); capacity?.(); capacity = null;
      }
      if (debugEnabled && data.diagnosticRevision === diagnosticRevision && data.diagnostics) { workletMetrics = data.diagnostics; reportAt = now(); }
      if (data.playout && data.playout.generation === playbackGeneration) {
        const reference = outputClock.reference(data.playout, context);
        if (reference) { playoutReferences.set(`${reference.mode}:${reference.type}`, reference); onAudioReference(reference); }
        controls();
      }
    };
    installed.onprocessorerror = () => {
      if (disposed || node !== installed) return;
      processorErrors++; processorFailed = true; audioError = 'Audio processor failed.';
      if (!connected) { reject(new Error(audioError)); return; }
      stopStream(); retireNode(); recoverProcessor(); notify();
    };
    installed.port.postMessage({ calibration });
    installed.port.postMessage({ prepare: { id, rate: calibration.rate, outputRate: calibration.outputRate } });
    try {
      await prepared;
      if (disposed || node !== installed) return;
      installed.connect(context.destination); connected = true; nodeConnected = true;
    } catch (error) {
      if (node === installed) retireNode();
      throw error;
    } finally { clearTimeout(timeout); if (preparingNode?.installed === installed) preparingNode = null; }
    installed.port.postMessage({ debug: debugEnabled, diagnosticRevision });
    lastControlAt = -Infinity; controls(true);
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
  function stopStream(clearReferences = false, state = 'rebuffering') {
    packetDecoder.reset();
    releaseEncoded();
    playbackGeneration++; clockBase = null;
    if (nodeConnected || pendingPcmBytes) calibrations.cancel();
    pendingPublish = null; pendingPcmBytes = 0;
    clearTimeout(retryTimer); retryTimer = null;
    request?.abort(); request = null;
    node?.port.postMessage({ reset: true });
    queuedBytes = 0; capacity?.(); capacity = null;
    invalidateOutput(state, clearReferences);
  }
  function publishPcm(record) {
    if (pcmMetrics) measurePcm(pcmMetrics, record.pcm, record.channels);
    if (disposed || !node) return Promise.resolve();
    if (!record.pcm.byteLength && record.flags & 2) encodedReservations.delete(record.type);
    else if (record.flags & 1) releaseEncoded(record.type);
    if (context?.state !== 'running') return Promise.resolve();
    if (record.flags & 1 && queuedBytes + record.pcm.byteLength > MAX_AUDIO_AHEAD_BYTES) return Promise.reject(new Error('Decoded buffered audio exceeds its playback memory limit.'));
    const generation = playbackGeneration, installed = node, bytes = record.pcm.byteLength;
    const outputRate = context.sampleRate || 48000;
    const cached = bytes ? calibrations.get(record.rate, outputRate) : null;
    if (bytes && (!cached || pendingPublish) && queuedBytes + bytes > MAX_AUDIO_AHEAD_BYTES) {
      return Promise.reject(new Error('Audio format preparation exceeds its playback memory limit.'));
    }
    const send = calibration => {
      if (disposed || generation !== playbackGeneration || node !== installed) return;
      if (context?.state !== 'running') { queuedBytes = Math.max(0, queuedBytes - bytes); return; }
      if (calibration) node.port.postMessage({ calibration });
      sendPcm(record, generation);
    };
    queuedBytes += bytes;
    if ((!bytes || cached) && !pendingPublish) { send(cached); return Promise.resolve(); }
    if (pendingPcmBytes + bytes > MAX_AUDIO_AHEAD_BYTES) {
      queuedBytes -= bytes; return Promise.reject(new Error('Audio format preparation exceeds its playback memory limit.'));
    }
    pendingPcmBytes += bytes;
    const task = Promise.resolve(pendingPublish).then(async () => {
      if (disposed || generation !== playbackGeneration || node !== installed) return;
      const calibration = bytes ? cached || await calibrations.prepare(record.rate, outputRate) : null;
      send(calibration);
    }).catch(error => {
      if (generation !== playbackGeneration || disposed) return;
      queuedBytes = Math.max(0, queuedBytes - bytes); throw error;
    }).finally(() => {
      if (generation === playbackGeneration) pendingPcmBytes = Math.max(0, pendingPcmBytes - bytes);
      if (pendingPublish === task) pendingPublish = null;
    });
    pendingPublish = task;
    return task;
  }
  function sendPcm(record, generation) {
    const hasPcm = record.pcm.byteLength > 0;
    if (record.pcm.byteLength) onMode(record.mode);
    // Readiness may use the current clock estimate; queued PCM retains the raw
    // media timestamp. Calibration updates adjust the playout target, never the
    // timestamps or adjacency of packets already belonging to one stream.
    const sourceTime = presentationTime(record.presentationMs, clock);
    if (clock?.version !== 2) record.sourceTime = sourceTime;
    record.arrivalLocalTimeMs = performance.now();
    const purpose = record.semanticType ?? record.type;
    const arrivalAnchored = record.mode === 'carplay' && purpose >= 1 && purpose <= 4;
    if (hasPcm) {
      if (Number.isFinite(sourceTime)) { timedPackets++; if (!arrivalAnchored) onTiming(sourceTime, record.mode); }
      else fallbackPackets++;
    }
    clockBase ??= now() - context.currentTime * 1000;
    node.port.postMessage({ plans: delayPlans, plansByMode, clockBase });
    controls();
    record.generation = generation;
    node.port.postMessage(record, [record.pcm]);
    if (hasPcm && !arrivalAnchored) onQueued(record.mode);
  }
  async function stream(signal) {
    stopStream();
    if (!support || !enabled || !node || !nodeConnected || context.state !== 'running' || !signal || signal.aborted) return;
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
          if (record.config?.ended !== true) await calibrations.prepare(record.rate, context.sampleRate || 48000);
          if (abort.signal.aborted) break;
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
        await publishPcm(record);
      }
    } catch (failure) {
      if (!abort.signal.aborted) { audioError = String(failure.message); notify(); }
    } finally {
      signal.removeEventListener('abort', stop);
      if (request === abort) {
        packetDecoder.reset();
        releaseEncoded();
        playbackGeneration++; pendingPublish = null; pendingPcmBytes = 0; calibrations.cancel();
        request = null; node?.port.postMessage({ reset: true }); queuedBytes = 0;
        invalidateOutput('output-unavailable');
        if (!abort.signal.aborted && connection === signal && enabled) retryTimer = setTimeout(() => stream(signal), 1000);
      }
    }
  }
  async function activate() {
    if (disposed) return;
    clearTimeout(recoveryTimer); recoveryTimer = null;
    try {
      // Creating/resuming the context happens before awaiting, preserving user activation.
      if (!context) {
        context = new AudioContext({ latencyHint: 'interactive' });
        context.onstatechange = () => {
          if (disposed || !context) return;
          if (context.state !== 'running') {
            invalidateOutput('suspended');
            controls(true);
          } else {
            outputClock.reset(); controls(true);
          }
          notify();
        };
      }
      const resumed = context.resume();
      ready ??= context.audioWorklet.addModule(new URL('audio-worklet.js', import.meta.url)).then(async () => {
        if (disposed) return;
        await installNode();
      }).catch(error => { ready = null; throw error; });
      // Load the worklet even while autoplay waits for the first gesture.
      Promise.all([ready, resumed]).then(async () => { if (!disposed) {
        if (!node || !nodeConnected) await installNode();
        if (disposed) return;
        processorFailed = false; audioError = null; stream(connection); notify();
      } }).catch(failure => { if (!disposed) { audioError = failure.message; notify(); } });
      await ready;
      if (disposed) return;
      notify();
    } catch (failure) { if (!disposed) { audioError = failure.message; notify(); } }
  }
  return {
    activate, debug, stats: snapshot,
    clock(value) { clock = value; controls(true); },
    delay(value, mode) {
      if (mode) plansByMode[mode] = value;
      else delayPlans = value;
      node?.port.postMessage({ plans: delayPlans, plansByMode });
      controls(true);
    },
    reset() { packetDecoder.reset(); releaseEncoded(); playbackGeneration++; clockBase = null; queuedBytes = 0;
      if (pendingPcmBytes) calibrations.cancel();
      pendingPublish = null; pendingPcmBytes = 0; node?.port.postMessage({ reset: true }); capacity?.(); capacity = null; invalidateOutput('reset', true); },
    start() { activate(); },
    gesture() { if (!disposed && (!node || context?.state !== 'running' || processorFailed)) { recoveryAttempts = 0; activate(); } },
    attach(signal, hello) {
      this.stop(); voiceRevision = null; connection = signal; support = hello.audio === true;
      recoveryAttempts = 0;
      signal.addEventListener('abort', () => { if (connection === signal) this.stop(); }, { once: true });
      if (!node || !nodeConnected) activate(); else stream(signal);
      notify();
    },
    status(status) {
      debug(status.debug);
      const changed = enabled !== (status.audio !== false);
      enabled = status.audio !== false;
      route(status.voice);
      if (!enabled) stopStream(true, 'disabled');
      else if (changed) {
        if (!node && processorFailed) { recoveryAttempts = 0; activate(); }
        else stream(connection);
      }
      notify();
    },
    stop() { clearTimeout(recoveryTimer); recoveryTimer = null; connection = null; stopStream(true, 'stopped'); voiceError = null; voiceState = 'idle'; notify(); },
    dispose() { disposed = true; this.stop(); retireNode(); packetDecoder.dispose(); calibrations.dispose(); if (context) context.onstatechange = null; context?.close().catch(() => {}); context = null; ready = null; },
  };
}
