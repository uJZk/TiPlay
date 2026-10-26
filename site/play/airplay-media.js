// SPDX-License-Identifier: GPL-3.0-only
import { audioTrackLabel, createAudioTrackList, preferredAudioTrack } from './airplay-audio-tracks.js';
import { mediaTimeRanges } from './media-ranges.js';
import { createSubtitleTrackList } from './airplay-track-menu.js';
import { sanitizePlaybackDiagnostics } from './airplay-diagnostics.js';

const libraries = new WeakMap();
const interrupted = () => new DOMException('Media playback was interrupted.', 'AbortError');
const abortable = (promise, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(interrupted());
  if (signal.aborted) { abort(); return; }
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
const withDeadline = async (promise, milliseconds) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DOMException('URL media preparation timed out.', 'TimeoutError')), milliseconds);
  })]); } finally { clearTimeout(timer); }
};
const seconds = value => Number(value || 0) / 1000;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rateValue = value => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < .5 || rate > 2)
    throw new DOMException('The playback rate must be between 0.5 and 2.', 'NotSupportedError');
  return rate;
};
const extension = (src, type) => /mpegurl/i.test(type) ? 'm3u8' : /dash\+xml/i.test(type) ? 'mpd'
  : /mp4/i.test(type) ? 'mp4' : /quicktime/i.test(type) ? 'mov'
    : new URL(src, globalThis.location?.href || 'http://localhost/').pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1];

