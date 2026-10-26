// SPDX-License-Identifier: GPL-3.0-only
import { createAirPlayDiagnostics } from './airplay-diagnostics.js';
import { fetchMediaResource } from './airplay-fetch.js';
import { createAirPlayArtwork } from './airplay-artwork.js';
export function playbackState(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1) return null;
  const duration = Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0;
  const position = Number.isFinite(value.position) ? Math.min(duration, Math.max(0, value.position)) : 0;
  return { ...value, duration, position, seekable: value.seekable === true && duration > 0 };
}
/** A paused item is idle; only an unfinished seek can still be buffering while paused. */
export function playbackBuffering(media, waiting = false) {
  if (typeof media.buffering === 'boolean') return media.buffering;
  return !media.ended && (!media.paused || media.seeking) && (waiting || media.seeking || media.readyState < 3);
}
/** Older APK directives omit rate; their play/pause commands preserve the browser's selected speed. */
export function applyDirectiveRate(media, directive) {
  if (!Number.isFinite(directive.rate)) return;
  // A rate-unaware/live sender cannot make an unsupported speed abort playback.
  if (media.isLive === true) { media.playbackRate = 1; return; }
  if (directive.rate >= .5 && directive.rate <= 2) media.playbackRate = directive.rate;
}
/** Source preparation already owns the first frame at zero; later seek commands still apply. */
export function directiveSeekTarget(media, directive, initial = false) {
  const duration = media.duration;
  const seconds = directive.fraction ? directive.target * duration : directive.target;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const target = Number.isFinite(duration) ? Math.min(seconds, duration) : seconds;
  return initial && target === 0 && media.currentTime === 0 && !media.seeking ? null : target;
}
/** TiPlay owns playback; Video.js controls and iPhone directives share its measured clock. */
export function createAirPlayControls(stage, send, lang = 'en', { fetchPhone, credentials, host,
  loadPlayer = () => import('./videojs-player.js') } = {}) {
  const layer = document.createElement('div');
  layer.className = 'airplay-player'; layer.hidden = true;
  const stopText = lang === 'zh' ? '结束投放' : 'Stop casting';
  stage.append(layer);
  let state = null, player = null, loading = null, key = null, appliedRevision = -1, appliedSeekRevision = -1, appliedTrackRevision = -1, metadata = false, timer = null;
  let directive = null, disposed = false, waiting = false, sourceReady = false;
  let outputWasAllowed = true;
  let diagnostics = null, photo = null, preparation = null, playerKind = null, carPlayRunning = false;
  let playerModule = null, artworkURL = null;
  const artwork = createAirPlayArtwork(fetchPhone, url => {
    artworkURL = url;
    if (state?.kind === 'audio' && playerKind === 'audio') updateAudio(state);
  });
  const loadModule = () => playerModule ??= loadPlayer().catch(error => { playerModule = null; throw error; });
  const stop = () => {
    if (!state) return;
    diagnostics?.event('explicit-stop');
    send({ k: 'ap', id: state.id, a: 'stop' });
  };
  for (const element of [layer]) for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'keyup'])
    element.addEventListener(type, event => event.stopPropagation());
  function clear() {
    diagnostics?.dispose(); diagnostics = null;
    loading?.abort(); loading = null;
    clearInterval(timer); timer = null;
    const retiring = player; player = null;
    try { retiring?.dispose(); } catch (_) {
      // A controls-adapter failure cannot leave its media or surface owning the returned picture.
      try { retiring?.media?.dispose?.(); } catch (_) {}
    }
    layer.replaceChildren();
    preparation = null; layer.removeAttribute('aria-busy'); layer.removeAttribute('data-preparing');
    photo?.dispose(); photo = null; playerKind = null; artwork.update(null, null); artworkURL = null;
    key = null; metadata = sourceReady = false; waiting = false; outputWasAllowed = true;
    appliedRevision = appliedSeekRevision = appliedTrackRevision = -1;
    layer.hidden = true;
  }
  function beginPreparation() {
    const indicator = document.createElement('div');
    indicator.className = 'airplay-preparation media-skin'; indicator.dataset.theme = 'default';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-label', lang === 'zh' ? 'AirPlay 正在缓冲…' : 'AirPlay is buffering…');
    const spinner = document.createElement('span');
    spinner.className = 'airplay-preparation-spinner'; spinner.setAttribute('aria-hidden', 'true');
    indicator.append(spinner); layer.append(indicator); preparation = indicator;
    layer.setAttribute('aria-busy', 'true'); layer.setAttribute('data-preparing', '');
  }
  function finishPreparation() {
    preparation?.remove(); preparation = null;
    layer.removeAttribute('aria-busy'); layer.removeAttribute('data-preparing');
  }
  function syncPreparation() {
    if (!preparation || !player) return;
    const media = player.media;
    if (player.error() || sourceReady && (media.ended || media.gestureRequired
      || media.paused && media.readyState >= 1)) finishPreparation();
  }
  const failureText = error => /HDR|SDR/.test(error?.message || '')
    ? (lang === 'zh' ? '此视频需要 HDR，TiPlay 仅支持 SDR 视频' : 'This video requires HDR. TiPlay supports SDR video.')
    : (lang === 'zh' ? '无法播放视频，请从 iPhone 重试。' : 'Unable to play video. Try again from your iPhone.');
  function showFailure(error) {
    finishPreparation();
    if (player) { player.fail(failureText(error)); return; }
    const message = document.createElement('p'); message.className = 'airplay-error'; message.role = 'alert';
    message.textContent = failureText(error); layer.append(message);
  }
  function report() {
    if (!player || !state || state.kind === 'audio' || state.kind === 'photo') return;
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
    if (!player || !directive) return;
    const allowed = directive.outputAllowed !== false;
    const permissionChanged = allowed !== outputWasAllowed;
    outputWasAllowed = allowed;
    if (!allowed) player.media.pause();
    if (!metadata || !sourceReady || !permissionChanged && directive.revision === appliedRevision) return;
    const command = directive, observation = diagnostics;
    // Seek is applied only for a new iPhone command; status polling never moves the local media clock.
    const seekRevision = directive.seekRevision ?? directive.revision;
    if (seekRevision !== appliedSeekRevision) {
      const target = directiveSeekTarget(player.media, directive, appliedSeekRevision === -1);
      if (target !== null) {
        observation?.event('directive-seek', undefined, command);
        player.media.currentTime = target;
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
    applyDirectiveRate(player.media, directive);
    if (typeof directive.muted === 'boolean') player.media.muted = directive.muted;
    if (directive.playing && allowed) {
      observation?.event('directive-play', undefined, command);
      player.media.play()?.then(() => observation?.event('play-resolved', undefined, command), error => {
        observation?.event('play-rejected', error, command); report();
      });
    } else {
      observation?.event('directive-pause', undefined, command);
      player.media.pause();
    }
  }
  function resourceRoute(next, forceProxy = next.proxyOnly === true, resource = next.resource) {
    const { code, session } = credentials();
    return `/airplay-resource?id=${next.id}&r=${encodeURIComponent(resource)}&c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}${forceProxy ? '&proxy=1' : ''}`;
  }
  function updateAudio(next) {
    if (playerKind !== 'audio' || !player) return;
    const controls = Array.isArray(next.controls) ? next.controls : [];
    const canPause = controls.includes('play') && controls.includes('pause');
    const remoteReady = next.remotePending !== true;
    player.update({ ...next, artwork: undefined, artworkURL, canPause,
      seekable: next.seekable === true && controls.includes('seek'),
      canPrevious: remoteReady && controls.includes('previous'), canNext: remoteReady && controls.includes('next'),
      canSkipBack: remoteReady && controls.includes('skip-back'), canSkipForward: remoteReady && controls.includes('skip-forward') });
    const resource = typeof next.artworkResource === 'string' && next.artworkResource.length <= 128 ? next.artworkResource : null;
    artwork.update(resource ? `${next.id}:${host()}:${resource}` : null,
      resource ? resourceRoute(next, true, resource) : null);
  }
  async function openAudio(next) {
    const currentKey = `audio:${next.id}:${host()}`;
    clear(); key = currentKey; layer.hidden = carPlayRunning;
    const abort = loading = new AbortController();
    try {
      const { createAudioPlayer } = await loadModule();
      if (abort.signal.aborted || key !== currentKey || disposed || carPlayRunning) return;
      const control = (action, value) => {
        if (loading !== abort || abort.signal.aborted || disposed || state?.kind !== 'audio' || key !== currentKey || carPlayRunning) return;
        if (action !== 'stop' && !state.controls?.includes(action)) return;
        if (state.remotePending === true && ['previous', 'next', 'skip-back', 'skip-forward'].includes(action)) return;
        if (action === 'seek' && (!state.seekable || !Number.isFinite(value) || value < 0 || value > state.duration)) return;
        send({ k: 'ap', id: state.id, a: action, ...(action === 'seek' ? { v: value } : {}) });
      };
      player = createAudioPlayer(layer, { lang, stop: () => control('stop'), stopText,
        onPlay: () => control('play'), onPause: () => control('pause'),
        onSeek: value => control('seek', value), onPrevious: () => control('previous'), onNext: () => control('next'),
        onSkipBack: () => control('skip-back'), onSkipForward: () => control('skip-forward') });
      playerKind = 'audio'; updateAudio(state);
    } catch (error) {
      if (!abort.signal.aborted && key === currentKey && !disposed) showFailure(error);
    }
  }
  async function openPhoto(next) {
    const currentKey = `${next.id}:${host()}:${next.resource}:${next.proxyOnly === true}`;
    clear(); key = currentKey; layer.hidden = next.outputAllowed === false;
    const abort = loading = new AbortController();
    try {
      const [{ createPhotoPresenter }, { createPhotoPlayer }] = await Promise.all([import('./airplay-photo.js'), loadModule()]);
      if (abort.signal.aborted || key !== currentKey || disposed) return;
      player = createPhotoPlayer(layer, { lang, stop: () => {
        if (loading === abort && !abort.signal.aborted && !disposed && key === currentKey) stop();
      }, stopText }); playerKind = 'photo';
      photo = createPhotoPresenter(player.surface, { fetchResource: (url, init) => fetchMediaResource((resource, options) => fetchPhone(new URL(resource).pathname + new URL(resource).search, options), url, init, { signal: abort.signal }), signal: abort.signal });
      await photo.load(`http://${host()}${resourceRoute(next)}`);
    } catch (error) {
      if (!abort.signal.aborted && key === currentKey && !disposed) {
        const message = document.createElement('p'); message.className = 'airplay-error'; message.role = 'alert';
        message.textContent = lang === 'zh' ? '无法显示照片，请从 iPhone 重试。' : 'Unable to display photo. Try again from your iPhone.'; layer.append(message);
        send({ k: 'ap-state', id: next.id, failed: true });
      }
    }
  }
  async function open(next, forced = false) {
    const sourceKey = `${next.id}:${host()}:${next.resource}:`;
    const currentKey = `${sourceKey}${next.proxyOnly === true}`;
    const resume = player && (forced || key !== currentKey) && key?.startsWith(sourceKey) && appliedRevision === next.revision
      ? { time: player.media.currentTime, rate: player.media.playbackRate } : null;
    clear(); key = currentKey;
    layer.hidden = next.outputAllowed === false || next.videoShown === false;
    beginPreparation();
    const abort = loading = new AbortController();
    const owns = () => loading === abort && !abort.signal.aborted && !disposed;
    const observation = diagnostics = createAirPlayDiagnostics(send, {
      state: () => state, media: () => player?.media,
      active: () => diagnostics === observation && key === currentKey && !abort.signal.aborted && !disposed,
    });
    observation.event('open', undefined, next);
    let forceProxy = forced || next.proxyOnly === true;
    let route;
    const fetchExternal = (url, init) => fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    try {
      const { createVideoPlayer } = await loadModule();
      if (!owns() || key !== currentKey) return;
      player = createVideoPlayer(layer, { lang, stop: () => { if (owns() && key === currentKey) stop(); }, stopText, signal: abort.signal,
        onCanvasError: error => observation.event('canvas-error', error),
        proxyOnly: next.proxyOnly === true,
        proxyOrigin: `http://${host()}`,
      });
      playerKind = 'video';
      route = resourceRoute(next, forceProxy);
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
      const opened = player;
      const media = player.media;
      observation.monitor(media, player.surface);
      media.addEventListener('loadedmetadata', () => { if (player !== opened) return; metadata = true; applyDirective(); report(); });
      media.addEventListener('progress', () => { if (player === opened) syncPreparation(); });
      for (const event of ['play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ratechange', 'ended', 'error'])
        media.addEventListener(event, () => {
          if (player !== opened) return;
          if (event === 'play' && state?.outputAllowed === false) { media.pause(); return; }
          if (event === 'waiting' || event === 'seeking') waiting = true;
          else if (['pause', 'playing', 'seeked', 'ended', 'error'].includes(event)) waiting = false;
          if (event === 'error' && !forceProxy && media.error?.name !== 'NotSupportedError') { observation.event('proxy-fallback'); void open(state, true); return; }
          if (event === 'playing') finishPreparation();
          else if (event === 'error') showFailure(media.error);
          else syncPreparation();
          report();
        });
      await player.source(next.directUrl && !forceProxy ? next.directUrl : `http://${host()}${route}`, type, { proxyOnly: forceProxy });
      if (abort.signal.aborted || player !== opened) return;
      sourceReady = true; applyDirective(); syncPreparation();
      // A command received during source preparation takes precedence over the old player's snapshot.
      if (resume && Number.isFinite(resume.time) && state?.id === next.id && state.revision === next.revision
        && (state.seekRevision ?? state.revision) === (next.seekRevision ?? next.revision)) {
        media.currentTime = resume.time; media.playbackRate = resume.rate;
      }
      report();
      timer = setInterval(report, 400);
    } catch (error) {
      if (owns()) {
        observation.event('open-error', error);
        showFailure(error);
        appliedRevision = state.revision;
        send({ k: 'ap-state', id: state.id, revision: state.revision, duration: 0, position: 0,
          playing: false, ready: false, buffering: false, seekable: false, failed: true });
      }
    }
  }
  return {
    update(value) {
      if (disposed) return;
      const next = playbackState(value);
      state = next; directive = next;
      if (!next) { clear(); return; }
      if (next.kind === 'audio') {
        if (carPlayRunning) { if (key) clear(); return; }
        const nextKey = `audio:${next.id}:${host()}`;
        if (key !== nextKey) void openAudio(next);
        else updateAudio(next);
        return;
      }
      if (next.kind === 'photo') {
        if (!next.resource && key) clear();
        if (next.resource && key !== `${next.id}:${host()}:${next.resource}:${next.proxyOnly === true}`) void openPhoto(next);
        layer.hidden = next.outputAllowed === false;
        return;
      }
      layer.hidden = next.outputAllowed === false || next.videoShown === false;
      if (!next.resource || !Number.isSafeInteger(next.revision)) { clear(); return; }
      const nextKey = `${next.id}:${host()}:${next.resource}:${next.proxyOnly === true}`;
      if (key !== nextKey) open(next);
      else applyDirective();
    },
    setCarPlayRunning(value) {
      if (disposed) return;
      const changed = carPlayRunning !== Boolean(value); carPlayRunning = Boolean(value);
      if (!changed || state?.kind !== 'audio') return;
      if (carPlayRunning) clear();
      else void openAudio(state);
    },
    videoActive: () => !disposed && (state?.kind === 'audio' ? !carPlayRunning
      : (Boolean(state?.resource) && state?.outputAllowed !== false && state?.videoShown !== false)),
    dispose() { disposed = true; state = directive = null; clear(); artwork.dispose(); layer.remove(); },
  };
}
