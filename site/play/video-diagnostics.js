/*! SPDX-License-Identifier: GPL-3.0-only */
// Exact flat field allowlists. Never traverse unknown page/status objects into diagnostic events.
export const VIDEO_DIAGNOSTIC_BYTES = 16 * 1024;
export const DROP_FIELDS = ['decodeDroppedFrames', 'scheduledDroppedFrames', 'transferDroppedFrames', 'renderDroppedFrames', 'pacingDroppedFrames'];
export const VIDEO_COUNTER_FIELDS = ['readFrames', 'readFrameBytes', 'decoded', 'drawnFrames', 'records', 'bytes', 'gaps', 'discontinuities',
  'decodeErrors', 'backlogResets', 'keyRequests', 'timingRecords', 'timingRejected', 'sourceForwardPtsSamples', 'sourceReorderedPts',
  ...DROP_FIELDS, 'droppedFrames', 'scheduledExpiredFrames', 'scheduledCoalescedFrames', 'scheduledStaleFrames', 'scheduledCapacityFrames',
  'audioSyncDroppedFrames', 'audioSyncUnavailableFrames', 'videoCeilingViolations', 'touchSkippedFrames', 'expiredFrames',
  'untimedFrames', 'audioRenderSyncDroppedFrames', 'pacingRefreshDraws', 'pacingDeadlineDraws',
  'decodeStalls', 'decodeBackpressureWaits', 'decoderAbortedFrames', 'decodeOnlyFrames', 'decodedResourceDroppedFrames', 'untimedScheduledFrames'];
export const VIDEO_VALUE_FIELDS = ['currentFps', 'currentDelta', 'lastDrawAgeMs', 'frameIntervalP95Ms', 'frameIntervalMaxMs',
  'decodedFps', 'bytesPerSec', 'width', 'height', 'decodeQueueSize', 'decodedQueueSize', 'clockRttMs',
  'readFrameIntervalMsP95', 'sourceForwardPtsIntervalMsP95', 'decodeMsP50', 'decodeMsP95', 'recordReadToDecodeSubmitMsP95',
  'androidHubQueueMsP95', 'androidTransportSubmitToRecordReadMsP95', 'stageClockUncertaintyMs',
  'decodedToSchedulerMsP95', 'decodedToDrawMsP95', 'drawMsP95', 'presentationOffset90', 'presentationOffsetHigh5',
  'presentationOffsetSamples', 'senderRelativePolicyCeilingMs', 'videoCursorSpeed', 'videoCursorDeltaMs', 'decodedFrontierDeltaMs', 'touchCatchUpActive',
  'decodeBackpressureMs', 'decodedQueueFrames', 'decodedQueueBytes', 'decodeInFlightFrames', 'decodeInFlightBytes',
  'policyVideoReadinessMs', 'policyVideoMarginMs', 'policyVideoTargetMs', 'policyVideoPlanFromMs',
  'policyVideoPlanDurationMs', 'policyVideoPlanRemainingMs', 'policyVideoLeadRemainingMs',
  'policyInteractionActive', 'policyHoldRemainingMs', 'policyInteractionStarts', 'policyInteractionReleases',
  'policyProfileSwitches', 'policyPlanChanges', 'policyMaxDelayMs', 'policyMaxVideoFrames', 'policyMaxVideoBytes', 'policySubmitMarginMs',
  'sourceClockAgeMs', 'sourceClockGeneration', 'sourceClockMaxAgeMs',
  'clockEstimatorObservationAgeMs', 'clockEstimatorSelectedAgeMs'];
export const RECEIVER_FIELDS = ['retainedBytes', 'consumedBytes', 'queuedRecords', 'partialBytes', 'receivedRecords', 'receivedFragments',
  'peakRetainedBytes', 'reassemblyMsMean', 'reassemblyMsMax', 'consumerWaitMsMean', 'consumerWaitMsMax'];
export const ICE_FIELDS = ['currentRoundTripTimeMs', 'availableOutgoingBitrate', 'requestsSent', 'requestsReceived', 'responsesSent',
  'responsesReceived', 'bytesSent', 'bytesReceived', 'sampleAgeMs', 'errors'];
export const CONTROL_FIELDS = ['seq', 'inFlight', 'inFlightCount', 'pending', 'posts', 'failures', 'overflows', 'rttMsP50', 'rttMsP95'];
export const SENDER_ROOT_FIELDS = ['authenticated', 'ready', 'closed', 'nativeSampleAgeMs', 'controlMessageLimitBytes',
  'localCandidateCount', 'remoteCandidateCount', 'localIPv4LinkLocalCandidateCount', 'remoteIPv4LinkLocalCandidateCount', 'pendingWorkerTasks', 'transportBudgetMs'];
