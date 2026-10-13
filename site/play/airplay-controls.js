// SPDX-License-Identifier: GPL-3.0-only
import { createVideoCanvas } from './airplay-canvas.js';
export function playbackState(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1) return null;
  const duration = Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0;
  const position = Number.isFinite(value.position) ? Math.min(duration, Math.max(0, value.position)) : 0;
  return { ...value, duration, position, seekable: value.seekable === true && duration > 0 };
}
/** Video.js owns MP4/HLS decoding, controls, buffering and the media clock. */
export function createAirPlayControls(stage, send, lang = 'en', { fetchPhone, credentials, host } = {}) {
  const layer = document.createElement('div');
  layer.className = 'airplay-player'; layer.hidden = true;
  const photoStop = document.createElement('button');
  photoStop.className = 'airplay-photo-stop'; photoStop.textContent = lang === 'zh' ? '结束投放' : 'Stop casting';
  photoStop.hidden = true; stage.append(layer, photoStop);
  let state = null, player = null, picture = null, loading = null, key = null, appliedRevision = -1, appliedSeekRevision = -1, metadata = false, timer = null;
  let directive = null, disposed = false, routeMuted = false, savedMute = false;
  const stop = () => { if (state) send({ k: 'ap', id: state.id, a: 'stop' }); };
  photoStop.addEventListener('click', stop);
  for (const element of [layer, photoStop]) for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'keyup'])
    element.addEventListener(type, event => event.stopPropagation());
  function clear() {
    loading?.abort(); loading = null;
    clearInterval(timer); timer = null;
    picture?.dispose(); picture = null;
    player?.dispose(); player = null; layer.replaceChildren();
    key = null; metadata = false; appliedRevision = appliedSeekRevision = -1;
    layer.hidden = photoStop.hidden = true;
  }
  function report() {
    if (!player || !state) return;
    if (player.error() && !metadata) appliedRevision = state.revision;
    if (appliedRevision !== state.revision) return;
    const duration = player.duration(), position = player.currentTime(), buffered = player.buffered();
    let bufferedPosition = Math.max(0, position);
    for (let i = 0; i < buffered.length; i++) if (buffered.start(i) <= position && buffered.end(i) >= position) {
      bufferedPosition = buffered.end(i); break;
    }
    if (Number.isFinite(duration) && duration > 0) bufferedPosition = Math.min(duration, bufferedPosition);
    send({ k: 'ap-state', id: state.id, revision: appliedRevision,
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
      position: Number.isFinite(position) ? Math.max(0, position) : 0,
      bufferedPosition, playing: !player.paused(), ready: player.readyState() >= 2,
      buffering: player.hasClass('vjs-waiting') || player.readyState() < 3,
      seekable: Number.isFinite(duration) && duration > 0 && player.seekable().length > 0,
      ended: player.ended(), failed: Boolean(player.error()) });
  }
  function applyDirective() {
    if (!player || !metadata || !directive || directive.revision === appliedRevision) return;
    // Seek is applied only for a new iPhone command; status polling never moves the local media clock.
    const seekRevision = directive.seekRevision ?? directive.revision;
    if (seekRevision !== appliedSeekRevision) {
      const duration = player.duration();
      const seconds = directive.fraction ? directive.target * duration : directive.target;
      if (Number.isFinite(seconds) && seconds >= 0) player.currentTime(Number.isFinite(duration) ? Math.min(seconds, duration) : seconds);
      appliedSeekRevision = seekRevision;
    }
    appliedRevision = directive.revision;
    if (directive.playing) player.play()?.catch(() => { report(); });
    else player.pause();
  }
  async function open(next) {
    const currentKey = `${next.id}:${host()}:${next.resource}`;
    clear(); key = currentKey;
    layer.hidden = false;
    const abort = loading = new AbortController();
    const { code, session } = credentials();
    const route = `/airplay-resource?id=${next.id}&r=${encodeURIComponent(next.resource)}&c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}`;
    try {
      const response = next.directUrl ? await fetch(next.directUrl, { signal: abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }) : await fetchPhone(route, { signal: abort.signal });
      if (!response.ok) throw new Error('AirPlay media unavailable');
      const type = response.headers.get('Content-Type')?.split(';')[0] ?? '';
      await response.body?.cancel();
      if (abort.signal.aborted || key !== currentKey || disposed) return;
      const element = document.createElement('video');
      element.className = 'video-js vjs-default-skin'; element.setAttribute('playsinline', '');
      element.crossOrigin = 'anonymous'; layer.append(element);
      player = window.videojs(element, {
        controls: true, preload: 'auto', fluid: false, fill: true, language: lang === 'zh' ? 'zh-CN' : 'en',
        disablePictureInPicture: true, enableSmoothSeeking: true,
        controlBar: { fullscreenToggle: false, pictureInPictureToggle: false, volumePanel: { inline: false },
          skipButtons: { backward: 10, forward: 10 } },
        html5: { vhs: { overrideNative: true } },
      });
      if (routeMuted) player.muted(true);
      if (routeMuted) player.getChild('controlBar')?.getChild('volumePanel')?.hide();
      player.on('volumechange', () => { if (routeMuted && !player.muted()) player.muted(true); });
      const Button = window.videojs.getComponent('Button');
      const end = new Button(player, { name: 'StopCasting' });
      end.controlText(photoStop.textContent); end.addClass('airplay-stop');
      end.on('click', stop); player.getChild('controlBar').addChild(end);
      player.on('loadedmetadata', () => { metadata = true; applyDirective(); report(); });
      player.on(['play', 'pause', 'waiting', 'playing', 'seeked', 'ended', 'error'], report);
      picture = createVideoCanvas(player.el().querySelector('video'), player.el(), () => {
        player?.error({ code: 3, message: lang === 'zh' ? '无法显示视频画面' : 'Unable to display video' });
      });
      player.src({ src: next.directUrl ?? `http://${host()}${route}`, ...(type === 'application/octet-stream' ? {} : { type }) });
      timer = setInterval(report, 400);
    } catch (_) {
      if (!abort.signal.aborted && state?.id === next.id) {
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
      if (next.kind === 'photo') { if (key) clear(); photoStop.hidden = false; return; }
      if (!next.resource || !Number.isSafeInteger(next.revision)) { clear(); return; }
      const nextKey = `${next.id}:${host()}:${next.resource}`;
      if (key !== nextKey) open(next);
      else applyDirective();
    },
    audioMuted(value) {
      if (routeMuted === value) return;
      if (value) savedMute = player?.muted() ?? false;
      routeMuted = value;
      player?.muted(value ? true : savedMute);
      const volume = player?.getChild('controlBar')?.getChild('volumePanel');
      if (value) volume?.hide(); else volume?.show();
    },
    videoActive: () => Boolean(state?.resource),
    dispose() { disposed = true; clear(); layer.remove(); photoStop.remove(); },
  };
}
