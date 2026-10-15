/** First-use AirPlay consent travels over the existing paired browser control channel. */
export function createAirPlayTrustNotification(root, send, language = 'en', {
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const zh = language === 'zh';
  const heading = root.querySelector('[data-trust-heading]');
  const name = root.querySelector('[data-trust-name]');
  const allow = root.querySelector('[data-trust-allow]');
  const reject = root.querySelector('[data-trust-reject]');
  heading.textContent = zh ? '允许 AirPlay 投屏？' : 'Allow AirPlay?';
  reject.textContent = zh ? '拒绝' : 'Reject';
  const seen = new Set();
  let current = null, timer = null;

  function hide() {
    clearTimer(timer); timer = null; current = null; root.hidden = true;
  }
  function answer(value) {
    const prompt = current;
    if (!prompt) return;
    const valid = now() < prompt.deadline;
    hide();
    if (valid) send({ k: 'ap-trust', id: prompt.id, allow: value });
  }
  allow.addEventListener('click', () => answer(true));
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
      allow.textContent = prompt.verified === true ? (zh ? '允许并记住' : 'Allow and remember') :
        (zh ? '仅允许本次连接' : 'Allow this connection');
      name.textContent = typeof prompt.name === 'string' ? prompt.name.slice(0, 80) : 'AirPlay';
      root.hidden = false;
      timer = setTimer(hide, deadline - now());
    },
    clear() { hide(); seen.clear(); },
  };
}
