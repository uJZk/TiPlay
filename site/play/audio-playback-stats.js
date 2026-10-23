/*! SPDX-License-Identifier: GPL-3.0-only */
/** Optional cumulative output-render evidence. The browser can update it slowly
 * or stop updating while hidden; availability does not establish freshness or
 * physical speaker timing. Reading must never reset latency or alter the graph.
 */
export function readAudioPlaybackStats(context) {
  try {
    const stats = context?.playbackStats;
    if (stats == null) return { renderStatsState: 'unavailable' };
    const events = stats.underrunEvents, duration = stats.underrunDuration, total = stats.totalDuration;
    if (!Number.isSafeInteger(events) || events < 0
      || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0
      || typeof total !== 'number' || !Number.isFinite(total) || total < 0) return { renderStatsState: 'invalid' };
    const durationMs = duration * 1000, totalMs = total * 1000;
    if (!Number.isFinite(durationMs) || !Number.isFinite(totalMs)
      || durationMs > Number.MAX_SAFE_INTEGER || totalMs > Number.MAX_SAFE_INTEGER) return { renderStatsState: 'invalid' };
    return { renderStatsState: 'available', renderUnderrunEvents: events,
      renderUnderrunDurationMs: durationMs, renderTotalDurationMs: totalMs };
  } catch (_) { return { renderStatsState: 'failed' }; }
}
