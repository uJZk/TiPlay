// SPDX-License-Identifier: GPL-3.0-only
// Video.js-style control bar for the receiver's WebCodecs canvas transport.
export function playbackState(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1) return null;
  const duration = Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0;
  const position = Number.isFinite(value.position) ? Math.min(duration, Math.max(0, value.position)) : 0;
  return { ...value, duration, position, seekable: value.seekable === true && duration > 0 };
}

export function timeLabel(seconds) {
  const total = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60), remainder = String(total % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function createAirPlayControls(stage, send, lang = 'en') {
  const labels = lang === 'zh' ? {
    play: '播放', pause: '暂停', back: '后退 10 秒', forward: '前进 10 秒', seek: '播放进度',
    stop: '结束投放', fullscreen: '全屏', loading: '正在缓冲…',
  } : {
    play: 'Play', pause: 'Pause', back: 'Back 10 seconds', forward: 'Forward 10 seconds',
    seek: 'Seek', stop: 'Stop casting', fullscreen: 'Full screen', loading: 'Buffering…',
  };
  const bar = document.createElement('div');
  bar.className = 'airplay-controls'; bar.hidden = true;
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'AirPlay');
  let state = null, dragging = false;
  const command = (action, value) => {
    if (state) send({ k: 'ap', id: state.id, a: action, ...(value === undefined ? {} : { v: value }) });
  };
  const button = (text, label, action) => {
    const control = document.createElement('button');
    control.type = 'button'; control.textContent = text; control.setAttribute('aria-label', label);
    control.addEventListener('click', action); bar.append(control); return control;
  };
  const toggle = button('▶', labels.play, () => command(state?.playing ? 'pause' : 'play'));
  const back = button('−10', labels.back, () => command('seek', Math.max(0, state.position - 10)));
  const range = document.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '0'; range.step = '0.1';
  range.setAttribute('aria-label', labels.seek); bar.append(range);
  range.addEventListener('input', () => { dragging = true; });
  range.addEventListener('change', () => { command('seek', Number(range.value)); dragging = false; });
  const forward = button('+10', labels.forward, () => command('seek', Math.min(state.duration, state.position + 10)));
  const time = document.createElement('output'); bar.append(time);
  button('■', labels.stop, () => command('stop'));
  button('⛶', labels.fullscreen, () => {
    const pending = document.fullscreenElement ? document.exitFullscreen?.() : stage.requestFullscreen?.();
    pending?.catch(() => {});
  });
  // Controls must never become CarPlay touch events, including pointer capture's release.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'keyup']) {
    bar.addEventListener(type, event => event.stopPropagation());
  }
  stage.append(bar);
  return {
    update(value) {
      const next = playbackState(value);
      if (next?.id !== state?.id) dragging = false;
      state = next; bar.hidden = !state;
      if (!state) return;
      const photo = state.kind === 'photo';
      toggle.hidden = back.hidden = forward.hidden = range.hidden = time.hidden = photo;
      toggle.textContent = state.playing ? 'Ⅱ' : '▶';
      toggle.setAttribute('aria-label', state.playing ? labels.pause : labels.play);
      back.disabled = forward.disabled = range.disabled = !state.seekable;
      range.max = String(state.duration);
      if (!dragging) range.value = String(state.position);
      range.setAttribute('aria-valuetext', `${timeLabel(state.position)} / ${timeLabel(state.duration)}`);
      time.textContent = state.buffering ? labels.loading : `${timeLabel(state.position)} / ${timeLabel(state.duration)}`;
    },
  };
}
