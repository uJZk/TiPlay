// SPDX-License-Identifier: GPL-3.0-only

/** Decoded ranges are merged only across rounding noise, never across missing media. */
export function mergeMediaRanges(ranges, tolerance = 0.002) {
  const sorted = ranges.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .map(range => [...range]).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    if (previous && range[0] <= previous[1] + tolerance) previous[1] = Math.max(previous[1], range[1]);
    else result.push(range);
  }
  return result;
}

export function intersectMediaRanges(left, right) {
  const result = [];
  for (const a of left) for (const b of right) {
    const start = Math.max(a[0], b[0]), end = Math.min(a[1], b[1]);
    if (end > start) result.push([start, end]);
  }
  return mergeMediaRanges(result);
}

export function mediaTimeRanges(ranges) {
  const values = ranges.map(range => Object.freeze([...range]));
  const at = (index, column) => {
    if (!Number.isInteger(index) || index < 0 || index >= values.length) {
      throw new DOMException('The range index is out of bounds.', 'IndexSizeError');
    }
    return values[index][column];
  };
  return Object.freeze({ length: values.length, start: index => at(index, 0), end: index => at(index, 1) });
}

export function mediaRangeEnd(ranges, time, tolerance = 0.025) {
  return ranges.find(([start, end]) => start <= time + tolerance && end > time)?.[1] ?? time;
}

export function clampMediaTime(time, duration) {
  if (!Number.isFinite(time)) throw new TypeError('The media time must be finite.');
  return Math.max(0, Number.isFinite(duration) ? Math.min(time, duration) : time);
}

/** GPU-backed samples remain bounded even when timestamps or sample durations are malformed. */
export function videoQueueFull(queue, position, { maxFrames = 48, maxBytes = 96 * 1024 * 1024, maxAhead = 2 } = {}) {
  return queue.length >= maxFrames || queue.reduce((bytes, item) => bytes + item.bytes, 0) >= maxBytes
    || (queue.length > 0 && queue[queue.length - 1].end - position >= maxAhead);
}
