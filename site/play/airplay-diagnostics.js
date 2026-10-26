// SPDX-License-Identifier: GPL-3.0-only
const EVENTS = new Set(['open', 'probe-start', 'probe-ready', 'open-error',
  'directive-seek', 'directive-play', 'directive-pause', 'play-resolved', 'play-rejected',
  'loadedmetadata', 'play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ratechange', 'ended', 'error',
  'drag-start', 'drag-end', 'drag-cancel', 'canvas-error', 'explicit-stop', 'proxy-fallback', 'resync', 'engine-state']);
const ERROR_NAMES = new Set(['NotAllowedError', 'AbortError', 'NotSupportedError', 'InvalidStateError',
  'SecurityError', 'TypeError', 'RangeError', 'NetworkError', 'EncodingError', 'TimeoutError']);
const MEDIA_EVENTS = ['loadedmetadata', 'play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ratechange', 'ended', 'error'];
const ENGINE_ENUMS = Object.freeze({
  engine: new Set(['libmedia-avplayer']),
  renderMode: new Set(['canvas']),
  startupPhase: new Set(['none', 'dependencies', 'metadata', 'first-samples', 'ready', 'playing']),
  waitReason: new Set(['none', 'no-source', 'paused', 'seeking', 'preparing', 'buffering', 'ended', 'error',
    'audio-context-suspended', 'unknown']),
});
const ENGINE_FLAGS = ['running', 'intentPlaying', 'gestureRequired'];
const ENGINE_NUMBERS = ['generation', 'position', 'manualPlaybackRate', 'effectivePlaybackRate',
  'openElapsedMs', 'codedWidth', 'codedHeight', 'stallCount',
  'audioPacketQueueLength', 'videoPacketQueueLength', 'audioFrameDecodeCount', 'videoFrameDecodeCount',
  'audioFrameRenderCount', 'videoFrameRenderCount', 'audioStutter', 'videoStutter'];
const ENGINE_WHOLE = new Set(['generation', 'codedWidth', 'codedHeight', 'stallCount',
  'audioPacketQueueLength', 'videoPacketQueueLength', 'audioFrameDecodeCount', 'videoFrameDecodeCount',
  'audioFrameRenderCount', 'videoFrameRenderCount', 'audioStutter', 'videoStutter']);
const ENGINE_DIMENSIONS = new Set(['codedWidth', 'codedHeight']);
const CODEC = /^(?:avc|h264|hevc|h265|vp8|vp9|av1|avc1|avc3|hvc1|hev1|vp09|av01|mp4v)(?:\.[a-z0-9]{1,16}){0,9}$/i;
const ENGINE_SIGNATURE = ['generation', 'engine', 'renderMode', 'startupPhase', 'running', 'intentPlaying',
  'waitReason', 'gestureRequired', 'stallCount'];

/** A fixed scalar schema: never forward a media object, resource location or decoder configuration. */
export function playbackDiagnostics(media) {
  try { return sanitizePlaybackDiagnostics(media?.getPlaybackDiagnostics?.()); }
  catch (_) { return null; }
}

/** The same selector sanitizes live reads and exceptional snapshots captured before cleanup. */
export function sanitizePlaybackDiagnostics(source) {
  try {
    if (!source || typeof source !== 'object') return null;
    const result = {};
    for (const [key, values] of Object.entries(ENGINE_ENUMS)) if (values.has(source[key])) result[key] = source[key];
    if (typeof source.codec === 'string' && source.codec.length <= 48 && CODEC.test(source.codec)) result.codec = source.codec;
    for (const key of ENGINE_FLAGS) if (typeof source[key] === 'boolean') result[key] = source[key];
    for (const key of ENGINE_NUMBERS) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
          (!ENGINE_WHOLE.has(key) || Number.isSafeInteger(value)) && (!ENGINE_DIMENSIONS.has(key) || value <= 32768))
        result[key] = Math.abs(value) < 1e12 ? Math.round(value * 1000) / 1000 : value;
    }
    return Object.keys(result).length ? result : null;
  } catch (_) { return null; }
}

