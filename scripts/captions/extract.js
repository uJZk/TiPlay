// SPDX-License-Identifier: GPL-3.0-only
export const CAPTION_LIMITS = Object.freeze({ packetBytes: 8 * 1024 * 1024, seiBytes: 64 * 1024, nalUnits: 4096,
  triples: 4096, services708: 8, windows708: 8, windowCharacters: 8192, updateCharacters: 8192 });

function view(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function nalUnits(data, hevc, configuration, format) {
  const starts = [];
  for (let end = data.indexOf(1, 2); end !== -1; end = data.indexOf(1, end + 1)) {
    if (data[end - 1] || data[end - 2]) continue;
    const start = end >= 3 && data[end - 3] === 0 ? end - 3 : end - 2;
    starts.push({ start, payload: end + 1 });
    if (starts.length > CAPTION_LIMITS.nalUnits) return [];
  }
  if (format !== 'length-prefixed' && starts.length && starts[0].start === 0) return starts.map((start, index) =>
    data.subarray(start.payload, starts[index + 1]?.start ?? data.length));
  if (format === 'annexb') return [];
  const description = view(configuration?.description ?? configuration);
  const offset = hevc ? 21 : 4;
  const size = configuration?.nalLengthSize ?? (description && description.length > offset ? (description[offset] & 3) + 1 : 4);
  if (![1, 2, 3, 4].includes(size)) return [];
  const units = [];
  for (let at = 0; at < data.length;) {
    if (at + size > data.length || units.length >= CAPTION_LIMITS.nalUnits) return [];
    let length = 0;
    for (let index = 0; index < size; index++) length = length * 256 + data[at++];
    if (!length || length > data.length - at) return [];
    units.push(data.subarray(at, at + length)); at += length;
  }
  return units;
}

function rbsp(data, header) {
  const output = [];
  for (let index = header; index < data.length; index++) {
    if (data[index] === 3 && index >= header + 2 && data[index - 1] === 0 && data[index - 2] === 0 && data[index + 1] <= 3) continue;
    output.push(data[index]);
  }
  return output;
}

/** Source bytes are read only. The caller supplies packets in presentation order. */
export function extractCaptionTriples(packet, { ptsSeconds, codec = 'avc', configuration, format } = {}) {
  const data = view(packet);
  if (!data || !data.length || data.length > CAPTION_LIMITS.packetBytes || !Number.isFinite(ptsSeconds)) return [];
  const hevc = /^(?:hevc|h265|hvc1|hev1)(?:\.|$)/i.test(codec);
  if (!hevc && !/^(?:avc|h264|avc1|avc3)(?:\.|$)/i.test(codec)) return [];
  const triples = [];
  for (const unit of nalUnits(data, hevc, configuration, format)) {
    if (unit.length < (hevc ? 3 : 2) || unit.length > CAPTION_LIMITS.seiBytes) continue;
    const type = hevc ? unit[0] >> 1 & 63 : unit[0] & 31;
    if (hevc ? type !== 39 && type !== 40 : type !== 6) continue;
    const bytes = rbsp(unit, hevc ? 2 : 1);
    let at = 0;
    while (at < bytes.length) {
      let payloadType = 0, payloadSize = 0, next;
      do { if (at >= bytes.length) return triples; next = bytes[at++]; payloadType += next; } while (next === 255);
      do { if (at >= bytes.length) return triples; next = bytes[at++]; payloadSize += next; } while (next === 255);
      if (payloadSize > bytes.length - at) break;
      const end = at + payloadSize;
      if (payloadType === 4 && payloadSize >= 10 && bytes[at] === 181 && bytes[at + 1] === 0 && bytes[at + 2] === 49
        && bytes[at + 3] === 71 && bytes[at + 4] === 65 && bytes[at + 5] === 57 && bytes[at + 6] === 52
        && bytes[at + 7] === 3 && (bytes[at + 8] & 64)) {
        const count = bytes[at + 8] & 31, first = at + 10;
        if (first + count * 3 <= end) for (let index = 0; index < count; index++) {
          const position = first + index * 3, flags = bytes[position];
          if (flags & 4) triples.push({ type: flags & 3, a: bytes[position + 1], b: bytes[position + 2], time: ptsSeconds });
          if (triples.length >= CAPTION_LIMITS.triples) return triples;
        }
      }
      at = end;
    }
  }
  return triples;
}