export const SENDER_MEDIA_FIELDS = ['queueBytes', 'queueRecords', 'queueLimitBytes', 'oldestQueuedAgeMs', 'receiverWindowBytes',
  'receiverReservedBytes', 'receiverConsumedBytes', 'receiverInFlightBytes', 'oldestUnackedAgeMs', 'nativeBufferedBytes',
  'acceptedRecords', 'acceptedBytes', 'fragmentsSent', 'recordsSent', 'recordBytesSent', 'wireBytesSent', 'queueWaitMsMean',
  'queueWaitMsMax', 'queuedToNativeSendMsMean', 'queuedToNativeSendMsMax'];
export const SENDER_CONTROL_FIELDS = ['nativeBufferedBytes', 'recordsSent', 'bytesSent', 'pendingReceiveTasks'];
const ENUM_FIELDS = {
  'raw.mode': ['carplay', 'airplay-mirror', 'airplay-audio'],
  'raw.codec': ['avc1', 'avc3', 'hvc1', 'hev1', 'vp8', 'vp09', 'av01'],
  'raw.acceleration': ['prefer-hardware', 'prefer-software', 'no-preference'],
  'raw.decoderImplementation': ['unknown'], 'raw.presentationTimingState': ['unobserved', 'unavailable', 'mapped-presentation'],
  'raw.pacingMode': ['display-refresh', 'immediate'],
  'raw.playbackProfile': ['default', 'carplay', 'carplay-touch', 'airplay-mirror', 'airplay-cast', 'airplay-audio'],
  'raw.policyTargetReason': ['initial', 'touch', 'readiness', 'initial-floor', 'ceiling'],
  'raw.sourceClockState': ['fresh', 'stale', 'unavailable'],
  'raw.clockEstimatorState': ['unavailable', 'suspended', 'pending-jump', 'observation-stale', 'selected-stale', 'fresh'],
  'transport.ice.state': ['collecting', 'unavailable', 'no-selected-pair', 'selected'],
  'transport.ice.localCandidateType': ['host', 'srflx', 'prflx', 'relay'],
  'transport.ice.remoteCandidateType': ['host', 'srflx', 'prflx', 'relay'], 'transport.ice.protocol': ['udp', 'tcp'],
  'transport.ice.connectionState': ['new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed'],
  'sender.networkMode': ['kernel-interfaces', 'android-network-monitor'],
};
const NATIVE_STATES = ['NEW', 'CHECKING', 'CONNECTED', 'COMPLETED', 'FAILED', 'DISCONNECTED', 'CLOSED', 'GATHERING', 'COMPLETE', 'CONNECTING'];
for (const key of ['iceGatheringState', 'iceConnectionState', 'peerConnectionState']) ENUM_FIELDS[`sender.${key}`] = NATIVE_STATES;

const BOOLEAN_FIELDS = new Set(['raw.touchCatchUpActive', 'raw.policyInteractionActive', 'control.inFlight', 'sender.authenticated', 'sender.ready', 'sender.closed', 'authenticated', 'ready', 'closed']);
const finiteNumber = value => Number.isFinite(value) && Math.abs(value) <= 9e15;
const WHOLE_POLICY_FIELDS = new Set(['policyInteractionStarts', 'policyInteractionReleases', 'policyProfileSwitches',
  'policyPlanChanges', 'policyMaxVideoFrames', 'policyMaxVideoBytes', 'sourceClockGeneration', 'sourceClockMaxAgeMs']);
const nonnegativePolicyField = key => key.startsWith('policy') || key.startsWith('sourceClock') || key.startsWith('clockEstimator');

function scalars(output, prefix, source, fields) {
  for (const key of fields) {
    const value = source?.[key];
    if (BOOLEAN_FIELDS.has(prefix + key)) {
      if (typeof value === 'boolean') output[prefix + key] = value;
      continue;
    }
    if (finiteNumber(value) && (!nonnegativePolicyField(key) || value >= 0) &&
        (!WHOLE_POLICY_FIELDS.has(key) || Number.isSafeInteger(value))) output[prefix + key] = value;
  }
}
function enums(output, source) {
  for (const [key, allowed] of Object.entries(ENUM_FIELDS)) if (allowed.includes(source[key])) output[key] = source[key];
}