/** Match Android's DiagnosticErrorText; redact complete values before limiting the output. */
export function sanitizeErrorText(value) {
  if (typeof value !== 'string') return '';
  if (value.length > 4096) return '[message omitted: too long]';
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, '[credential]')
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi, '[credential]')
    .replace(/\b[a-z][a-z0-9+.-]*(?::\/\/|%3a%2f%2f)[^\s<>"']+/gi, '[url]')
    .replace(/\b(?:data|blob):[^\s<>"']+/gi, '[url]')
    .replace(/\b(?:[A-Za-z0-9._~%+-]+\/)*[A-Za-z0-9._~%+-]+\?[^\s<>"']+/g, '[url]')
    .replace(/\/(?:[^\s<>"']*)\?[^\s<>"']*/g, '[url]')
    .replace(/\b(?:bearer|basic)\s+[^\s,;<>"']+/gi, '[credential]')
    .replace(/\b(password|passphrase|passwd|token|(?:access|refresh|auth)[-_]?token|api[-_]?key|secret|private[-_ ]?key|session(?:[-_]?id)?|pair(?:ing)?(?:[-_ ]?(?:id|code|record))?|code|c|s)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;&<>"']+)/gi, '$1=[redacted]')
    .replace(/(pair(?:ing)?[-_ ]+(?:code|id|record))\s+(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;<>"']+)/gi, '$1=[redacted]')
    .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '[address]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[identifier]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '[address]')
    .replace(/\[[0-9a-f:.%]+\](?::\d{1,5})?/gi, '[address]')
    .replace(/(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.]*(?:%[A-Za-z0-9_.-]+)?/gi, '[address]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[identifier]')
    .replace(/[A-Za-z0-9_+\/=.-]{32,}/g, '[identifier]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Only bounded state, known names and redacted exception text cross to Android. */
export function airplayDiagnostic(event, state, { media, dragging = false, error, engineSnapshot } = {}) {
  if (!EVENTS.has(event) || !Number.isSafeInteger(state?.id) || state.id < 1 ||
      !Number.isSafeInteger(state.revision) || state.revision < 0) return null;
  const result = { k: 'ap-diag', id: state.id, revision: state.revision, event, dragging: dragging === true };
  const engine = engineSnapshot === undefined ? playbackDiagnostics(media) : sanitizePlaybackDiagnostics(engineSnapshot);
  if (engine) result.engine = engine;
  for (const [field, value] of [['position', media?.currentTime], ['duration', media?.duration], ['rate', media?.playbackRate]])
    if (Number.isFinite(value) && value >= 0) result[field] = value;
  for (const field of ['paused', 'ended', 'seeking'])
    if (typeof media?.[field] === 'boolean') result[field] = media[field];
  for (const [field, maximum] of [['readyState', 4], ['networkState', 3]]) {
    const value = media?.[field];
    if (Number.isInteger(value) && value >= 0 && value <= maximum) result[field] = value;
  }
  const code = media?.error?.code;
  if (Number.isInteger(code) && code >= 1 && code <= 5) result.errorCode = code;
  const failure = error ?? media?.error;
  if (failure != null) {
    let name;
    try { name = failure.name; } catch (_) {}
    result.errorName = ERROR_NAMES.has(name) ? name : 'OTHER';
    try {
      const text = sanitizeErrorText(failure.message);
      if (text) result.errorText = text;
    } catch (_) {}
  }
  return result;
}

/** Edges and bounded engine snapshots survive a stuck play promise without logging media payloads. */
export function createAirPlayDiagnostics(send, { state, media = () => null, active = () => true,
  now = () => performance.now() } = {}) {
  let disposed = false, dragging = false;
  let lastProbe = -Infinity, lastSample = -Infinity, lastSignature = null;
  const listeners = [];
  function event(name, error, source, engineSnapshot) {
    if (disposed || !active()) return;
    // Diagnostics must not interrupt media commands or error handling.
    try {
      const current = state();
      const entry = airplayDiagnostic(name, source ?? current, { media: media(), dragging, error, engineSnapshot });
      // A settled command keeps its original revision, but cannot attach a newer generation's snapshot.
      if (entry && source && (source.id !== current?.id || source.revision !== current?.revision)) delete entry.engine;
      if (entry) send(entry);
    } catch (_) {}
  }
  function listen(target, name, callback, capture = false) {
    target.addEventListener(name, callback, capture);
    listeners.push(() => target.removeEventListener(name, callback, capture));
  }
  function sample() {
    if (disposed || !active()) return;
    const time = now();
    // Rate-limit before reading upstream player statistics; these are observations, not a watchdog.
    if (time - lastProbe < 250) return;
    lastProbe = time;
    const engine = playbackDiagnostics(media());
    if (!engine) return;
    const signature = JSON.stringify(ENGINE_SIGNATURE.map(key => engine[key] ?? null));
    const stalled = engine.intentPlaying === true && engine.running === false;
    if (time - lastSample < (signature === lastSignature ? stalled ? 5000 : 10000 : 250)) return;
    lastSample = time; lastSignature = signature;
    event('engine-state');
  }
  return {
    event,
    monitor(target, surface) {
      for (const name of MEDIA_EVENTS) listen(target, name, received => {
        if (name !== 'error') { event(name, received.error); return; }
        let failure, before, after;
        try { failure = received.error; } catch (_) {}
        try { before = sanitizePlaybackDiagnostics(received.playbackDiagnostics); } catch (_) {}
        try { after = sanitizePlaybackDiagnostics(received.cleanupDiagnostics); } catch (_) {}
        event(name, failure, undefined, before ?? undefined);
        // Both entries must enter the control queue before the next listener can retire this player.
        if (after && JSON.stringify(after) !== JSON.stringify(before)) event('engine-state', undefined, undefined, after);
      });
      listen(target, 'resync', () => event('resync'));
      for (const name of ['timeupdate', 'progress']) listen(target, name, sample);
      const timeSlider = received => received.target?.localName === 'media-time-slider' ||
        received.target?.closest?.('media-time-slider');
      listen(surface, 'drag-start', received => {
        if (!timeSlider(received)) return;
        dragging = true; event('drag-start');
      });
      listen(surface, 'drag-end', received => {
        if (!timeSlider(received)) return;
        dragging = false; event('drag-end');
      });
      // Capture observes cancellation even when the player stops pointer-event bubbling.
      listen(surface, 'pointercancel', received => {
        if (!timeSlider(received)) return;
        dragging = false; event('drag-cancel');
      }, true);
    },
    dispose() {
      disposed = true;
      for (const remove of listeners) remove();
      listeners.length = 0;
    },
  };
}
