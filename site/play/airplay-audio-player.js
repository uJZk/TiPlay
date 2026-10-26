// SPDX-License-Identifier: GPL-3.0-only
const emptyRanges = Object.freeze({ length: 0, start() { throw new DOMException('No media range', 'IndexSizeError'); }, end() { throw new DOMException('No media range', 'IndexSizeError'); } });
const range = end => end > 0 ? { length: 1, start: () => 0, end: () => end } : emptyRanges;
const tracks = () => Object.assign(new EventTarget(), { length: 0, *[Symbol.iterator]() {} });
const finite = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, value) : fallback;

/** Native-like control facade for an already playing receiver stream. Receiver
 * snapshots own time and transport state; this creates no clock or audio graph. */
export function createAirPlayAudioMedia({ onPlay, onPause, onSeek, onPrevious, onNext, onSkipBack, onSkipForward } = {}) {
  const media = new EventTarget();
  let state = { position: 0, duration: 0, playing: false, buffering: false, ready: false,
    seekable: false, canPause: false, canPlay: false, canPrevious: false, canNext: false,
    canSkipBack: false, canSkipForward: false, ended: false, error: null };
  let disposed = false, seeking = false;
  const event = type => { if (!disposed) media.dispatchEvent(new Event(type)); };
  const property = (name, get, set) => Object.defineProperty(media, name, { get, ...(set ? { set } : {}) });
  const invoke = callback => {
    try { return Promise.resolve(callback?.()); } catch (cause) { return Promise.reject(cause); }
  };
  property('currentTime', () => state.position, target => {
    if (disposed || !state.seekable || !onSeek || !Number.isFinite(target)) return;
    const value = Math.min(state.duration, Math.max(0, target));
    seeking = true; event('seeking');
    void invoke(() => onSeek(value)).catch(() => { seeking = false; event('seeked'); });
  });
  property('duration', () => state.duration || NaN);
  property('paused', () => !state.playing);
  property('ended', () => state.ended);
  property('seeking', () => seeking);
  property('buffering', () => state.buffering);
  property('readyState', () => state.ready ? state.buffering ? 2 : 4 : 0);
  property('networkState', () => state.ready ? 1 : 2);
  property('seekable', () => state.seekable ? range(state.duration) : emptyRanges);
  property('buffered', () => state.ready ? range(state.duration || state.position) : emptyRanges);
  property('error', () => state.error);
  property('canPrevious', () => state.canPrevious && typeof onPrevious === 'function');
  property('canNext', () => state.canNext && typeof onNext === 'function');
  property('canSkipBack', () => state.canSkipBack && typeof onSkipBack === 'function');
  property('canSkipForward', () => state.canSkipForward && typeof onSkipForward === 'function');
  property('playbackRate', () => 1, () => {});
  property('defaultPlaybackRate', () => 1, () => {});
  property('volume', () => 1, () => {});
  property('muted', () => false, () => {});
  Object.assign(media, { audioTracks: tracks(), textTracks: tracks(), src: '', currentSrc: '',
    autoplay: false, preload: 'none', videoWidth: 0, videoHeight: 0,
    querySelectorAll: () => [], querySelector: () => null,
    play() {
      if (disposed) return Promise.reject(new DOMException('Audio controls were disposed', 'AbortError'));
      return state.canPlay && onPlay ? invoke(onPlay) : Promise.resolve();
    },
    pause() { if (!disposed && state.canPause && onPause) void invoke(onPause).catch(() => {}); },
    previous() {
      if (disposed) return Promise.reject(new DOMException('Audio controls were disposed', 'AbortError'));
      return media.canPrevious ? invoke(onPrevious) : Promise.resolve();
    },
    next() {
      if (disposed) return Promise.reject(new DOMException('Audio controls were disposed', 'AbortError'));
      return media.canNext ? invoke(onNext) : Promise.resolve();
    },
    skipBack() {
      if (disposed) return Promise.reject(new DOMException('Audio controls were disposed', 'AbortError'));
      return media.canSkipBack ? invoke(onSkipBack) : Promise.resolve();
    },
    skipForward() {
      if (disposed) return Promise.reject(new DOMException('Audio controls were disposed', 'AbortError'));
      return media.canSkipForward ? invoke(onSkipForward) : Promise.resolve();
    },
    load() {}, canPlayType: () => '',
    update(next = {}) {
      if (disposed) return;
      const previous = state;
      const duration = finite(next.duration, state.duration);
      const position = Math.min(duration || Infinity, finite(next.position, state.position));
      state = { ...state, ...next, duration, position, canPause: next.canPause === true,
        canPlay: (next.canPlay ?? next.canPause) === true,
        canPrevious: next.canPrevious === true, canNext: next.canNext === true,
        canSkipBack: next.canSkipBack === true, canSkipForward: next.canSkipForward === true,
        seekable: next.seekable === true && duration > 0 && Boolean(onSeek),
        ready: next.ready !== false, error: next.error ? { code: 3, message: String(next.error.message || next.error) } : null };
      if (!previous.ready && state.ready) { event('loadedmetadata'); event('loadeddata'); }
      if (duration !== previous.duration) event('durationchange');
      if (seeking) { seeking = false; event('seeked'); }
      if (state.position !== previous.position) event('timeupdate');
      if (state.playing !== previous.playing) event(state.playing ? 'play' : 'pause');
      if (state.buffering) event('waiting');
      else if (state.ready) { event('canplay'); if (state.playing) event('playing'); }
      if (state.ended && !previous.ended) event('ended');
      if (state.error) event('error');
      event('progress');
    },
    dispose() { disposed = true; },
  });
  return media;
}