/** Public session tokens and native exception text are intentionally excluded. */
export function safeSenderDiagnostics(source) {
  const result = {};
  scalars(result, '', source, SENDER_ROOT_FIELDS);
  for (const kind of ['video', 'audio']) scalars(result, `${kind}.`, source?.[kind], SENDER_MEDIA_FIELDS);
  scalars(result, 'control.', source?.control, SENDER_CONTROL_FIELDS);
  for (const key of ['networkMode', 'iceGatheringState', 'iceConnectionState', 'peerConnectionState']) {
    if (ENUM_FIELDS[`sender.${key}`].includes(source?.[key])) result[key] = source[key];
  }
  return result;
}

/** Stateful interval comparisons have only one preceding sample, never cross stream/epoch/capture boundaries. */
export function createVideoDiagnosticTracker({ now = () => performance.now() } = {}) {
  let previous = null, sample = 0;
  return {
    reset() { previous = null; },
    observe(video, capture) {
      const at = now(), generation = video?.streamGeneration, epoch = video?.epoch;
      const counts = Object.fromEntries(VIDEO_COUNTER_FIELDS.filter(key => finiteNumber(video?.[key])).map(key => [key, video[key]]));
      const valid = Number.isInteger(generation) && generation >= 0 && Number.isInteger(epoch) && epoch >= 0;
      const result = { sample: ++sample, 'interval.state': 'unavailable' };
      if (valid) {
        result.streamGeneration = generation; result.epoch = epoch;
        let state = 'baseline';
        if (previous) {
          if (previous.capture !== capture) state = 'capture-change';
          else if (previous.generation !== generation || previous.epoch !== epoch || previous.mode !== video.mode) state = 'source-change';
          else if (Object.keys(counts).some(key => previous.counts[key] !== undefined && counts[key] < previous.counts[key])) state = 'counter-reset';
          else if (at > previous.at) {
            state = 'valid'; result['interval.durationMs'] = at - previous.at;
            for (const [key, value] of Object.entries(counts)) if (previous.counts[key] !== undefined) result[`interval.${key}`] = value - previous.counts[key];
          }
        }
        result['interval.state'] = state;
        previous = { capture, generation, epoch, mode: video.mode, at, counts };
      } else previous = null;
      return result;
    },
  };
}

export function videoDiagnosticValues(page, capture, tracker) {
  const video = page.video ?? {}, result = { schema: 1, ...tracker.observe(video, capture) };
  scalars(result, 'raw.', video, [...VIDEO_COUNTER_FIELDS, ...VIDEO_VALUE_FIELDS]);
  const codec = typeof video.codec === 'string' ? video.codec.split('.')[0] : null;
  const selectedEnums = { 'raw.codec': codec, ...Object.fromEntries(['mode', 'acceleration', 'decoderImplementation', 'presentationTimingState', 'pacingMode', 'playbackProfile', 'policyTargetReason', 'sourceClockState', 'clockEstimatorState']
    .map(key => [`raw.${key}`, video[key]])) };
  result['raw.pipelineCounterScope'] = 'pipeline-lifetime'; result['raw.decodeDropCounterScope'] = 'epoch-reset'; result['raw.schedulerCounterScope'] = 'epoch-reset';
  result['raw.transferCounterScope'] = 'epoch-reset'; result['raw.renderCounterScope'] = 'epoch-reset';
  result['raw.stageSampleScope'] = 'rolling-may-span-epochs'; result['raw.touchSubset'] = 'scheduledDroppedFrames';
  result['raw.schedulerReasonSubset'] = 'scheduledDroppedFrames';
  scalars(result, 'transport.video.', page.transport?.video, RECEIVER_FIELDS);
  scalars(result, 'transport.ice.', page.transport?.ice, ICE_FIELDS);
  scalars(result, 'control.', page.control, CONTROL_FIELDS);
  scalars(result, 'sender.', page.sender, SENDER_ROOT_FIELDS);
  // page.sender is already flat; flatten only exact permitted names, never traverse arbitrary status properties.
  for (const kind of ['video', 'audio']) for (const key of SENDER_MEDIA_FIELDS) {
    const value = page.sender?.[`${kind}.${key}`]; if (finiteNumber(value)) result[`sender.${kind}.${key}`] = value;
  }
  for (const key of SENDER_CONTROL_FIELDS) {
    const value = page.sender?.[`control.${key}`]; if (finiteNumber(value)) result[`sender.control.${key}`] = value;
  }
  for (const key of Object.keys(ENUM_FIELDS)) {
    if (key.startsWith('sender.')) selectedEnums[key] = page.sender?.[key.slice(7)];
    else if (key.startsWith('transport.ice.')) selectedEnums[key] = page.transport?.ice?.[key.slice(14)];
  }
  enums(result, selectedEnums);
  return result;
}

