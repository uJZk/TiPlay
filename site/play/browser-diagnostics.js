/*! SPDX-License-Identifier: GPL-3.0-only */
import { flatStats } from './link.js';
import { createVideoDiagnosticTracker, videoDiagnosticValues, packVideoDiagnosticValues } from './video-diagnostics.js';
export { VIDEO_DIAGNOSTIC_BYTES } from './video-diagnostics.js';

// Keep this identifier in step with the offline cache; the receiver records the loaded page.
export const PAGE_VERSION = 'v76';
export const AUDIO_DIAGNOSTIC_BYTES = 16 * 1024;
const SUMMARY_KEYS = [
  'page.version', 'video.streamGeneration', 'video.epoch', 'video.droppedFrames',
  'video.decodeDroppedFrames', 'video.scheduledDroppedFrames', 'video.transferDroppedFrames', 'video.renderDroppedFrames', 'video.pacingDroppedFrames',
  'video.playbackProfile', 'video.decodedQueueFrames', 'video.decodedQueueBytes', 'video.scheduledCapacityFrames',
  'video.currentDelta', 'video.currentFps', 'video.frameIntervalP95Ms',
  'link.path', 'link.reconnects', 'link.errorReason', 'link.failure.reason', 'link.failure.stage',
  'link.connection.stage', 'link.connection.localCandidates', 'link.connection.localUdpCandidates',
  'link.connection.remoteCandidates', 'link.connection.remoteUdpCandidates',
  'transport.transport', 'transport.state', 'transport.stage', 'transport.reason', 'transport.generation',
  'transport.channelClosedLabel',
  'transport.queuedBytes', 'transport.highWaterBytes', 'transport.reassemblyErrors',
  'transport.controlFailures', 'transport.iceState', 'transport.connectionState',
  'audio.sourceDeadlineState', 'audio.sourceDeadlineReason', 'audio.sourceDeltaUpperMs',
  'audio.sourceDeadlineRejectedFrames', 'audio.sourceDeadlineStream', 'audio.sourceDeadlineEpoch',
  'video.scheduledCapacityFrames', 'video.policyInteractionStarts', 'video.policyInteractionReleases', 'video.policyProfileSwitches',
  'video.sourceClockState', 'video.sourceClockAgeMs', 'video.sourceClockGeneration', 'video.sourceClockMaxAgeMs', 'video.stageClockUncertaintyMs',
  'video.clockEstimatorState', 'video.clockEstimatorObservationAgeMs', 'video.clockEstimatorSelectedAgeMs',
  'video.policyVideoReadinessMs', 'video.policyVideoMarginMs', 'video.policyVideoTargetMs', 'video.policyTargetReason',
  'video.policyMaxDelayMs', 'video.policySubmitMarginMs', 'video.policyMaxVideoFrames', 'video.policyMaxVideoBytes',
  'video.policyInteractionActive', 'video.policyHoldRemainingMs',
  'video.playbackProfile', 'video.decodedQueueFrames', 'video.decodedQueueBytes', 'video.decodedResourceDroppedFrames',
  'video.decodeStalls', 'video.decodeErrors', 'video.decodeQueueSize',
  'control.rttMsP50', 'control.rttMsP95', 'control.pending', 'control.failures',
  'video.decoderStatsAgeMs', 'video.readFrameIntervalMsMax', 'video.decodeOldestInFlightMs',
  'audio.bluetooth', 'audio.sound', 'audio.timedPackets', 'audio.fallbackPackets', 'audio.queuedBytes',
  'video.codec', 'video.currentFps', 'video.currentDelta', 'video.frameIntervalP95Ms', 'video.frameIntervalMaxMs', 'video.lastDrawAgeMs',
  'transport.ice.state', 'transport.ice.localCandidateType', 'transport.ice.remoteCandidateType', 'transport.ice.protocol',
  'transport.ice.currentRoundTripTimeMs', 'transport.ice.sampleAgeMs', 'transport.ice.availableOutgoingBitrate',
  'transport.ice.requestsSent', 'transport.ice.requestsReceived', 'transport.ice.responsesSent', 'transport.ice.responsesReceived',
  'transport.ice.bytesSent', 'transport.ice.bytesReceived',
  'transport.localCandidates', 'transport.localUdpCandidates', 'transport.remoteCandidates', 'transport.remoteUdpCandidates',
  'transport.iceCandidateErrors', 'transport.lastIceCandidateErrorCode', 'transport.selectedProtocol', 'transport.rttMs',
  'transport.fragmentsReceived', 'transport.bytesReceived', 'transport.recordsReceived', 'transport.recordsConsumed',
  'transport.audioDiscardedRecords', 'transport.controlRequests', 'transport.localCandidateType', 'transport.remoteCandidateType',
  'transport.video.reassemblyMsMax', 'transport.video.consumerWaitMsMax', 'transport.video.receivedRecords', 'transport.video.queuedRecords',
  'video.pacingMode', 'video.decodedFps', 'video.androidHubQueueMsP95', 'video.androidTransportSubmitToRecordReadMsP95',
  'video.recordReadToDecodeSubmitMsP95', 'video.decodeMsP95', 'video.decodedToSchedulerMsP95', 'video.decodedToDrawMsP95',
  'video.drawMsP95', 'video.timingRecords', 'video.timingRejected', 'video.clockRttMs', 'video.presentationOffset90',
  'video.presentationOffsetHigh5', 'video.presentationOffsetSamples', 'video.gaps', 'video.dropped',
  'video.policyVideoPlanFromMs', 'video.policyVideoPlanDurationMs', 'video.policyVideoPlanRemainingMs',
  'video.policyVideoLeadRemainingMs', 'video.policyPlanChanges',
];
const AUDIO_SOURCE_CORE = ['epoch', 'state', 'lastRecoveryReason', 'sourceClockFitStatus', 'sourceClockFitRejectReason', 'sourceClockDispersionMs'];
const AUDIO_SOURCE_DETAIL = ['mode', 'reason', 'sourceClockPoints', 'sourceClockSpanMs',
  'sourceClockAcceptedFitAgeMs', 'sourceClockFitRejected', 'sourceDeadlineState',
  'sourceDeadlineReason', 'sourceRatePpm', 'sourceRateConfidence', 'phaseErrorMs', 'queueBytes'];
