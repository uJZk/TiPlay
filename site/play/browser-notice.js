/*! SPDX-License-Identifier: GPL-3.0-only */
/** Browser errors stay in the notification stack until dismissed or explicitly replaced. */
export function createBrowserNotice(root, language = 'en') {
  const heading = root.querySelector('[data-browser-heading]');
  const message = root.querySelector('[data-browser-message]');
  const close = root.querySelector('[data-browser-close]');
  heading.textContent = language === 'zh' ? '网页端提示' : 'Browser notice';
  close.textContent = language === 'zh' ? '关闭' : 'Close';
  let lastId = null;
  close.addEventListener('click', () => { root.hidden = true; });
  return {
    update(problem) {
      // A heartbeat or successful frame must not erase an undismissed explanation.
      if (!problem || problem.id === lastId) return;
      lastId = problem.id;
      message.textContent = problem.text;
      root.hidden = false;
    },
    reset(id) { if (id && id !== lastId) return; lastId = null; root.hidden = true; },
  };
}
