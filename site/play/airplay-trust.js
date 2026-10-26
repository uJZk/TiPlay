/** First-use AirPlay consent travels over the existing paired browser control channel. */
export function createAirPlayTrustNotification(root, send, language = 'en', {
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const zh = language === 'zh';
  const heading = root.querySelector('[data-trust-heading]');
  const name = root.querySelector('[data-trust-name]');
  const allow = root.querySelector('[data-trust-allow]');
  const once = root.querySelector('[data-trust-once]');
  const details = root.querySelector('[data-trust-details]');
  const reject = root.querySelector('[data-trust-reject]');
  allow.textContent = zh ? '总是允许' : 'Always allow';
  once.textContent = zh ? '允许一次' : 'Allow once';
  reject.textContent = zh ? '拒绝' : 'Reject';
  const seen = new Set();
  let current = null, timer = null;

  function hide() {
    clearTimer(timer); timer = null; current = null; root.hidden = true;
  }
  function answer(value, remember = false) {
    const prompt = current;
    if (!prompt) return;
    const valid = now() < prompt.deadline;
    hide();
    if (valid) send({ k: 'ap-trust', id: prompt.id, allow: value, remember: value && remember });
  }
  allow.addEventListener('click', () => answer(true, true));
  once.addEventListener('click', () => answer(true));
  reject.addEventListener('click', () => answer(false));

  return {
    update(prompt) {
      if (!prompt || typeof prompt.id !== 'string' || prompt.id.length > 64 ||
          !Number.isFinite(prompt.remainingMillis) || prompt.remainingMillis <= 0) { hide(); return; }
      const deadline = now() + Math.min(5000, prompt.remainingMillis);
      if (current?.id === prompt.id) {
        // Polling cannot reset the five-second window, including after delayed responses.
        current.deadline = Math.min(current.deadline, deadline);
        clearTimer(timer); timer = setTimer(hide, Math.max(0, current.deadline - now()));
        return;
      }
      hide();
      if (seen.has(prompt.id)) return;
      seen.add(prompt.id);
      while (seen.size > 64) seen.delete(seen.values().next().value);
      current = { id: prompt.id, deadline };
      const type = ['audio', 'mirror', 'video', 'photo'].includes(prompt.mediaType) ? prompt.mediaType : 'unknown';
      const titles = zh ? {
        audio: '允许 AirPlay 音频投屏？', mirror: '允许 AirPlay 屏幕镜像？',
        video: '允许 AirPlay 视频投屏？', photo: '允许 AirPlay 照片投屏？', unknown: '允许 AirPlay 连接？',
      } : {
        audio: 'Allow AirPlay audio?', mirror: 'Allow AirPlay screen mirroring?',
        video: 'Allow AirPlay video?', photo: 'Allow AirPlay photos?', unknown: 'Allow an AirPlay connection?',
      };
      const effects = zh ? {
        audio: '仅播放声音，CarPlay 画面将继续显示。',
        mirror: '将显示设备屏幕，暂时代替 CarPlay 画面。',
        video: '将播放视频，暂时代替 CarPlay 画面。',
        photo: '将显示照片，暂时代替 CarPlay 画面。',
        unknown: '设备正在请求连接，投屏类型尚未确定。',
      } : {
        audio: 'Plays audio while keeping the CarPlay picture.',
        mirror: 'Shows the device screen in place of the CarPlay picture.',
        video: 'Plays video in place of the CarPlay picture.',
        photo: 'Shows photos in place of the CarPlay picture.',
        unknown: 'The device is requesting a connection. The casting type is not known yet.',
      };
      const device = (typeof prompt.name === 'string' ? prompt.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 80).trim() : '') || 'AirPlay';
      heading.textContent = titles[type];
      name.textContent = zh ? `来自「${device}」。` : `From “${device}”.`;
      details.textContent = effects[type];
      root.hidden = false;
      timer = setTimer(hide, deadline - now());
    },
    clear() { hide(); seen.clear(); },
  };
}
