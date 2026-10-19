/*! SPDX-License-Identifier: GPL-3.0-only */
import { flatStats } from './link.js';

// Keep this identifier in step with the offline cache; the receiver records the loaded page.
export const PAGE_VERSION = 'v67';
export const AUDIO_DIAGNOSTIC_BYTES = 16 * 1024;
const SUMMARY_KEYS = [
  'page.version', 'link.path', 'link.reconnects',
  'transport.ice.state', 'transport.ice.localCandidateType', 'transport.ice.remoteCandidateType',
  'transport.ice.protocol', 'transport.ice.currentRoundTripTimeMs', 'transport.ice.sampleAgeMs',
  'transport.ice.availableOutgoingBitrate', 'transport.ice.requestsSent', 'transport.ice.requestsReceived',
  'transport.ice.responsesSent', 'transport.ice.responsesReceived', 'transport.ice.bytesSent', 'transport.ice.bytesReceived',
  'transport.video.reassemblyMsMax', 'transport.video.consumerWaitMsMax',
  'transport.video.receivedRecords', 'transport.video.queuedRecords',
  'video.codec', 'video.currentFps', 'video.currentDelta', 'video.droppedFrames',
  'video.frameIntervalP95Ms', 'video.frameIntervalMaxMs', 'video.lastDrawAgeMs',
  'video.pacingMode', 'video.pacingDroppedFrames', 'video.decodedFps', 'video.decodeQueueSize',
  'video.androidHubQueueMsP95', 'video.androidTransportSubmitToRecordReadMsP95',
  'video.recordReadToDecodeSubmitMsP95', 'video.decodeMsP95',
  'video.decodedToSchedulerMsP95', 'video.decodedToDrawMsP95', 'video.drawMsP95', 'video.timingRecords', 'video.timingRejected',
  'video.clockRttMs', 'video.presentationOffset90', 'video.presentationOffsetHigh5',
  'video.presentationOffsetSamples', 'video.gaps', 'video.dropped', 'video.decodeErrors',
  'control.rttMsP50', 'control.rttMsP95', 'control.pending', 'control.failures',
  'audio.bluetooth', 'audio.sound', 'audio.timedPackets', 'audio.fallbackPackets', 'audio.queuedBytes',
];

/** Audio details have their own budget, so video stats cannot crowd out render evidence. */
export function browserDiagnosticEvents(page, themeDark, debug = false, debugSession = null) {
  const { debug: audioDebug, ...audio } = page.audio ?? {};
  const fullSummary = flatStats({ page: { version: PAGE_VERSION }, ...page, audio }, Infinity);
  // Source/decode counters must not crowd out pacing or touch RTT when this bounded
  // summary grows. Keep the remaining details opportunistically within the same cap.
  const summary = Object.fromEntries([...new Set([...SUMMARY_KEYS, ...Object.keys(fullSummary)])]
    .filter(key => key in fullSummary).map(key => [key, fullSummary[key]]));
  const events = [{ k: 'st', v: { ...flatStats(summary, 2048 - 24), themeDark } }];
  if (debug && audioDebug) {
    const full = flatStats(audioDebug, Infinity);
    // The receiver admits at most 256 fields, including these two metadata fields.
    const values = Object.fromEntries(Object.entries(flatStats(audioDebug, AUDIO_DIAGNOSTIC_BYTES - 128)).slice(0, 254));
    const omitted = Object.keys(full).length - Object.keys(values).length;
    values.pageVersion = PAGE_VERSION;
    values.omittedFields = omitted;
    events.push({ k: 'audio-diag', d: debugSession, v: values });
  }
  return events;
}