/** Exact candidate key set used by the receiver allowlist; values remain restricted separately. */
export const VIDEO_DIAGNOSTIC_FIELDS = [
  'schema', 'pageVersion', 'omittedFields', 'sample', 'streamGeneration', 'epoch', 'interval.state', 'interval.durationMs',
  ...VIDEO_COUNTER_FIELDS.map(key => `interval.${key}`), ...[...VIDEO_COUNTER_FIELDS, ...VIDEO_VALUE_FIELDS].map(key => `raw.${key}`),
  'raw.pipelineCounterScope', 'raw.decodeDropCounterScope', 'raw.schedulerCounterScope', 'raw.transferCounterScope', 'raw.renderCounterScope', 'raw.stageSampleScope',
  'raw.touchSubset', 'raw.schedulerReasonSubset', ...RECEIVER_FIELDS.map(key => `transport.video.${key}`), ...ICE_FIELDS.map(key => `transport.ice.${key}`),
  ...CONTROL_FIELDS.map(key => `control.${key}`), ...SENDER_ROOT_FIELDS.map(key => `sender.${key}`),
  ...['video', 'audio'].flatMap(kind => SENDER_MEDIA_FIELDS.map(key => `sender.${kind}.${key}`)),
  ...SENDER_CONTROL_FIELDS.map(key => `sender.control.${key}`), ...Object.keys(ENUM_FIELDS),
];

/** Preserve booleans and enforce the receiver's UTF-8 byte/field budgets independently of ordinary st telemetry. */
export function packVideoDiagnosticValues(source, pageVersion, byteLimit = VIDEO_DIAGNOSTIC_BYTES) {
  const allowed = new Set(VIDEO_DIAGNOSTIC_FIELDS), utf8 = new TextEncoder();
  const result = { pageVersion, omittedFields: 0 };
  let omitted = 0;
  const priority = ['schema', 'sample', 'streamGeneration', 'epoch', 'raw.mode', 'raw.droppedFrames', ...DROP_FIELDS.map(key => `raw.${key}`),
    'raw.readFrames', 'raw.decoded', 'raw.drawnFrames', 'raw.touchSkippedFrames', 'raw.scheduledCoalescedFrames', 'raw.scheduledStaleFrames',
    'raw.scheduledCapacityFrames', 'raw.touchSubset', 'raw.schedulerReasonSubset', 'interval.state', 'interval.durationMs',
    ...['playbackProfile', 'policyVideoReadinessMs', 'policyVideoMarginMs', 'policyVideoTargetMs', 'policyVideoPlanFromMs',
      'policyVideoPlanDurationMs', 'policyVideoPlanRemainingMs', 'policyVideoLeadRemainingMs', 'policyTargetReason',
      'policyInteractionActive', 'policyHoldRemainingMs', 'policyInteractionStarts', 'policyInteractionReleases',
      'policyProfileSwitches', 'policyPlanChanges', 'policyMaxDelayMs', 'policyMaxVideoFrames', 'policyMaxVideoBytes',
      'policySubmitMarginMs', 'sourceClockState', 'sourceClockAgeMs', 'sourceClockGeneration', 'sourceClockMaxAgeMs',
      'clockEstimatorState', 'clockEstimatorObservationAgeMs', 'clockEstimatorSelectedAgeMs',
      'stageClockUncertaintyMs'].map(key => `raw.${key}`)];
  for (const key of [...new Set([...priority, ...Object.keys(source)])]) {
    if (!(key in source)) continue;
    const original = source[key];
    if (!allowed.has(key) || key === 'pageVersion' || key === 'omittedFields') continue;
    const value = finiteNumber(original) ? Number.isInteger(original) ? original : Math.round(original * 100) / 100 : original;
    const candidate = { ...result, [key]: value, omittedFields: 256 };
    if (Object.keys(candidate).length > 256 || utf8.encode(JSON.stringify(candidate)).byteLength > Math.min(VIDEO_DIAGNOSTIC_BYTES, byteLimit)) omitted++;
    else result[key] = value;
  }
  result.omittedFields = omitted;
  return result;
}
