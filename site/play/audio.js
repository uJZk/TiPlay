/*! SPDX-License-Identifier: GPL-3.0-only */
import { packAudioEvidence } from './audio-evidence.js';
import { presentationTime } from './clock-sync.js';
import { readAudioRecords } from './audio-protocol.js';
import { initialPlaybackPlans } from './playback-window.js';
import { createAirPlayAudioDecoder } from './airplay-audio-decoder.js';
import { MAX_AUDIO_AHEAD_BYTES } from './audio-buffer-policy.js';
import { pcmStats, measurePcm } from './audio-pcm-stats.js';
import { createAudioOutputMapping } from './audio-output-clock.js';
import { readAudioPlaybackStats } from './audio-playback-stats.js';
import { loadNetEq } from './neteq.js';
import { loadAudioCore } from './wasm/audio-core.js';
import { createAudioRecordQueue } from './audio-record-queue.js';
import { createRtcAudio, RTC_AUDIO_TRANSPORT, RTC_AUDIO_SLOTS } from './rtc-audio.js';

// One accepted decode/flush may emit several PCM frames and a finite filter tail.
const DECODE_RESERVATION_BYTES = 256 * 1024;

/** Playback only. Android owns demand-driven car Bluetooth capture and speech playback. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {}, onTiming = () => {}, onQueued = () => {}, onMode = () => {},
  onAudioReference = () => {}, onSourceDeadline = () => {}, onEvidence = () => false }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, voiceRevision = null, voiceState = 'idle', voiceError = null;
  let queuedBytes = 0, audioError = null, disposed = false, recordQueue = null;
  const capacityWaiters = new Set();
  function wakeCapacity() { for (const wake of capacityWaiters) wake(); capacityWaiters.clear(); }
  function waitCapacity(signal) {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const wake = () => { capacityWaiters.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
      capacityWaiters.add(wake); signal.addEventListener('abort', wake, { once: true });
    });
  }
  let retryTimer = null, mediaSource = null;
  let clock = null, delayPlans = initialPlaybackPlans(), timedPackets = 0, fallbackPackets = 0, arrivalAnchoredPackets = 0;
  let playbackGeneration = 0;
  let debugEnabled = false, pcmMetrics = null, workletMetrics = null, reportAt = null;
  let diagnosticRevision = 0, evidenceForwarded = 0, evidenceDropped = 0, evidenceEventSequence = 0, evidenceNodeSequence = 0, evidenceBaseline = null, evidenceBaselineAt = null;
  let contextObservation = null;
  let processorErrors = 0, recoveries = 0, processorFailed = false, recoveryAttempts = 0, recoveryTimer = null;
  let lastControlAt = -Infinity;
  let preparingNode = null, preparationSequence = 0, nodeConnected = false;
  let nodeInstallation = null, directInputSupported = false;
  let rtcAudio = null, rtcExchange = null, rtcReady = null, rtcAudioSupported = false, rtcPeerGeneration = 0, rtcUnsubscribe = null;
  const directOutputs = new Map();
  let directOutputSequence = 0;
  const outputClock = createAudioOutputMapping(), playoutReferences = new Map();
  // Keep one counter per bounded logical stream. Epoch changes retire its local counter,
  // while the page-wide rejection total survives stream replacement and processor recovery.
  const deadlineStreams = new Map(), recordTimings = new Map();
  let deadlineRejectedFrames = 0, deadlineEventSequence = 0;
  const importantUnknown = new Set(['source-anchor-unavailable', 'output-clock-unavailable', 'clock-uncertainty-unavailable']);
  const deadlineReasons = new Set([...importantUnknown, 'source-deadline', 'no-output']);
  function observeSourceDeadline(reference) {
    if (!['carplay', 'airplay-mirror', 'airplay-audio'].includes(reference.mode)
      || !Number.isInteger(reference.type) || reference.type < 0 || reference.type > 255) return;
    const key = `${reference.mode}-${reference.type}`, identity = `${reference.generation}:${reference.epoch}`;
    let entry = deadlineStreams.get(key);
    if (!entry || entry.identity !== identity) {
      if (!entry && deadlineStreams.size >= 3 * 256) return;
      entry = { identity, rejected: 0, unknownReasons: new Set(), violatedReasons: new Set() };
      deadlineStreams.set(key, entry);
    }
    const rejected = Number.isSafeInteger(reference.sourceDeadlineRejectedFrames) && reference.sourceDeadlineRejectedFrames >= 0
      ? reference.sourceDeadlineRejectedFrames : entry.rejected;
    const added = Math.max(0, rejected - entry.rejected);
    entry.rejected = Math.max(entry.rejected, rejected); deadlineRejectedFrames += added;
    entry.state = ['unknown', 'within-bound', 'violated'].includes(reference.sourceDeadlineState) ? reference.sourceDeadlineState : 'unknown';
    entry.epoch = Number.isSafeInteger(reference.epoch) ? reference.epoch : null;
    entry.reason = deadlineReasons.has(reference.sourceDeadlineReason) ? reference.sourceDeadlineReason : null;
    entry.upper = Number.isFinite(reference.sourceDeltaUpperMs) ? reference.sourceDeltaUpperMs : null;
    entry.active = !['retired', 'stopped', 'ended'].includes(reference.playoutState ?? reference.state);
    const firstUnknown = entry.state === 'unknown' && importantUnknown.has(entry.reason) && !entry.unknownReasons.has(entry.reason);
    const firstViolation = entry.state === 'violated' && !entry.violatedReasons.has(entry.reason);
    if (firstUnknown) entry.unknownReasons.add(entry.reason);
    if (firstViolation) entry.violatedReasons.add(entry.reason);
    if (added || firstUnknown || firstViolation) {
      entry.priority = ++deadlineEventSequence;
      try { onSourceDeadline({ first: firstUnknown || firstViolation }); } catch (_) {} // Diagnostic delivery cannot interrupt audio feedback.
    }
  }
  function sourceDeadlineStats() {
    const rank = { violated: 0, unknown: 1, 'within-bound': 2 };
    const active = [...deadlineStreams.entries()].filter(([, entry]) => entry.active)
      .sort((a, b) => rank[a[1].state] - rank[b[1].state] || (b[1].priority ?? 0) - (a[1].priority ?? 0) || a[0].localeCompare(b[0]));
    const [stream, entry] = active[0] ?? [];
    return { sourceDeadlineState: entry?.state ?? 'unknown', sourceDeadlineReason: entry ? entry.reason ?? 'none' : 'no-audio',
      sourceDeltaUpperMs: entry?.upper ?? null, sourceDeadlineRejectedFrames: deadlineRejectedFrames,
      sourceDeadlineStream: stream ?? 'none', sourceDeadlineEpoch: entry?.epoch ?? null };
  }
  const plansByMode = {};
  const encodedReservations = new Map();
  const reservedBytes = () => [...encodedReservations.values()].reduce((total, bytes) => total + bytes, 0);
  const releaseEncoded = type => {
    if (type === undefined) encodedReservations.clear();
    else encodedReservations.delete(type);
    wakeCapacity();
  };
  function closeDirectOutputs() { for (const output of [...directOutputs.values()]) output.close(); }
  function closeRtcAudio() { rtcAudio?.close(); rtcAudio = null; }
  function startRtcAudio(generation = null) {
    if (generation !== null && (!Number.isSafeInteger(generation) || generation < 1 || generation > 0x7fffffff))
      throw Error('Invalid native audio generation.');
    if (!rtcAudioSupported || !rtcExchange || typeof rtcReady !== 'function' || !node || !nodeConnected || !connection || connection.aborted
      || context?.state !== 'running' || !enabled || disposed) return null;
    if (!rtcAudio) {
      const owner = rtcAudio = createRtcAudio({ exchange: rtcExchange, ready: rtcReady, context, node, generation: playbackGeneration,
        signal: connection, onError: cause => {
          if (rtcAudio !== owner) return;
          audioError = cause.message || String(cause); notify();
        } });
      rtcPeerGeneration = generation ?? rtcPeerGeneration + 1;
      owner.start(rtcPeerGeneration).catch(() => {});
    } else if (generation !== null && generation > rtcPeerGeneration) {
      rtcPeerGeneration = generation; rtcAudio.start(generation).catch(() => {});
    }
    return rtcAudio;
  }
  function createDirectOutput(record) {
    if (!directInputSupported || typeof MessageChannel !== 'function' || !node || disposed) return null;
    const installed = node, generation = playbackGeneration, id = ++directOutputSequence;
    const channel = new MessageChannel(), pending = new Map();
    let closed = false, delivered = 0;
    const output = {
      id, port: channel.port2, record: { ...record, generation, arrivalTimeOrigin: performance.timeOrigin },
      wait(deliveryId) {
        if (closed) return Promise.reject(new DOMException('Audio output was cancelled.', 'AbortError'));
        if (deliveryId <= delivered) return Promise.resolve();
        return new Promise((resolve, reject) => pending.set(deliveryId, { resolve, reject }));
      },
      delivered(deliveryId) {
        delivered = Math.max(delivered, deliveryId);
        for (const [sequence, wait] of pending) if (sequence <= delivered) { pending.delete(sequence); wait.resolve(); }
      },
      close() {
        if (closed) return;
        closed = true; directOutputs.delete(id);
        for (const wait of pending.values()) wait.reject(new DOMException('Audio output was cancelled.', 'AbortError'));
        pending.clear(); channel.port2.close();
        if (node === installed) installed.port.postMessage({ directClose: { id, type: record.type, epoch: record.epoch, generation } });
      },
    };
    directOutputs.set(id, output);
    installed.port.postMessage({ directInput: { id, port: channel.port1, record: output.record } }, [channel.port1]);
    return output;
  }
  const packetDecoder = createAirPlayAudioDecoder({
    createDirectOutput,
    onNative: record => {
      const native = startRtcAudio(record.config.rtcGeneration);
      if (!native) throw Error('Native RTP audio was not negotiated.');
      return native.configure(record);
    },
    onNativeEnd: record => rtcAudio?.end(record),
    onEvidence: (reason, detail) => { if (debugEnabled) node?.port.postMessage({ evidenceTrigger: { reason, detail } }); },
    onPcm: record => { if (debugEnabled) record.decodedAtMs = now(); publishPcm(record).catch(cause => {
      if (disposed) return;
      stopStream(); audioError = cause.message || String(cause); notify();
    }); },
    onError: cause => { audioError = cause.message || String(cause); notify(); },
  });
  const now = () => performance.timeOrigin + performance.now();
  function emitEvidence(evidence, origin = 'worklet') {
    if (!debugEnabled) return;
    const main = { receivedAtMs: now(), diagnosticRevision, playbackGeneration, processorInstance: evidenceNodeSequence, evidenceOrigin: origin, baselineAgeMs: evidenceBaselineAt === null ? null : now() - evidenceBaselineAt,
      visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
      ...readAudioPlaybackStats(context), contextState: context?.state,
      queuedBytes, encodedReservedBytes: reservedBytes(), ...outputClock.diagnostics() };
    const types = [...new Set([...evidence.causes.map(c => c.type).filter(Number.isInteger), ...recordTimings.keys()])].slice(0, 4);
    for (const type of types) {
      const timing = recordTimings.get(type);
      if (timing) for (const [key, value] of Object.entries(timing)) main[`stream${type}.${key}`] = value;
    }
    const decoder = packetDecoder.stats();
    for (const key of ['packets', 'frames', 'peak', 'errors', 'nativePeak', 'nativeScanFrames', 'nativeOverFullScaleSamples', 'nativeNonFiniteSamples', 'nativeScanErrors'])
      if (decoder?.[key] !== undefined) main['decoder.' + key] = decoder[key];
    for (const [key, value] of Object.entries(main)) if (value === undefined || typeof value === 'object') delete main[key];
    const keys = Object.keys(main);
    if (keys.length > 95) { for (const key of keys.slice(95)) delete main[key]; main.mainOmittedFields = keys.length - 95; }
    try { const packed = packAudioEvidence({ ...evidence, id: ++evidenceEventSequence }, main);
      if (packed && onEvidence(packed) === true) evidenceForwarded++; else evidenceDropped++;
    } catch (_) { evidenceDropped++; }
  }

  function observeContextState() {
    if (!debugEnabled) return;
    const at = now(), state = context?.state ?? null;
    if (!contextObservation) contextObservation = { at, state, changes: 0, nonRunningMs: 0 };
    else {
      if (contextObservation.state !== null && contextObservation.state !== 'running')
        contextObservation.nonRunningMs += Math.max(0, at - contextObservation.at);
      if (contextObservation.state !== null && state !== null && state !== contextObservation.state) contextObservation.changes++;
      contextObservation.at = at; contextObservation.state = state;
    }
  }
  const debugSnapshot = () => {
    observeContextState();
    const device = outputClock.deviceClock();
    let contextTimeMs = null;
    try { const raw = context?.currentTime; if (Number.isFinite(raw)) contextTimeMs = raw * 1000; } catch (_) {}
    return {
      processorErrors, recoveries, processorFailed, recoveryAttempts, evidenceForwarded, evidenceDropped,
      contextState: context?.state ?? 'unavailable', contextTimeMs,
      contextObservedStateChanges: contextObservation.changes, contextObservedNonRunningMs: contextObservation.nonRunningMs,
      contextRate: context?.sampleRate ?? null, contextBaseLatencyMs: context?.baseLatency * 1000,
      contextOutputLatencyMs: context?.outputLatency * 1000,
      clockOffsetMs: clock?.offset ?? null, clockAgeMs: clock ? now() - clock.at : null, clockRttMs: clock?.rtt ?? null,
      clockRatePpm: clock?.rate === undefined ? null : (clock.rate - 1) * 1e6,
      clockGeneration: clock?.generation ?? null, clockUncertaintyMs: clock?.uncertaintyMs ?? null,
      clockRateConfidence: clock?.rateConfidence ?? null,
      deviceClockRatePpm: device.ratePpm, deviceClockTargetRatePpm: device.targetRatePpm,
      deviceClockSource: device.source,
      deviceClockConfidence: device.confidence, deviceClockUncertaintyMs: device.uncertaintyMs,
      ...(device.fitDispersionMs === undefined ? {} : { deviceClockFitDispersionMs: device.fitDispersionMs }),
      deviceClockGeneration: device.generation, deviceClockReason: device.reason,
      ...(device.acceptedFitAgeMs === undefined ? {} : { deviceClockAcceptedFitAgeMs: device.acceptedFitAgeMs }),
      deviceClockFitRejected: device.fitRejected, deviceClockFitStatus: device.fitStatus, deviceClockFitRejectReason: device.fitRejectReason,
      ...outputClock.diagnostics(),
      pcmPackets: pcmMetrics?.packets ?? 0, pcmFrames: pcmMetrics?.frames ?? 0,
      pcmNonzero: pcmMetrics?.nonzero ?? 0, pcmPeak: pcmMetrics?.peak ?? 0,
      ...workletMetrics,
      ...readAudioPlaybackStats(context),
      renderReportAgeMs: reportAt === null ? null : now() - reportAt,
      // Receipt age is observable; an asynchronous main-thread getter cannot
      // establish the age of rendered PCM or a physical output timestamp.
      renderAgeMs: null,
      decoder: packetDecoder.stats(),
    };
  };
  const snapshot = () => ({ supported: support, enabled, sound: context?.state === 'running',
    bluetooth: voiceState, browserMuted: false, error: voiceError ?? audioError,
    timedPackets, fallbackPackets, arrivalAnchoredPackets, queuedBytes, processorErrors, recoveries, processorFailed,
    ...(rtcAudio ? { nativeAudio: rtcAudio.stats() } : {}),
    ...sourceDeadlineStats(),
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
    const renderProbe = outputClock.takeRenderProbe();
    node.port.postMessage({ clock: relativeClock(),
      ...(renderProbe === null ? {} : { renderProbe }),
      deviceClock: outputClock.deviceClock(),
      contextAnchor: output ? { contextTimeMs: output.contextTimeMs, localTimeMs: output.performanceTimeMs - performance.timeOrigin } : null,
      outputMethod: output?.outputMethod ?? null,
      outputLatencyMs: output?.outputLatencyMs ?? null, outputUncertaintyMs: output?.uncertaintyMs ?? null,
      localTimeOriginMs: performance.timeOrigin, suspended: context.state !== 'running',
      plans: delayPlans, plansByMode });
  }
  function invalidateOutput(state, clear = false) {
    outputClock.reset();
    for (const entry of deadlineStreams.values()) entry.active = false;
    if (clear) { playoutReferences.clear(); onAudioReference(null); return; }
    for (const [key, previous] of playoutReferences) {
      const reference = { ...previous, state, playoutState: state, audibleTimeMs: null, at: now() };
      playoutReferences.set(key, reference); onAudioReference(reference);
    }
  }
  function debug(value) {
    const next = value === true;
    if (next === debugEnabled) return;
    debugEnabled = next; recordTimings.clear(); diagnosticRevision++; contextObservation = null;
    pcmMetrics = next ? pcmStats() : null; workletMetrics = null; reportAt = null;
    observeContextState();
    outputClock.debug(next); packetDecoder.debug(next); node?.port.postMessage({ debug: next, diagnosticRevision, generation: playbackGeneration }); notify();
  }
  function retireNode() {
    closeRtcAudio();
    closeDirectOutputs();
    nodeConnected = false; directInputSupported = false;
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
    const preparingContext = context;
    const [audioCoreModule, neteqModule] = await Promise.all([
      loadAudioCore(), loadNetEq(),
    ]);
    if (disposed || context !== preparingContext) return;
    // Compile away from the render thread. Each processor owns its fixed memories;
    // cloning compiled code does not share stream state or require cross-origin isolation.
    const installed = new AudioWorkletNode(context, 'tiplay-audio', { numberOfInputs: RTC_AUDIO_SLOTS, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { audioCoreModule, neteqModule } });
    node = installed; nodeConnected = false; evidenceNodeSequence++; evidenceBaseline = null; evidenceBaselineAt = null;
    const id = ++preparationSequence;
    let resolve, reject, connected = false;
    const prepared = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timeout = setTimeout(() => reject(new Error('Audio processor preparation timed out.')), 10000);
    preparingNode = { installed, reject };
    installed.port.onmessage = ({ data }) => {
      if (disposed || node !== installed) return;
      if (data.directPcm && data.generation === playbackGeneration) {
        const delivery = data.directPcm, output = directOutputs.get(delivery.id);
        if (output) {
          try {
            for (const record of delivery.records) {
              if (record.generation !== playbackGeneration) continue;
              const bytes = record.pcmBytes;
              if (!Number.isSafeInteger(bytes) || bytes < 0 || queuedBytes + bytes > MAX_AUDIO_AHEAD_BYTES)
                throw Error('Direct decoded audio exceeds its playback memory limit.');
              queuedBytes += bytes;
              if (pcmMetrics && record.pcmStats) {
                pcmMetrics.packets += record.pcmStats.packets; pcmMetrics.frames += record.pcmStats.frames;
                pcmMetrics.nonzero += record.pcmStats.nonzero; pcmMetrics.peak = Math.max(pcmMetrics.peak, record.pcmStats.peak);
              }
              packetDecoder.directPcm(record);
              observePcm(record, bytes);
            }
            output.delivered(delivery.deliveryId);
          } catch (cause) { stopStream(); audioError = cause.message || String(cause); notify(); }
        }
      }
      if (data.nativeStarted?.generation === playbackGeneration && rtcAudio?.active(data.nativeStarted)) {
        const source = data.nativeStarted;
        onMode(source.mode);
        if (source.semanticType === 0 || source.semanticType === 6) onQueued(source.mode);
      }
      if (data.nativeAudioBound?.generation === playbackGeneration) rtcAudio?.bound(data.nativeAudioBound);
      if (data.prepared === id) { directInputSupported = data.directInputSupported === true; resolve(); }
      if (data.prepareError === id) reject(new Error(data.error || 'Audio processor preparation failed.'));
      if (data.renderProbe) outputClock.acknowledgeRenderProbe(data.renderProbe, context);
      if (data.consumed && data.generation === playbackGeneration) {
        queuedBytes = Math.max(0, queuedBytes - data.consumed); wakeCapacity();
      }
      if (debugEnabled && data.diagnosticRevision === diagnosticRevision && data.playbackGeneration === playbackGeneration
        && data.diagnostics) { evidenceBaseline = data.evidenceBaseline ?? null; evidenceBaselineAt = now(); workletMetrics = data.diagnostics; reportAt = now(); }
      if (data.evidence && debugEnabled && data.diagnosticRevision === diagnosticRevision && data.playbackGeneration === playbackGeneration) {
        emitEvidence(data.evidence);
      }

      if (data.playout && data.playout.generation === playbackGeneration) {
        const reference = outputClock.reference(data.playout, context);
        if (reference) {
          playoutReferences.set(`${reference.mode}:${reference.type}`, reference);
          observeSourceDeadline(reference); onAudioReference(reference);
        }
        controls();
      }
    };
    installed.onprocessorerror = () => {
      if (debugEnabled) emitEvidence({ ...(evidenceBaseline ?? { schema: 1, sampleRate: context?.sampleRate || 48000, clock: 'wall', blocks: [], attempts: 0, suppressed: 0, timeOriginMs: null }),
        causes: [{ reason: 'processor-error' }], incomplete: true }, 'processor-error');
      if (disposed || node !== installed) return;
      processorErrors++; processorFailed = true; audioError = 'Audio processor failed.';
      if (!connected) { reject(new Error(audioError)); return; }
      stopStream(); retireNode(); recoverProcessor(); notify();
    };
    installed.port.postMessage({ prepare: { id, rate: 48000, outputRate: preparingContext.sampleRate || 48000 } });
    try {
      await prepared;
      if (disposed || node !== installed) return;
      installed.connect(context.destination); connected = true; nodeConnected = true;
    } catch (error) {
      if (node === installed) retireNode();
      throw error;
    } finally { clearTimeout(timeout); if (preparingNode?.installed === installed) preparingNode = null; }
    installed.port.postMessage({ debug: debugEnabled, diagnosticRevision, generation: playbackGeneration });
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
    recordQueue?.close(); recordQueue = null;
    closeDirectOutputs();
    closeRtcAudio();
    packetDecoder.reset();
    releaseEncoded();
    playbackGeneration++;
    clearTimeout(retryTimer); retryTimer = null;
    request?.abort(); request = null;
    resetNode();
    queuedBytes = 0; wakeCapacity();
    invalidateOutput(state, clearReferences);
  }
  function resetNode() {
    workletMetrics = null; reportAt = null;
    node?.port.postMessage({ reset: true, generation: playbackGeneration });
  }
  function publishPcm(record) {
    if (pcmMetrics) measurePcm(pcmMetrics, record.pcm, record.channels);
    if (disposed || !node) return Promise.resolve();
    if (context?.state !== 'running') return Promise.resolve();
    if (record.flags & 1 && queuedBytes + record.pcm.byteLength > MAX_AUDIO_AHEAD_BYTES) return Promise.reject(new Error('Decoded buffered audio exceeds its playback memory limit.'));
    const bytes = record.pcm.byteLength;
    if (queuedBytes + bytes > MAX_AUDIO_AHEAD_BYTES) return Promise.reject(new Error('Audio input exceeds its memory limit.'));
    queuedBytes += bytes;
    sendPcm(record, playbackGeneration);
    return Promise.resolve();
  }

  function sendPcm(record, generation) {
    observePcm(record, record.pcm.byteLength);
    node.port.postMessage({ plans: delayPlans, plansByMode });
    controls();
    record.generation = generation;
    node.port.postMessage(record, [record.pcm]);
  }
  function observePcm(record, bytes) {
    const hasPcm = bytes > 0;
    if (hasPcm) onMode(record.mode);
    // Readiness may use the current clock estimate; queued PCM retains the raw
    // media timestamp. Calibration updates adjust the playout target, never the
    // timestamps or adjacency of packets already belonging to one stream.
    const sourceTime = presentationTime(record.presentationMs, clock);
    if (clock?.version !== 2) record.sourceTime = sourceTime;
    record.arrivalLocalTimeMs ??= performance.now();
    if (debugEnabled) { record.workletPostedAtMs = now();
      const timing = recordTimings.get(record.type); if (timing) { timing.lastPostAtMs = record.workletPostedAtMs; timing.decodedAtMs = record.decodedAtMs ?? null; }
    }
    const purpose = record.semanticType ?? record.type;
    const voice = record.mode === 'carplay' && purpose >= 1 && purpose <= 4;
    const arrivalAnchored = voice && !Number.isFinite(sourceTime);
    if (hasPcm) {
      if (arrivalAnchored) arrivalAnchoredPackets++;
      else if (Number.isFinite(sourceTime)) { timedPackets++; if (!voice) onTiming(sourceTime, record.mode); }
      else fallbackPackets++;
    }
    if (hasPcm && !voice) onQueued(record.mode);
  }
  async function stream(signal) {
    stopStream();
    if (!support || !enabled || !node || !nodeConnected || context.state !== 'running' || !signal || signal.aborted) return;
    const abort = request = new AbortController();
    const dispatch = recordQueue = createAudioRecordQueue({ signal: abort.signal,
      process: processRecord,
      onError: failure => {
        if (request !== abort) return;
        audioError = failure.message || String(failure); abort.abort(); notify();
      },
    });
    async function processRecord(record, taskSignal) {
      if (taskSignal.aborted) return;
      if (record.kind === 6 && record.config?.audioTransport === RTC_AUDIO_TRANSPORT
        && record.config.rtcGeneration < rtcPeerGeneration) return;
      if (record.kind === 6 && record.config?.audioTransport === RTC_AUDIO_TRANSPORT) {
        const configured = await packetDecoder.configure(record);
        if (!taskSignal.aborted && configured) { audioError = null; notify(); }
        return;
      }
      const generation = playbackGeneration;
      // Reserve output for every operation, including raw PCM and EOS filter tails.
      // Publication converts this allowance into the normal Worklet credit ledger.
      while (queuedBytes + reservedBytes() + DECODE_RESERVATION_BYTES > MAX_AUDIO_AHEAD_BYTES && !taskSignal.aborted)
        await waitCapacity(taskSignal);
      if (taskSignal.aborted) return;
      encodedReservations.set(record.type, DECODE_RESERVATION_BYTES);
      try {
        if (record.kind === 6) {
          const configured = await packetDecoder.configure(record);
          if (!taskSignal.aborted && configured) { audioError = null; notify(); }
        } else if (record.kind === 7) await packetDecoder.decode(record);
        else await packetDecoder.pcm(record);
      } finally { if (generation === playbackGeneration) releaseEncoded(record.type); }
    }
    const stop = () => abort.abort();
    signal.addEventListener('abort', stop, { once: true });
    startRtcAudio();
    try {
      const response = mediaSource ? { ok: true, body: mediaSource() }
        : await fetchPhone(`/audio?${auth()}`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
      audioError = null; notify();
      for await (const record of readAudioRecords(response.body, abort.signal)) {
        if (debugEnabled) {
          const at = now(), previous = recordTimings.get(record.type);
          const gapMs = previous?.epoch === record.epoch ? at - previous.lastReadAtMs : null;
          recordTimings.set(record.type, { epoch: record.epoch, sequence: record.sequence, lastReadAtMs: at,
            readGapMs: gapMs, readGapMaxMs: Math.max(previous?.epoch === record.epoch ? previous.readGapMaxMs || 0 : 0, gapMs || 0), presentationMs: Number.isFinite(record.presentationMs) ? record.presentationMs : null });
          if (gapMs > 100 && record.kind === 7) node?.port.postMessage({ evidenceTrigger: { reason: 'arrival-gap',
            detail: { type: record.type, epoch: record.epoch, sequence: record.sequence, gapMs, readAtMs: at } } });
        }
        if (abort.signal.aborted) break;
        if (record.kind === 2 && record.type === 5) { route({ revision: record.epoch }); continue; }
        // Admission is bounded, but completion belongs to each stream's FIFO lane.
        // A slow codec or buffered-music credit wait cannot serialize other lanes.
        try { await dispatch.enqueue(record); }
        catch (cause) { if (cause.name !== 'AbortError' || abort.signal.aborted) throw cause; }
      }
      if (!abort.signal.aborted) await dispatch.drain();
    } catch (failure) {
      if (!abort.signal.aborted) { audioError = String(failure.message); notify(); }
    } finally {
      dispatch.close();
      signal.removeEventListener('abort', stop);
      if (request === abort) {
        if (recordQueue === dispatch) recordQueue = null;
        packetDecoder.reset();
        releaseEncoded();
        playbackGeneration++;
        request = null; resetNode(); queuedBytes = 0;
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
        context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
        observeContextState();
        context.onstatechange = () => {
          if (disposed || !context) return;
          observeContextState();
          if (context.state !== 'running') {
            // A suspended Worklet retires its private ports. Retire the matching
            // decoder owners too, then reopen a fresh subscription on resume.
            stopStream(false, 'suspended');
            controls(true);
          } else {
            outputClock.reset(); controls(true);
            if (connection && !request && nodeConnected && enabled) stream(connection);
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
        processorFailed = false; audioError = null; if (!request) stream(connection); notify();
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
    reset() { recordQueue?.reset(); closeDirectOutputs(); closeRtcAudio(); packetDecoder.reset(); releaseEncoded(); playbackGeneration++; queuedBytes = 0;
      resetNode(); startRtcAudio(); wakeCapacity(); invalidateOutput('reset', true); },
    rtcGeneration(generation) {
      if (!Number.isSafeInteger(generation) || generation > 0x7fffffff || generation <= rtcPeerGeneration) return false;
      return Boolean(startRtcAudio(generation));
    },
    start() { activate(); },
    gesture() { if (!disposed && (!node || context?.state !== 'running' || processorFailed)) { recoveryAttempts = 0; activate(); } },
    attach(signal, hello, openMedia = null, native = null) {
      this.stop(); voiceRevision = null; connection = signal; mediaSource = openMedia; support = hello.audio === true;
      rtcExchange = native?.exchange ?? null; rtcAudioSupported = hello.audioTransport === RTC_AUDIO_TRANSPORT;
      rtcReady = native?.ready ?? null;
      rtcPeerGeneration = 0;
      rtcUnsubscribe = native?.subscribe?.(event => {
        if (connection !== signal || signal.aborted || event.generation !== rtcPeerGeneration) return;
        if (event.k === 'audio-restart-required') startRtcAudio(rtcPeerGeneration + 1);
        else if (event.k === 'audio-error') {
          const cause = Error(event.reason || 'Native audio failed.');
          rtcAudio?.fail(cause);
          // The server can fail an original-codec source before its slot metadata
          // is published. Do not hide that failure just because no graph exists.
          audioError = cause.message; notify();
        }
      }) ?? null;
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
    stop() { clearTimeout(recoveryTimer); recoveryTimer = null; rtcUnsubscribe?.(); rtcUnsubscribe = null;
      connection = null; mediaSource = null; stopStream(true, 'stopped'); voiceError = null; voiceState = 'idle'; notify(); },
    dispose() { disposed = true; this.stop(); retireNode(); packetDecoder.dispose(); if (context) context.onstatechange = null; context?.close().catch(() => {}); context = null; ready = null; },
  };
}
