/*! SPDX-License-Identifier: GPL-3.0-only */
/** Reuse the connection form and running controls without interrupting the session. */
export function createBrowserSettings({ dialog, controls, panel, nav, closeButton, isActive, onOpen }) {
  const panelParent = panel.parentNode, panelNext = panel.nextSibling;
  const navParent = nav.parentNode, navNext = nav.nextSibling;
  let previousFocus = null;
  function restore() {
    if (panel.parentNode !== dialog) return;
    panelParent.insertBefore(panel, panelNext);
    navParent.insertBefore(nav, navNext);
    panel.hidden = isActive();
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
    else nav.querySelector('button:not([hidden]):not(:disabled)')?.focus({ preventScroll: true });
    previousFocus = null;
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
    restore();
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', restore);
  return {
    close,
    open() {
      if (dialog.open) return;
      previousFocus = dialog.ownerDocument.activeElement;
      onOpen();
      dialog.append(panel);
      controls.append(nav);
      panel.hidden = false;
      dialog.showModal();
    },
  };
}