/** HTML-media facade only. AVPlayer owns network, buffers, clocks, decoding and Canvas output. */
export function createMediaEngine(surface, options = {}) {
  const media = new EventTarget();
  const now = options.now || (() => performance.now() / 1000);
  let owner = null, serial = 0, disposed = false, libraryPromise;
  let position = 0, duration = NaN, origin = 0, width = 0, height = 0;
  let paused = true, seeking = false, ended = false, buffering = false, readyState = 0, networkState = 0;
  let error = null, rate = 1, defaultRate = 1, muted = false, volume = 1;
  const playWaiters = new Set(), audioTracks = createAudioTrackList(selectAudioTrack);
  const textTracks = createSubtitleTrackList(selectSubtitleTrack);
  const active = item => !disposed && item === owner && !item.controller.signal.aborted;
  const event = type => { if (!disposed) media.dispatchEvent(new Event(type)); };
  function settlePlay(cause) {
    for (const waiter of playWaiters) cause ? waiter.reject(cause) : waiter.resolve();
    playWaiters.clear();
  }
  function dependencies() {
    return libraryPromise ||= Promise.resolve(options.library || import('./vendor/libmedia/avplayer.js'));
  }
  function playerStats(item = owner) {
    try { return item?.player?.getStats?.() || {}; } catch (_) { return {}; }
  }
  function currentTime() {
    if (paused || seeking || !owner?.loaded || owner.retired) return position;
    const value = Math.max(0, seconds(owner.player.currentTime) - origin);
    return Number.isFinite(duration) ? Math.min(duration, value) : value;
  }
  function publishTime() {
    position = currentTime();
    try { options.onClock?.(position); } catch (_) {}
    event('timeupdate');
  }
  function gestureRequired() {
    return !paused && Boolean(owner?.player?.isSuspended?.());
  }
  function snapshot() {
    const stats = playerStats(), item = owner;
    return sanitizePlaybackDiagnostics({ engine: 'libmedia-avplayer', renderMode: 'canvas', generation: serial, position: currentTime(),
      running: !paused && !buffering && !gestureRequired(), intentPlaying: !paused,
      startupPhase: item?.phase || 'none', openElapsedMs: item ? ((item.startedAt ?? now()) - item.openedAt) * 1000 : undefined,
      waitReason: error ? 'error' : !item ? 'no-source' : ended ? 'ended' : seeking ? 'seeking' : paused ? 'paused'
        : gestureRequired() ? 'audio-context-suspended' : buffering ? 'preparing' : 'none',
      gestureRequired: gestureRequired(), manualPlaybackRate: rate, effectivePlaybackRate: item?.player?.getPlaybackRate?.() ?? rate,
      codec: stats.videocodec, codedWidth: width, codedHeight: height,
      stallCount: stats.audioStutter !== undefined && stats.videoStutter !== undefined
        ? finite(stats.audioStutter) + finite(stats.videoStutter) : undefined,
      ...Object.fromEntries(['audioPacketQueueLength', 'videoPacketQueueLength', 'audioFrameDecodeCount', 'videoFrameDecodeCount',
        'audioFrameRenderCount', 'videoFrameRenderCount', 'audioStutter', 'videoStutter']
        .filter(key => stats[key] !== undefined && Number.isFinite(Number(stats[key])))
        .map(key => [key, Number(stats[key])])),
    });
  }
  function retire(item) {
    if (!item || item.retired) return item?.cleanup;
    item.retired = true; item.controller.abort(); clearTimeout(item.startupTimer);
    item.resize?.disconnect();
    // Scope DOM and asynchronous disposal to this source: an old completion cannot remove the new Canvas.
    item.container?.remove();
    item.cleanup = Promise.resolve(item.player?.destroy?.()).catch(() => {}).then(async () => {
      const state = item.libraryState;
      if (!state) return;
      state.users.delete(item);
      if (!state.users.size) await item.Player.stopPipelines?.();
    }).catch(() => {});
    if (item.libraryState) item.libraryState.cleanup = item.cleanup;
    return item.cleanup;
  }
  function fail(cause, item = owner) {
    if (!active(item) || error) return;
    const before = snapshot();
    position = currentTime(); paused = true; seeking = buffering = false; readyState = 0; networkState = 3;
    error = { code: cause?.name === 'NotSupportedError' ? 4 : 3, name: cause?.name || 'Error', message: cause?.message || String(cause) };
    settlePlay(cause instanceof Error || cause instanceof DOMException ? cause : new Error(error.message));
    retire(item);
    const failure = new Event('error'); failure.error = cause; failure.playbackDiagnostics = before;
    failure.cleanupDiagnostics = snapshot(); media.dispatchEvent(failure);
  }
  async function updateMetadata(item) {
    if (!active(item)) return;
    const player = item.player;
    const rawDuration = seconds(player.getDuration());
    duration = player.isLive?.() ? Infinity : rawDuration > 0 ? rawDuration : NaN;
    if (player.isLive?.() && rate !== 1) { rate = 1; event('ratechange'); }
    origin = Math.max(0, seconds(player.getMinStartPTS?.()));
    const streams = player.getStreams?.() || [];
    const parameters = stream => stream.codecparProxy || stream.codecpar || {};
    const video = streams.find(stream => stream.mediaType === 'video' || parameters(stream).codecType === 0);
    const codec = video ? parameters(video) : {};
    if ([16, 18].includes(codec.colorTrc))
      throw new DOMException('This video requires HDR; TiPlay requests SDR video only.', 'NotSupportedError');
    width = finite(codec.width); height = finite(codec.height); item.hasVideo = Boolean(video);
    const sourceAudio = streams.filter(stream => stream.mediaType === 'audio' || parameters(stream).codecType === 1);
    item.hasAudio = sourceAudio.length > 0;
    // Match the pinned AVPlayer codec filter: unsupported audio must not silently become video-only playback.
    const supportedAudio = stream => {
      const id = parameters(stream).codecId;
      return !item.supportedCodecs || item.supportedCodecs.includes(id)
        || id >= 65536 && id <= 65572 || id >= 69632 && id <= 69683;
    };
    const playableAudio = sourceAudio.filter(supportedAudio);
    if (sourceAudio.length && !playableAudio.length)
      throw new DOMException('This media contains no supported audio track.', 'NotSupportedError');
    const descriptors = playableAudio
      .map((stream, index) => ({ id: String(stream.id), kind: 'main', language: stream.metadata?.language || '',
        label: audioTrackLabel(stream.metadata?.title, stream.metadata?.language, options.languages?.[0], index),
      }));
    let selected = player.getSelectedAudioStreamId?.();
    if (player.isHls?.() || player.isDash?.()) {
      const protocolAudio = await player.getAudioList?.();
      if (!active(item)) return;
      if (protocolAudio?.list?.length) {
        descriptors.splice(0, descriptors.length, ...protocolAudio.list.map((track, index) => ({ id: String(index), kind: 'main',
          language: track.lang || '', label: track.codec || audioTrackLabel(null, track.lang, options.languages?.[0], index) })));
        selected = protocolAudio.selectedIndex;
      }
    }
    const preferred = descriptors.find(track => track.id === item.preferredAudio)
      || preferredAudioTrack(descriptors, options.languages || []);
    item.preferredAudio = preferred?.id || descriptors[0]?.id;
    audioTracks.replace(descriptors, descriptors.some(track => track.id === String(selected)) ? String(selected) : preferred?.id || descriptors[0]?.id);
    const protocolSubtitles = player.isHls?.() || player.isDash?.() ? await player.getSubtitleList?.() : null;
    if (!active(item)) return;
    const subtitleDescriptors = protocolSubtitles?.list?.length
      ? protocolSubtitles.list.map((track, index) => ({ id: String(index), language: track.lang || '', label: track.codec || track.lang || `Subtitles ${index + 1}` }))
      : streams.filter(stream => (stream.mediaType === 'subtitle' || parameters(stream).codecType === 3)
        && (!item.supportedCodecs || item.supportedCodecs.includes(parameters(stream).codecId))).map((stream, index) =>
        ({ id: String(stream.id), language: stream.metadata?.language || '', label: stream.metadata?.title || stream.metadata?.language || `Subtitles ${index + 1}` }));
    const existingSubtitles = [...textTracks];
    const changedSubtitles = existingSubtitles.length !== subtitleDescriptors.length || subtitleDescriptors.some((track, index) =>
      ['id', 'label', 'language'].some(key => track[key] !== existingSubtitles[index]?.[key]));
    if (changedSubtitles) {
      const selectedSubtitle = existingSubtitles.find(track => track.mode === 'showing')?.id;
      textTracks.replace(subtitleDescriptors);
      const restored = selectedSubtitle === undefined ? null : textTracks.getTrackById(selectedSubtitle);
      if (restored) restored.mode = 'showing';
      else player.setSubtitleEnable?.(false);
    }
    try { options.onTimeline?.({ origin }); } catch (_) {}
    event('durationchange'); event('resize');
  }
  function markPlaying(item) {
    if (!active(item) || paused || gestureRequired() || (item.hasVideo ? !item.videoRendered : !item.audioRendered)) return;
    clearTimeout(item.startupTimer);
    buffering = false; readyState = 4; item.startedAt ??= now(); item.phase = 'playing';
    event('playing'); settlePlay();
  }
  function wire(item) {
    const player = item.player;
    const on = (name, listener) => player.on(name, (...args) => { if (active(item)) listener(...args); });
    on('progress', stage => { if (!item.startedAt) item.phase = stage < 2 ? 'metadata' : 'first-samples'; event('progress'); });
    on('time', publishTime);
    on('played', () => markPlaying(item));
    on('firstVideoRendered', () => { item.videoRendered = true; readyState = Math.max(readyState, 2); event('loadeddata'); markPlaying(item); });
    on('firstAudioRendered', () => { item.audioRendered = true; readyState = Math.max(readyState, 2); event('loadeddata'); markPlaying(item); });
    on('resume', () => { if (gestureRequired()) clearTimeout(item.startupTimer); buffering = !paused; event('waiting'); event('progress'); });
    on('audioContextRunning', () => { startupDeadline(item); markPlaying(item); event('progress'); });
    on('ended', () => { publishTime(); ended = true; paused = true; buffering = false; event('ended'); settlePlay(); });
    on('error', cause => fail(cause, item));
    on('timeout', () => fail(new DOMException('Media resource timed out.', 'TimeoutError'), item));
    on('streamUpdate', () => { void updateMetadata(item).then(() => event('progress')).catch(cause => fail(cause, item)); });
  }
  async function load(src, type) {
    if (disposed) throw interrupted();
    const previous = owner; owner = null; serial++; settlePlay(interrupted()); retire(previous);
    position = origin = width = height = 0; duration = NaN; error = null;
    paused = true; ended = seeking = buffering = false; readyState = networkState = 0;
    audioTracks.replace([], null); textTracks.replace([]); event('emptied');
    if (!src) return;
    const item = owner = { src: String(src), type, serial, controller: new AbortController(), openedAt: now(), phase: 'dependencies', loaded: false };
    networkState = 2; event('loadstart');
    try {
      const library = await withDeadline(abortable(dependencies(), item.controller.signal), options.resourceDeadline || 15000);
      if (!active(item)) throw interrupted();
      const Player = library.default;
      if (typeof Player !== 'function') throw new DOMException('URL player is unavailable.', 'NotSupportedError');
      item.Player = Player; item.supportedCodecs = library.AVPlayerSupportedCodecs;
      item.libraryState = libraries.get(Player) || { users: new Set(), cleanup: Promise.resolve() };
      libraries.set(Player, item.libraryState);
      await abortable(item.libraryState.cleanup, item.controller.signal);
      if (!active(item)) throw interrupted();
      item.libraryState.users.add(item);
      item.container = options.containerFactory?.() || document.createElement('div');
      item.container.className = 'airplay-avplayer';
      if (item.container.style) item.container.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
      surface?.prepend(item.container);
      item.player = new Player({ container: item.container, wasmBaseUrl: new URL('./vendor/libmedia/', import.meta.url).href,
        getWasm: library.getWasm, checkUseMSE: () => false, enableHardware: true, enableWebCodecs: true,
        enableWorker: true, enableWebGPU: false, enableAudioWorklet: true,
        // URL playback uses upstream VOD preloading and live buffering. No second queue or synchronization loop.
        preLoadTime: 4, enableJitterBuffer: true, lowLatency: false, jitterBufferMin: 1, jitterBufferMax: 4,
      });
      wire(item);
      if (typeof ResizeObserver === 'function') {
        item.resize = new ResizeObserver(() => {
          if (active(item) && item.loaded) item.player.resize(surface.clientWidth, surface.clientHeight);
        });
        if (surface) item.resize.observe(surface);
      }
      item.phase = 'metadata';
      await withDeadline(abortable(item.player.load(String(src), { ext: extension(String(src), type),
        http: { credentials: 'omit', referrerPolicy: 'no-referrer',
          ...(options.proxyOnly ? { headers: { 'X-TiPlay-Proxy-Origin': options.proxyOrigin } } : {}) },
        ioLoaderOptions: { retryCount: 2, retryInterval: 1 },
      }), item.controller.signal), options.resourceDeadline || 15000);
      if (!active(item)) throw interrupted();
      item.loaded = true; item.phase = 'ready'; networkState = 1; readyState = 1;
      await updateMetadata(item);
      if (!active(item)) throw interrupted();
      event('loadedmetadata'); event('canplay'); event('progress');
    } catch (cause) {
      if (active(item) && cause?.name !== 'AbortError') fail(cause, item);
      else retire(item);
      throw cause;
    }
  }
  function startupDeadline(item) {
    clearTimeout(item.startupTimer);
    if (!active(item) || paused || item.startedAt !== undefined || gestureRequired()) return;
    item.startupTimer = setTimeout(() => {
      if (active(item) && !paused && !gestureRequired() && item.startedAt === undefined)
        fail(new DOMException('URL playback did not produce its first frame before the startup deadline.', 'TimeoutError'), item);
    }, options.startupDeadline || 15000);
  }
  async function play() {
    if (disposed) throw interrupted();
    if (error) throw new Error(error.message);
    let item = owner;
    if (item?.livePaused) {
      const { src, type } = item;
      await load(src, type);
      return play();
    }
    if (!item?.loaded) throw new DOMException('No media source is loaded.', 'InvalidStateError');
    if (!paused) return item.playing;
    paused = false; ended = false; buffering = true; startupDeadline(item); event('play'); event('waiting');
    const promise = new Promise((resolve, reject) => playWaiters.add({ resolve, reject }));
    void promise.catch(() => {}); item.playing = promise;
    const playRevision = item.playRevision = (item.playRevision || 0) + 1;
    try {
      item.player.setVolume(muted ? 0 : volume, true);
      if (!item.player.isLive?.()) item.player.setPlaybackRate(rate);
      if (!item.nativePlay) {
        item.nativePlay = Promise.resolve(item.player.play({ audio: true, video: true, subtitle: true })).then(async () => {
          if (active(item) && paused) await item.player.pause();
        }).finally(() => { item.nativePlay = null; });
      }
      const rejected = promise.then(() => new Promise(() => {}));
      await Promise.race([item.nativePlay, rejected]);
      if (!active(item)) throw interrupted();
      if (paused) { await item.player.pause(); throw interrupted(); }
      // Apply current intent again after asynchronous graph creation; pre-play volume stores zero for a muted source.
      item.player.setVolume(muted ? 0 : volume, true);
      if (!item.player.isLive?.()) item.player.setPlaybackRate(rate);
      const selectedSubtitle = [...textTracks].find(track => track.mode === 'showing');
      if (selectedSubtitle) await item.player.selectSubtitle(Number(selectedSubtitle.id));
      item.player.setSubtitleEnable?.(Boolean(selectedSubtitle));
      if (item.preferredAudio && item.player.getSelectedAudioStreamId?.() !== Number(item.preferredAudio))
        await item.player.selectAudio(Number(item.preferredAudio));
      if (item.preferredAudio) audioTracks.select(item.preferredAudio);
      markPlaying(item);
    } catch (cause) {
      if (active(item) && item.playRevision === playRevision) {
        if (cause?.name !== 'AbortError') fail(cause, item);
        settlePlay(cause);
      }
      throw cause;
    }
    return promise;
  }
  function pause() {
    if (disposed || paused) return;
    position = currentTime(); paused = true; buffering = false; clearTimeout(owner?.startupTimer); settlePlay(interrupted());
    const item = owner;
    if (item) item.playRevision = (item.playRevision || 0) + 1;
    // A paused event is immediate user intent; AVPlayer remains the owner of the actual graph pause.
    if (item?.loaded && item.player.isLive?.()) {
      // AVPlayer has no live pause. Stop this source, silence it immediately, and reopen at the live edge on resume.
      item.livePaused = true; item.player.setVolume(0, true); readyState = networkState = 0;
      retire(item);
    } else if (item?.loaded) void item.player.pause().catch(cause => fail(cause, item));
    event('pause');
  }
  function seek(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const target = Math.max(0, Number.isFinite(duration) ? Math.min(duration, number) : number);
    const item = owner;
    if (item?.player?.isLive?.()) return;
    if (!item?.loaded || disposed) { position = target; return; }
    if (!active(item)) return;
    if (!seeking && Math.abs(target - currentTime()) < .001) return;
    position = target; item.seekTarget = target;
    if (seeking) return;
    seeking = true; event('seeking');
    void (async () => {
      try {
        while (active(item) && item.seekTarget !== undefined) {
          const next = item.seekTarget; item.seekTarget = undefined;
          await item.player.seek(BigInt(Math.round((next + origin) * 1000)));
        }
        if (active(item)) { seeking = false; ended = false; publishTime(); event('seeked'); event('progress'); }
      } catch (cause) { fail(cause, item); }
    })();
  }
  function selectAudioTrack(id) {
    if (!audioTracks.getTrackById(String(id)) || !owner?.loaded || !active(owner)) return false;
    const item = owner;
    if (!audioTracks.select(String(id))) return false;
    item.preferredAudio = String(id);
    if (item.startedAt !== undefined) void item.player.selectAudio(Number(id)).catch(cause => fail(cause, item));
    return true;
  }
  function selectSubtitleTrack(id, showing) {
    const item = owner;
    if (!item?.loaded || !active(item)) return;
    item.subtitleDesired = [...textTracks].find(track => track.mode === 'showing')?.id;
    if (!showing && item.subtitleDesired === undefined) item.player.setSubtitleEnable?.(false);
    if (item.subtitleSelecting) return;
    item.subtitleSelecting = true;
    void (async () => {
      try {
        do {
          const desired = item.subtitleDesired;
          if (desired !== undefined) await item.player.selectSubtitle(Number(desired));
          if (!active(item)) return;
          if (desired === item.subtitleDesired) { item.player.setSubtitleEnable?.(desired !== undefined); break; }
        } while (active(item));
      } catch (cause) { fail(cause, item); }
      finally { item.subtitleSelecting = false; }
    })();
  }
  function resumeFromGesture() {
    const item = owner;
    if (item?.livePaused) return play();
    // Call directly on the trusted event stack, before any await/import.
    const resumed = item?.player?.resume?.();
    return Promise.resolve(resumed).then(() => {
      if (!active(item)) throw interrupted();
      if (paused) return play();
      markPlaying(item); return item.playing;
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true; serial++; settlePlay(interrupted()); retire(owner); owner = null;
    options.signal?.removeEventListener('abort', dispose);
  }
  const getter = (name, get, set) => Object.defineProperty(media, name, { enumerable: true, get, ...(set ? { set } : {}) });
  getter('duration', () => duration); getter('currentTime', currentTime, seek); getter('timestampOrigin', () => origin);
  getter('audioTracks', () => audioTracks); getter('textTracks', () => textTracks);
  // AVPlayer exposes queue counts, not exact byte/PTS coverage. Do not fabricate buffered TimeRanges.
  getter('buffered', () => mediaTimeRanges([]));
  getter('seekable', () => mediaTimeRanges(Number.isFinite(duration) && duration > 0 ? [[0, duration]] : []));
  getter('isLive', () => Boolean(owner?.loaded && owner.player.isLive?.()));
  getter('paused', () => paused); getter('seeking', () => seeking); getter('ended', () => ended);
  getter('buffering', () => buffering || gestureRequired()); getter('gestureRequired', gestureRequired);
  getter('readyState', () => readyState); getter('networkState', () => networkState); getter('error', () => error);
  getter('videoWidth', () => width); getter('videoHeight', () => height);
  getter('playbackRate', () => rate, value => {
    const next = rateValue(value);
    if (owner?.loaded && owner.player.isLive?.() && next !== 1)
      throw new DOMException('Playback speed is unavailable for live streams.', 'NotSupportedError');
    if (next === rate) return;
    rate = next; if (owner && active(owner)) owner.player?.setPlaybackRate(rate); event('ratechange');
  });
  getter('defaultPlaybackRate', () => defaultRate, value => { defaultRate = rateValue(value); });
  getter('volume', () => volume, value => { const next = Number(value);
    if (!Number.isFinite(next) || next < 0 || next > 1) throw new DOMException('Volume must be between 0 and 1.', 'IndexSizeError');
    volume = next; owner?.player?.setVolume(muted ? 0 : volume, true); event('volumechange'); });
  getter('muted', () => muted, value => { muted = Boolean(value); owner?.player?.setVolume(muted ? 0 : volume, true); event('volumechange'); });
  Object.assign(media, { load, play, pause, dispose, selectAudioTrack, resumeFromGesture, getPlaybackDiagnostics: snapshot,
    getVideoPlaybackQuality: () => { const stats = playerStats(); return { creationTime: now() * 1000,
      totalVideoFrames: finite(stats.videoFrameRenderCount), droppedVideoFrames: 0, corruptedVideoFrames: 0 }; },
  });
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return media;
}
