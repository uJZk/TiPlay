/*! SPDX-License-Identifier: GPL-3.0-only */
/** Persistent location guidance uses the same card as AirPlay consent, with explicit dismissal. */
export function createLocationNotice(root, language = 'en') {
  const zh = language === 'zh';
  const title = root.querySelector('[data-location-heading]');
  const message = root.querySelector('[data-location-message]');
  const close = root.querySelector('[data-location-close]');
  title.textContent = zh ? '网页定位不可用' : 'Browser location unavailable';
  close.textContent = zh ? '关闭' : 'Close';
  const seen = new Set();
  close.addEventListener('click', () => { root.hidden = true; });
  return {
    show(reason) {
      if (!['permission', 'insecure', 'unsupported'].includes(reason) || seen.has(reason)) return;
      seen.add(reason);
      const instruction = zh
        ? '请在浏览器设置里允许定位；或者在安卓端的高级设置打开“禁用网页端定位”，改用 iPhone 自己的定位。'
        : 'Allow location in browser settings, or turn on “Disable browser location” in Android’s Advanced settings to use the iPhone’s own location.';
      const detail = reason === 'insecure'
        ? (zh ? '网页定位需要通过 HTTPS 打开本页。' : 'Browser location requires opening this page over HTTPS. ')
        : reason === 'unsupported'
          ? (zh ? '此浏览器不支持网页定位。' : 'This browser does not support geolocation. ')
          : '';
      message.textContent = detail + instruction;
      root.hidden = false;
    },
  };
}
