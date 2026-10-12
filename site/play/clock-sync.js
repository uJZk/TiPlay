/*! SPDX-License-Identifier: GPL-3.0-only */
/** Browser absolute monotonic milliseconds minus Android monotonic milliseconds. */
export function sampleClock(serverMs, start, end) {
  if (![serverMs, start, end].every(Number.isFinite) || end < start || end - start > 1000) return null;
  return { offset: (start + end) / 2 - serverMs, rtt: end - start, at: end };
}

export function presentationTime(serverMs, clock, now = performance.timeOrigin + performance.now()) {
  if (!Number.isFinite(serverMs) || !clock || now - clock.at > 15000 || now < clock.at) return null;
  const presentation = serverMs + clock.offset;
  return Math.abs(now - presentation) <= 10000 ? presentation : null;
}
