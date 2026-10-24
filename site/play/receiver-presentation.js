/*! SPDX-License-Identifier: GPL-3.0-only */
const ACTIVE_AIRPLAY = new Set(['mirror', 'video', 'loading', 'playing', 'paused', 'photo', 'audio']);
const FAILED_AIRPLAY = new Set(['failed', 'discovery-failed', 'audio-failed', 'playback-failed']);

const configSource = config => config?.mode?.startsWith('airplay') ? 'airplay' : config?.mode === 'carplay' ? 'carplay' : null;

/** Modern receiver snapshots explicitly report no producer; an old config cannot restore it. */
export function videoSourceFor(status, config) {
  if (status && Object.hasOwn(status, 'videoSource')) return ['carplay', 'airplay'].includes(status.videoSource) ? status.videoSource : null;
  return configSource(config);
}

export function airPlayContext(status, config) {
  const playback = status?.airplay;
  return status?.receivers?.carplay?.state === 'suspended' || videoSourceFor(status, config) === 'airplay'
    || playback?.kind === 'audio' || Boolean(playback?.resource && playback.outputAllowed !== false)
    || ACTIVE_AIRPLAY.has(status?.receivers?.airplay?.state);
}

export function airPlayFailed(status) {
  return FAILED_AIRPLAY.has(status?.receivers?.airplay?.state);
}

/** Independent URL/photo/audio output must not inherit a previous producer's codec failure. */
export function videoProblemFor(status, config, unsupported) {
  if (!unsupported) return null;
  const playback = status?.airplay;
  if (playback?.kind === 'audio' || playback?.resource && playback.outputAllowed !== false) return null;
  const source = videoSourceFor(status, config);
  if (!source || source !== configSource(config)) return null;
  return unsupported;
}

export function videoReadyFor(status, config, live) {
  const source = videoSourceFor(status, config);
  return Boolean(live && source && source === configSource(config));
}

/** Attribute an observed fault to the current or immediately preceding casting attempt only. */
export function createReceiverNoticeTracker() {
  let foreground = false, resource = null, serial = 0, lastState = null, lastRevision = null, lastNotice = null;
  let ignoredFailure = false, ignoredRevision = null;
  return {
    reset() { foreground = false; resource = null; lastState = lastRevision = lastNotice = null; ignoredFailure = false; ignoredRevision = null; },
    observe(status, config) {
      const current = airPlayContext(status, config), state = status?.receivers?.airplay?.state;
      const candidate = status?.receivers?.airplay?.revision;
      const revision = Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
      const playback = status?.airplay;
      const identity = playback ? `${playback.id}:${playback.kind}:${playback.resource ?? ''}`
        : videoSourceFor(status, config) === 'airplay' && configSource(config) === 'airplay' && Number.isSafeInteger(config?.epoch)
          ? `video:${config.epoch}` : null;
      const newAttempt = current && (!foreground || identity !== null && identity !== resource);
      let resetId = null;
      if (newAttempt) {
        serial++; resetId = lastNotice; lastNotice = null;
        ignoredFailure = airPlayFailed(status) && FAILED_AIRPLAY.has(lastState)
          && !(revision !== null && lastRevision !== null && revision > lastRevision);
        ignoredRevision = ignoredFailure ? revision : null;
      }
      if (!airPlayFailed(status)) ignoredFailure = false;
      if (ignoredFailure && revision !== null && ignoredRevision !== null && revision > ignoredRevision) ignoredFailure = false;
      let noticeId = null;
      // Repeating an old label cannot establish a fault on the replacement item.
      const failure = airPlayFailed(status) && (current || foreground) && !ignoredFailure;
      if (failure) {
        noticeId = lastNotice = `airplay:${serial}`;
      }
      foreground = current; resource = current ? identity : null; lastState = state; lastRevision = revision;
      return { resetId, noticeId, failure };
    },
  };
}
