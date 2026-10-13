/*! SPDX-License-Identifier: GPL-3.0-only */
function clockTime(value) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value), pad = (number, width = 2) => String(number).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** One actual drawn frame, with source expected time mapped into the browser's clock. */
export function formatPresentation(sample, language = 'en') {
  const unavailable = language === 'zh' ? '不可用' : 'Unavailable';
  const source = clockTime(sample?.sourceTime) ?? unavailable;
  const submitted = clockTime(sample?.submittedTime) ?? '—';
  const offset = Number.isFinite(sample?.offsetMs) ? `${sample.offsetMs >= 0 ? '+' : ''}${Math.round(sample.offsetMs)} ms` : '—';
  return language === 'zh' ? `源预期 ${source} · 提交 ${submitted} · Δ ${offset}`
    : `Source expected ${source} · Submitted ${submitted} · Δ ${offset}`;
}