const AUDIO_CLOCK_KEYS = ['deviceClockFitStatus', 'deviceClockFitRejectReason', 'deviceClockUncertaintyMs',
  'deviceClockRatePpm', 'deviceClockConfidence', 'deviceClockAcceptedFitAgeMs', 'deviceClockFitRejected', 'outputState', 'outputUnavailableReason',
  'outputTimestampAgeMs', 'outputTimestampCaptureMs', 'outputTimestampHoldoverAgeMs', 'outputFeedbackAgeMs',
  'renderTimeMs', 'renderNonzero', 'renderPeak'];

function audioDiagnosticKeys(full) {
  const streams = [...new Set(Object.keys(full).map(key => /^(stream[0-9]{1,3})\./.exec(key)?.[1]).filter(Boolean))];
  const perStream = fields => fields.flatMap(field => streams.map(stream => `${stream}.${field}`));
  // Round-robin fit identity/reason before optional packet/decoder detail, so a
  // busy first stream cannot make a later stream's fit look silently absent.
  return [...new Set(['contextState', 'contextRate', 'renderQuantumFrames', 'renderQuantumMinFrames', 'renderQuantumMaxFrames',
    ...perStream(AUDIO_SOURCE_CORE), ...AUDIO_CLOCK_KEYS, ...perStream(AUDIO_SOURCE_DETAIL), ...Object.keys(full)])]
    .filter(key => Object.hasOwn(full, key));
}

/** First faults lead immediately; identity churn shares the existing diagnostic cadence.
 * Keep the triggering scalar snapshot, so a later recovery cannot rewrite its evidence. */
export function createFaultDiagnosticReporter({ emit, intervalMs = 5000, now = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout }) {
  let last = -Infinity, pending = null, timer = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const event = pending; pending = null; last = now();
    try { emit(event); } catch (_) {} // Logging cannot interrupt media feedback.
  };
  return {
    report(event) {
      pending = { ...event, v: { ...event.v } };
      const remaining = intervalMs - (now() - last);
      if (remaining <= 0) {
        if (timer !== null) cancel(timer);
        flush();
      } else if (timer === null) timer = schedule(flush, remaining);
    },
    reset() {
      if (timer !== null) cancel(timer);
      timer = null; pending = null;
      // Retiring a connection must not reopen the global immediate-report allowance.
    },
  };
}

/** Audio details have their own budget, so video stats cannot crowd out render evidence. */
export function browserDiagnosticEvents(page, themeDark, debug = false, debugSession = null, videoTracker = null) {
  const { debug: audioDebug, ...audio } = page.audio ?? {};
  const controlCap = Math.min(64 * 1024, Math.max(0, Number.isFinite(page.transport?.controlMessageLimitBytes)
    ? page.transport.controlMessageLimitBytes : 64 * 1024));
  const ordinaryBudget = Math.min(2048 - 24, Math.max(128, controlCap - 1024));
  // A batch may retain a first-fault and a terminal st alongside ordinary telemetry.
  // Reserve all three summaries before details, the envelope and ordinary input.
  const detailBudget = Math.min(16 * 1024, Math.floor(Math.max(0, controlCap - ordinaryBudget * 3 - 4096) / 2));
  const details = [], omissions = {};
  if (debug && audioDebug) {
    const full = flatStats(audioDebug, Infinity), values = { pageVersion: PAGE_VERSION, omittedFields: 0 };
    let omitted = 0;
    if (detailBudget >= 512) {
      for (const key of audioDiagnosticKeys(full)) {
        const value = full[key];
        const candidate = { ...values, [key]: value, omittedFields: 256 };
        if (Object.keys(candidate).length > 256 || new TextEncoder().encode(JSON.stringify(candidate)).byteLength > detailBudget) omitted++;
        else values[key] = value;
      }
      values.omittedFields = omitted;
      details.push({ k: 'audio-diag', d: debugSession, v: values });
    } else omissions.audioDiagnosticOmittedFields = Object.keys(full).length;
  }
  if (debug) {
    const full = videoDiagnosticValues(page, debugSession, videoTracker ?? createVideoDiagnosticTracker());
    if (detailBudget >= 512) details.push({ k: 'video-diag', d: debugSession, v: packVideoDiagnosticValues(full, PAGE_VERSION, detailBudget) });
    else omissions.videoDiagnosticOmittedFields = Object.keys(full).length;
  } else videoTracker?.reset();
  const fullSummary = flatStats({ page: { version: PAGE_VERSION }, ...page, audio, ...omissions }, Infinity);
  // Reserve ordinary telemetry for the epoch and the five disjoint drop components before optional details.
  const summary = Object.fromEntries([...new Set(['videoDiagnosticOmittedFields', 'audioDiagnosticOmittedFields', ...SUMMARY_KEYS, ...Object.keys(fullSummary)])]
    .filter(key => key in fullSummary).map(key => [key, fullSummary[key]]));
  return [{ k: 'st', v: { ...flatStats(summary, ordinaryBudget), themeDark } }, ...details];
}
