// SPDX-License-Identifier: GPL-3.0-only
import { createAirPlayDiagnostics } from './airplay-diagnostics.js';
import { fetchMediaResource } from './airplay-fetch.js';
export function playbackState(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1) return null;
  const duration = Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0;
  const position = Number.isFinite(value.position) ? Math.min(duration, Math.max(0, value.position)) : 0;
  return { ...value, duration, position, seekable: value.seekable === true && duration > 0 };
}
/** A paused item is idle; only an unfinished seek can still be buffering while paused. */
export function playbackBuffering(media, waiting = false) {
  return !media.ended && (!media.paused || media.seeking) && (waiting || media.seeking || media.readyState < 3);
}
/** Older APK directives omit rate; their play/pause commands preserve the browser's selected speed. */
export function applyDirectiveRate(media, directive) {
  if (Number.isFinite(directive.rate)) media.playbackRate = directive.rate;
}
/** TiPlay owns playback; Video.js controls and iPhone directives share its measured clock. */
export function createAirPlayControls(stage, send, lang = 'en', { fetchPhone, credentials, host } = {}) {
  const layer = document.createElement('div');
  layer.className = 'airplay-player'; layer.hidden = true;
  const photoStop = document.createElement('button');
  photoStop.className = 'airplay-photo-stop'; photoStop.textContent = lang === 'zh' ? '结束投放' : 'Stop casting';
  photoStop.hidden = true; stage.append(layer, photoStop);
  let state = null, player = null, loading = null, key = null, appliedRevision = -1, appliedSeekRevision = -1, appliedTrackRevision = -1, metadata = false, timer = null;
  let directive = null, disposed = false, waiting = false, sourceReady = false;
  let diagnostics = null, photo = null;
  const stop = () => {
    if (!state) return;
    diagnostics?.event('explicit-stop');
    send({ k: 'ap', id: state.id, a: 'stop' });
  };
  photoStop.addEventListener('click', stop);
  for (const element of [layer, photoStop]) for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'keyup'])
    element.addEventListener(type, event => event.stopPropagation());
  function clear() {
    diagnostics?.dispose(); diagnostics = null;
    loading?.abort(); loading = null;
    clearInterval(timer); timer = null;
    const retiring = player; player = null; retiring?.dispose(); layer.replaceChildren();
    photo?.dispose(); photo = null;
    key = null; metadata = sourceReady = false; waiting = false; appliedRevision = appliedSeekRevision = appliedTrackRevision = -1;
    layer.hidden = photoStop.hidden = true;
  }
  function report() {
    if (!player || !state) return;
    if (player.error() && !metadata) appliedRevision = state.revision;
    if (appliedRevision !== state.revision) return;
    const media = player.media;
    const duration = media.duration, position = media.currentTime, buffered = media.buffered;
    let bufferedPosition = Number.isFinite(position) ? Math.max(0, position) : 0;
    for (let i = 0; i < buffered.length; i++) if (buffered.start(i) <= position && buffered.end(i) >= position) {
      bufferedPosition = buffered.end(i); break;
    }
    if (Number.isFinite(duration) && duration > 0) bufferedPosition = Math.min(duration, bufferedPosition);
    send({ k: 'ap-state', id: state.id, revision: appliedRevision,
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
      position: Number.isFinite(position) ? Math.max(0, position) : 0,
      bufferedPosition, playing: !media.paused, rate: media.playbackRate, ready: media.readyState >= 2,
      buffering: !player.error() && playbackBuffering(media, waiting),
      seekable: Number.isFinite(duration) && duration > 0 && media.seekable.length > 0,
      tracks: { audio: [...media.audioTracks].map(track => track.id),
        subtitle: [...media.textTracks].filter(track => !track.error && (track.supported || track.cues?.length > 0)).map(track => track.id) },
      ended: media.ended, failed: Boolean(player.error()) });
  }
  function applyDirective() {
    if (!player || !metadata || !sourceReady || !directive || directive.revision === appliedRevision) return;
    const command = directive, observation = diagnostics;
    // Seek is applied only for a new iPhone command; status polling never moves the local media clock.
    const seekRevision = directive.seekRevision ?? directive.revision;
    if (seekRevision !== appliedSeekRevision) {
      const duration = player.media.duration;
      const seconds = directive.fraction ? directive.target * duration : directive.target;
      if (Number.isFinite(seconds) && seconds >= 0) {
        observation?.event('directive-seek', undefined, command);
        player.media.currentTime = Number.isFinite(duration) ? Math.min(seconds, duration) : seconds;
      }
      appliedSeekRevision = seekRevision;
    }
    appliedRevision = directive.revision;
    if (directive.trackRevision !== appliedTrackRevision) {
      for (const selection of directive.trackSelection || []) {
        if (selection.type === 'audio') player.media.selectAudioTrack(selection.id);
        if (selection.type === 'subtitle') for (const track of player.media.textTracks) track.mode = track.id === selection.id ? 'showing' : 'disabled';
      }
      appliedTrackRevision = directive.trackRevision;
    }
    if (directive.textMarkup) {
      const overlay = player.surface.querySelector('.airplay-captions');
      if (overlay) {
        overlay.style.fontSize = `${20 * directive.textMarkup.fontScale}px`;
        overlay.style.color = directive.textMarkup.color;
      }
    }
    applyDirectiveRate(player.media, directive);
    if (directive.playing) {
      observation?.event('directive-play', undefined, command);
      player.media.play()?.then(() => observation?.event('play-resolved', undefined, command), error => {
        observation?.event('play-rejected', error, command); report();
      });
    } else {
      observation?.event('directive-pause', undefined, command);
      player.media.pause();
    }
  }
  function resourceRoute(next, forceProxy = next.proxyOnly === true) {
    const { code, session } = credentials();
    return `/airplay-resource?id=${next.id}&r=${encodeURIComponent(next.resource)}&c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}${forceProxy ? '&proxy=1' : ''}`;
  }
  async function openPhoto(next) {
    const currentKey = `${next.id}:${host()}:${next.resource}:${next.proxyOnly === true}`;
    clear(); key = currentKey; layer.hidden = photoStop.hidden = next.outputAllowed === false;
    const abort = loading = new AbortController();
    try {
      const { createPhotoPresenter } = await import('./airplay-photo.js');
      if (abort.signal.aborted || key !== currentKey || disposed) return;
      photo = createPhotoPresenter(layer, { fetchResource: (url, init) => fetchMediaResource((resource, options) => fetchPhone(new URL(resource).pathname + new URL(resource).search, options), url, init, { signal: abort.signal }), signal: abort.signal });
      await photo.load(`http://${host()}${resourceRoute(next)}`);
    } catch (error) {
      if (!abort.signal.aborted && key === currentKey && !disposed) {
        const message = document.createElement('p'); message.className = 'airplay-error'; message.role = 'alert';
        message.textContent = lang === 'zh' ? '无法显示照片' : 'Unable to display photo'; layer.append(message);
      }
    }
  }
  async function open(next, forced = false) {
    const sourceKey = `${next.id}:${host()}:${next.resource}:`;
    const currentKey = `${sourceKey}${next.proxyOnly === true}`;
    const resume = player && (forced || key !== currentKey) && key?.startsWith(sourceKey) && appliedRevision === next.revision
      ? { time: player.media.currentTime, rate: player.media.playbackRate } : null;
    clear(); key = currentKey;
    layer.hidden = next.outputAllowed === false;
    const abort = loading = new AbortController();
    const observation = diagnostics = createAirPlayDiagnostics(send, {
      state: () => state, media: () => player?.media,
      active: () => diagnostics === observation && key === currentKey && !abort.signal.aborted && !disposed,
    });
    observation.event('open', undefined, next);
    let forceProxy = forced || next.proxyOnly === true;
    let route = resourceRoute(next, forceProxy);
    const fetchExternal = (url, init) => fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    try {
      observation.event('probe-start', undefined, next);
      let response;
      try {
        response = await fetchMediaResource(next.directUrl && !forceProxy ? fetchExternal : (_, init) => fetchPhone(route, init), next.directUrl || `http://${host()}${route}`,
          { signal: abort.signal, headers: { Range: 'bytes=0-65535' } });
        if (!response.ok) throw new Error('AirPlay media unavailable');
      } catch (cause) {
        if (forceProxy || abort.signal.aborted) throw cause;
        forceProxy = true; route = resourceRoute(next, true); observation.event('proxy-fallback');
        response = await fetchMediaResource((_, init) => fetchPhone(route, init), `http://${host()}${route}`,
          { signal: abort.signal, headers: { Range: 'bytes=0-65535' } });
      }
      if (!response.ok) throw new Error('AirPlay media unavailable');
      const type = response.headers.get('Content-Type')?.split(';')[0] ?? '';
      await response.body?.cancel();
      if (abort.signal.aborted || key !== currentKey || disposed) return;
      observation.event('probe-ready');
      const { createVideoPlayer } = await import('./videojs-player.js');
      if (abort.signal.aborted || key !== currentKey || disposed) return;
      player = createVideoPlayer(layer, { lang, stop, stopText: photoStop.textContent, signal: abort.signal,
        onCanvasError: error => observation.event('canvas-error', error),
        fetchResource: (url, init) => {
          const target = new URL(url);
          if (target.origin === `http://${host()}` && target.pathname === '/airplay-resource')
            return fetchPhone(target.pathname + target.search, init);
          if (next.proxyOnly === true) throw new Error('Debug media must pass through Android');
          return fetchExternal(url, init);
        },
      });
      const opened = player;
      const media = player.media;
      observation.monitor(media, player.surface);
      media.addEventListener('loadedmetadata', () => { if (player !== opened) return; metadata = true; applyDirective(); report(); });
      for (const event of ['play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ratechange', 'ended', 'error'])
        media.addEventListener(event, () => {
          if (player !== opened) return;
          if (event === 'play' && state?.outputAllowed === false) { media.pause(); return; }
          if (event === 'waiting' || event === 'seeking') waiting = true;
          else if (['pause', 'playing', 'seeked', 'ended', 'error'].includes(event)) waiting = false;
          if (event === 'error' && !forceProxy && media.error?.name !== 'NotSupportedError') { observation.event('proxy-fallback'); void open(state, true); return; }
          if (event === 'error') player?.fail(/HDR|SDR/.test(media.error?.message || '')
            ? (lang === 'zh' ? '此视频需要 HDR，TiPlay 仅支持 SDR 视频' : 'This video requires HDR. TiPlay supports SDR video.')
            : (lang === 'zh' ? '无法播放视频' : 'Unable to play video'));
          report();
        });
      await player.source(next.directUrl && !forceProxy ? next.directUrl : `http://${host()}${route}`, type);
      if (abort.signal.aborted || player !== opened) return;
      sourceReady = true; applyDirective();
      // A command received during source preparation takes precedence over the old player's snapshot.
      if (resume && Number.isFinite(resume.time) && state?.id === next.id && state.revision === next.revision
        && (state.seekRevision ?? state.revision) === (next.seekRevision ?? next.revision)) {
        media.currentTime = resume.time; media.playbackRate = resume.rate;
      }
      report();
      timer = setInterval(report, 400);
    } catch (error) {
      if (!abort.signal.aborted && state?.id === next.id) {
        observation.event('open-error', error);
        appliedRevision = state.revision;
        send({ k: 'ap-state', id: state.id, revision: state.revision, duration: 0, position: 0,
          playing: false, ready: false, buffering: false, seekable: false, failed: true });
      }
    }
  }
  return {
    update(value) {
      const next = playbackState(value);
      state = next; directive = next;
      if (!next) { clear(); return; }
      if (next.kind === 'audio') { if (key) clear(); photoStop.hidden = false; return; }
      if (next.kind === 'photo') {
        if (!next.resource && key) clear();
        if (next.resource && key !== `${next.id}:${host()}:${next.resource}:${next.proxyOnly === true}`) void openPhoto(next);
        layer.hidden = photoStop.hidden = next.outputAllowed === false;
        return;
      }
      layer.hidden = next.outputAllowed === false;
      if (!next.resource || !Number.isSafeInteger(next.revision)) { clear(); return; }
      const nextKey = `${next.id}:${host()}:${next.resource}:${next.proxyOnly === true}`;
      if (key !== nextKey) open(next);
      else applyDirective();
    },
    videoActive: () => state?.kind === 'audio' || (Boolean(state?.resource) && state?.outputAllowed !== false),
    dispose() { disposed = true; clear(); layer.remove(); photoStop.remove(); },
  };
}
