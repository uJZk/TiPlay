// SPDX-License-Identifier: GPL-3.0-only
const EVENTS = new Set(['open', 'probe-start', 'probe-ready', 'open-error',
  'directive-seek', 'directive-play', 'directive-pause', 'play-resolved', 'play-rejected',
  'loadedmetadata', 'play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ratechange', 'ended', 'error',
  'drag-start', 'drag-end', 'drag-cancel', 'canvas-error', 'explicit-stop']);
const ERROR_NAMES = new Set(['NotAllowedError', 'AbortError', 'NotSupportedError', 'InvalidStateError',
  'SecurityError', 'TypeError', 'RangeError', 'NetworkError', 'EncodingError']);
const MEDIA_EVENTS = ['loadedmetadata', 'play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ratechange', 'ended', 'error'];

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
export function airplayDiagnostic(event, state, { media, dragging = false, error } = {}) {
  if (!EVENTS.has(event) || !Number.isSafeInteger(state?.id) || state.id < 1 ||
      !Number.isSafeInteger(state.revision) || state.revision < 0) return null;
  const result = { k: 'ap-diag', id: state.id, revision: state.revision, event, dragging: dragging === true };
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

/** Observe edges only. Retired players and periodic playback reports produce no diagnostics. */
export function createAirPlayDiagnostics(send, { state, media = () => null, active = () => true }) {
  let disposed = false, dragging = false;
  const listeners = [];
  function event(name, error, source) {
    if (disposed || !active()) return;
    // Diagnostics must not interrupt media commands or error handling.
    try {
      const entry = airplayDiagnostic(name, source ?? state(), { media: media(), dragging, error });
      if (entry) send(entry);
    } catch (_) {}
  }
  function listen(target, name, callback, capture = false) {
    target.addEventListener(name, callback, capture);
    listeners.push(() => target.removeEventListener(name, callback, capture));
  }
  return {
    event,
    monitor(target, surface) {
      for (const name of MEDIA_EVENTS) listen(target, name, received => event(name, received.error));
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
