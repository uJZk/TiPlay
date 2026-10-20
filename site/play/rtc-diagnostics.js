/*! SPDX-License-Identifier: GPL-3.0-only */
const STAGES = new Set(['local-ice', 'pairing', 'remote-ice', 'dc-auth', 'connected']);
const STATES = new Set(['new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed', 'gathering', 'complete', 'connecting']);

/** Counts only: addresses, SDP credentials and certificate material never enter diagnostic snapshots. */
export function candidateCounts(sdp) {
  let total = 0, linkLocal = 0;
  for (const line of String(sdp ?? '').split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    total++;
    const address = line.trim().split(/\s+/)[4];
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(address ?? '')) linkLocal++;
  }
  return { total, linkLocal };
}

export function rtcFailureReason(error) {
  if (error?.status === 404) return 'missing-interface';
  if (error?.status === 503) return 'android-signaling';
  if (error?.status === 429) return 'throttled';
  if (error?.status === 401) return 'bad-code';
  if (error?.status === 409) return 'replaced';
  if (['fetch', 'pairing', 'bad-response', 'timeout', 'ice', 'unsupported'].includes(error?.rtcReason)) return error.rtcReason;
  const message = String(error?.message ?? '');
  if (/timed? out|timeout/i.test(message)) return 'timeout';
  if (/WebRTC DataChannel is unavailable/.test(message)) return 'unsupported';
  if (/RTC (failed|disconnected)|channel (closed|error)/.test(message)) return 'ice';
  return 'connection';
}

/** Safe to display or capture even when a native exception's message contains SDP. */
export function rtcFailureSummary(error) {
  const source = error?.rtcDiagnostic ?? {};
  const result = { reason: rtcFailureReason(error), stage: STAGES.has(source.stage) ? source.stage : null };
  for (const key of ['localCandidates', 'localLinkLocalCandidates', 'remoteCandidates', 'remoteLinkLocalCandidates']) {
    result[key] = Number.isInteger(source[key]) && source[key] >= 0 ? source[key] : null;
  }
  for (const key of ['iceState', 'gatheringState', 'connectionState']) {
    result[key] = STATES.has(source[key]) ? source[key] : null;
  }
  return result;
}
