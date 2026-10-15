// SPDX-License-Identifier: GPL-3.0-only
import { HlsMP4Tools } from './vendor/mediabunny/mediabunny.min.js';
/** Extract ATSC caption triples from AVC/HEVC SEI in Annex B or length-prefixed packets. */
export function captionTriples(data, timestamp, codec = 'avc', config) {
  if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
  if (data.length > 8 * 1024 * 1024 || !Number.isFinite(timestamp)) return [];
  const hevc = /hevc|hvc|hev/i.test(codec), units = [];
  const starts = [];
  for (let i = 0; i + 3 < data.length; i++) if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || data[i + 2] === 0 && data[i + 3] === 1)) {
    const length = data[i + 2] === 1 ? 3 : 4; starts.push({ start: i, payload: i + length }); i += length - 1;
  }
  if (starts.length && starts[0].start === 0) {
    for (let i = 0; i < starts.length; i++) units.push(data.subarray(starts[i].payload, starts[i + 1]?.start ?? data.length));
  } else {
    const description = config?.description ? new Uint8Array(config.description.buffer ?? config.description, config.description.byteOffset ?? 0, config.description.byteLength) : null;
    const size = description ? (description[hevc ? 21 : 4] & 3) + 1 : 4;
    let at = 0;
    while (at + size <= data.length) { let n = 0; for (let i = 0; i < size; i++) n = n * 256 + data[at++]; if (!n || at + n > data.length) return []; units.push(data.subarray(at, at + n)); at += n; }
  }
  const samples = [];
  for (const unit of units) {
    const type = hevc ? unit[0] >> 1 & 63 : unit[0] & 31;
    if (hevc ? type === 39 || type === 40 : type === 6) HlsMP4Tools.parseSEIMessageFromNALu(unit, hevc ? 2 : 1, timestamp, samples);
  }
  return samples.filter(sample => sample.type === 3 && sample.bytes?.length >= 2).flatMap(sample => {
    const count = sample.bytes[0] & 31, triples = [];
    for (let i = 0; i < count && 2 + i * 3 + 2 < sample.bytes.length; i++) {
      const at = 2 + i * 3, flags = sample.bytes[at];
      if (flags & 4) triples.push({ type: flags & 3, a: sample.bytes[at + 1], b: sample.bytes[at + 2], timestamp });
    }
    return triples;
  });
}
/** CEA-708 text services: packet assembly, window visibility and Unicode text.
 * Pen colors/fonts/positions are intentionally flattened for TiPlay's plain-text overlay. */
export class DigitalCaptionParser {
  packet = []; expected = 0; services = new Map(); sequence = null;
  constructor(onText) { this.onText = onText; }
  add(triple) {
    if (triple.type === 3) {
      const sequence = triple.a >> 6;
      if (this.sequence !== null && sequence !== (this.sequence + 1 & 3)) this.services.clear();
      this.sequence = sequence; this.expected = ((triple.a & 63) || 64) * 2 - 1; this.packet = [triple.b];
    } else if (triple.type === 2 && this.expected) this.packet.push(triple.a, triple.b);
    else return;
    if (this.packet.length >= this.expected) { this.parse(this.packet.slice(0, this.expected), triple.timestamp); this.packet = []; this.expected = 0; }
  }
  parse(data, time) {
    let at = 0;
    while (at < data.length) {
      const header = data[at++]; let service = header >> 5; const size = header & 31;
      if (service === 7) { if (at >= data.length) break; service = data[at++] & 63; }
      if (at + size > data.length) return;
      if (service && size) this.block(service, data.slice(at, at + size), time);
      at += size;
    }
  }
  block(id, bytes, time) {
    let service = this.services.get(id);
    if (!service) { if (this.services.size >= 8) return; service = { current: 0, windows: Array.from({ length: 8 }, () => ({ text: '', visible: false, defined: false })) }; this.services.set(id, service); }
    let at = 0;
    const skip = n => { at = Math.min(bytes.length, at + n); };
    while (at < bytes.length) {
      const value = bytes[at++], window = service.windows[service.current];
      if (value >= 32 && value <= 127) { if (window.defined) window.text += value === 127 ? '♪' : String.fromCharCode(value); }
      else if (value >= 160) { if (window.defined) window.text += String.fromCharCode(value); }
      else if (value >= 128 && value <= 135) service.current = value - 128;
      else if (value >= 152 && value <= 159) {
        if (at + 6 > bytes.length) return;
        service.current = value - 152; const selected = service.windows[service.current]; selected.defined = true; selected.visible = !!(bytes[at] & 32); skip(6);
      } else if (value >= 136 && value <= 140) {
        if (at >= bytes.length) return; const mask = bytes[at++];
        for (let i = 0; i < 8; i++) if (mask & 1 << i) {
          const selected = service.windows[i];
          if (value === 136) selected.text = '';
          if (value === 137) selected.visible = true;
          if (value === 138) selected.visible = false;
          if (value === 139) selected.visible = !selected.visible;
          if (value === 140) { selected.defined = false; selected.text = ''; selected.visible = false; }
        }
      } else if (value === 143) { for (const selected of service.windows) { selected.text = ''; selected.visible = false; selected.defined = false; } }
      else if (value === 8) window.text = window.text.slice(0, -1);
      else if (value === 12) window.text = '';
      else if (value === 13) window.text += '\n';
      else if (value === 14) window.text = window.text.split('\n').slice(0, -1).join('\n');
      else if (value === 16) {
        if (at >= bytes.length) return; const ext = bytes[at++];
        if (ext <= 31) skip(ext <= 7 ? 0 : ext <= 15 ? 1 : ext <= 23 ? 2 : 3);
        else if (ext <= 127) { const chars = { 32: ' ', 33: '\u00a0', 37: '…', 42: 'Š', 44: 'Œ', 48: '█', 49: '‘', 50: '’', 51: '“', 52: '”', 53: '•', 57: '™', 58: 'š', 60: 'œ', 61: '℠', 63: 'Ÿ' }; if (window.defined && chars[ext]) window.text += chars[ext]; }
        else if (ext <= 159) { if (ext <= 135) skip(4); else if (ext <= 143) skip(5); else if (at < bytes.length) skip((bytes[at++] & 63)); }
        else if (window.defined) window.text += ext === 160 ? '㏄' : '�';
      } else if (value === 24) { if (at + 2 > bytes.length) return; const a = bytes[at++], b = bytes[at++]; if (window.defined) window.text += a ? new TextDecoder('euc-kr').decode(new Uint8Array([a, b])) : String.fromCharCode(b); }
      else if (value >= 17 && value <= 23) skip(1);
      else if (value >= 25 && value <= 31) skip(2);
      else if (value === 141) skip(1);
      else if (value === 144) skip(2);
      else if (value === 145) skip(3);
      else if (value === 146) skip(2);
      else if (value === 151) skip(4);
      if (window.text.length > 8192) window.text = window.text.slice(-8192);
    }
    this.onText(id, service.windows.filter(window => window.visible && window.defined).map(window => window.text.trim()).filter(Boolean).join('\n'), time);
  }
}
