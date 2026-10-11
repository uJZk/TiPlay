/*! SPDX-License-Identifier: GPL-3.0-only */
/** Keep the full-viewport waiting surface above both video paths until a frame is ready. */
export function createReconnectOverlay({ overlay, message, settings, bar, stage, onSettings }) {
  let previousFocus = null;
  settings.addEventListener('click', onSettings);
  return ({ active, live, phase, pending, text }) => {
    const visible = active && (!live || phase === 'connecting' || phase === 'retry' || pending);
    const wasVisible = !overlay.hidden;
    overlay.hidden = !visible;
    bar.inert = stage.inert = visible;
    bar.setAttribute('aria-hidden', String(visible));
    if (message.textContent !== text) message.textContent = text;
    if (visible && !wasVisible) {
      previousFocus = overlay.ownerDocument.activeElement;
      settings.focus({ preventScroll: true });
    } else if (!visible && wasVisible) {
      if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
      else bar.querySelector('button:not([hidden])')?.focus({ preventScroll: true });
      previousFocus = null;
    }
  };
}
