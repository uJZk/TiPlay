// SPDX-License-Identifier: GPL-3.0-only
/** Native-like read-only TimeRanges for the media control adapter. */
export function mediaTimeRanges(ranges) {
  const values = ranges.map(([start, end]) => [start, end]);
  const at = index => {
    if (!Number.isInteger(index) || index < 0 || index >= values.length)
      throw new DOMException('The index is outside the available media ranges.', 'IndexSizeError');
    return values[index];
  };
  return { length: values.length, start: index => at(index)[0], end: index => at(index)[1] };
}
