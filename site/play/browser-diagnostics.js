/*! SPDX-License-Identifier: GPL-3.0-only */
import { flatStats } from './link.js';
import { createVideoDiagnosticTracker, videoDiagnosticValues, packVideoDiagnosticValues } from './video-diagnostics.js';
export { VIDEO_DIAGNOSTIC_BYTES } from './video-diagnostics.js';

// Keep this identifier in step with the offline cache; the receiver records the loaded page.
export const PAGE_VERSION = 'v72';
export const AUDIO_DIAGNOSTIC_BYTES = 16 * 1024;
const SUMMARY_KEYS = [
  'page.version', 'video.streamGeneration', 'video.epoch', 'video.droppedFrames',
  'video.decodeDroppedFrames', 'video.scheduledDroppedFrames', 'video.transferDroppedFrames', 'video.renderDroppedFrames', 'video.pacingDroppedFrames',
  'link.path', 'link.reconnects', 'link.failure.reason', 'link.failure.stage',
  'link.connection.stage', 'link.connection.localCandidates', 'link.connection.localUdpCandidates',
  'link.connection.remoteCandidates', 'link.connection.remoteUdpCandidates',
  'transport.transport', 'transport.state', 'transport.stage', 'transport.reason', 'transport.generation',
  'transport.queuedBytes', 'transport.highWaterBytes', 'transport.reassemblyErrors',
  'transport.controlFailures', 'transport.iceState', 'transport.connectionState',
  'audio.sourceDeadlineState', 'audio.sourceDeadlineReason', 'audio.sourceDeltaUpperMs',
  'audio.sourceDeadlineRejectedFrames', 'audio.sourceDeadlineStream', 'audio.sourceDeadlineEpoch',
  'video.playbackProfile', 'video.decodedQueueFrames', 'video.decodedQueueBytes', 'video.decodedResourceDroppedFrames',
  'video.decodeStalls', 'video.decodeErrors', 'video.decodeQueueSize',
  'control.rttMsP50', 'control.rttMsP95', 'control.pending', 'control.failures',
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
];

/** Audio details have their own budget, so video stats cannot crowd out render evidence. */
export function browserDiagnosticEvents(page, themeDark, debug = false, debugSession = null, videoTracker = null) {
  const { debug: audioDebug, ...audio } = page.audio ?? {};
  const controlCap = Math.min(64 * 1024, Math.max(0, Number.isFinite(page.transport?.controlMessageLimitBytes)
    ? page.transport.controlMessageLimitBytes : 64 * 1024));
  const ordinaryBudget = Math.min(2048 - 24, Math.max(128, controlCap - 1024));
  // These events can share one existing control batch. Leave room for its envelope and ordinary user input.
  const detailBudget = Math.min(16 * 1024, Math.floor(Math.max(0, controlCap - ordinaryBudget - 4096) / 2));
  const details = [], omissions = {};
  if (debug && audioDebug) {
    const full = flatStats(audioDebug, Infinity), values = { pageVersion: PAGE_VERSION, omittedFields: 0 };
    let omitted = 0;
    if (detailBudget >= 512) {
      for (const [key, value] of Object.entries(full)) {
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
