// SPDX-License-Identifier: GPL-3.0-only
/** Find semantic four-digit credential leaks without matching unrelated numeric telemetry or opaque PAKE values. */
export function pairingCodeLeaks(value, code, path = '$') {
  const leaks = [];
  const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const codeToken = new RegExp(`(?:^|[^0-9])${escaped}(?![0-9])`);
  const walk = (item, field, key = '') => {
    if (item && typeof item === 'object') {
      for (const [name, child] of Object.entries(item)) walk(child, `${field}.${name}`, name);
      return;
    }
    if (/^(?:c|code|pairing[_-]?code)$/i.test(key) && String(item) === code) { leaks.push(field); return; }
    if (typeof item !== 'string') return;
    if (item === code) { leaks.push(field); return; }
    // Numbers can contain any four digits. They are not credentials unless named as such above.
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(item)) return;
    try {
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === 'object') { walk(parsed, `${field}<json>`); return; }
    } catch (_) { /* Ordinary diagnostic text. */ }
    if (/^(?:https?:\/\/|\/|[?#])/.test(item)) {
      try {
        const url = new URL(item, 'https://fixture.invalid');
        for (const [name, parameter] of [...url.searchParams, ...new URLSearchParams(url.hash.slice(1))]) {
          walk(parameter, `${field}<url>.${name}`, name);
        }
        return;
      } catch (_) { /* Inspect malformed URLs as ordinary text. */ }
    }
    // Random SRP/proof/hash strings occasionally contain four consecutive decimal digits.
    if (/^[A-Za-z0-9+/_=-]{16,}$/.test(item)) return;
    if (codeToken.test(item)) leaks.push(field);
  };
  walk(value, path);
  return leaks;
}
