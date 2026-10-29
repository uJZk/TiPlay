// SPDX-License-Identifier: GPL-3.0-only
import Cea608Parser from './node_modules/hls.js/src/utils/cea-608-parser.ts';
import { CAPTION_LIMITS, extractCaptionTriples } from './extract.js';
export { CAPTION_LIMITS, extractCaptionTriples };

// Text-only restoration of the former TiPlay 708 decoder. Pen styling and
// positioning are intentionally flattened; this is not full CEA-708 parity.
class DigitalCaptionParser {
  constructor(onText) { this.onText = onText; this.reset(); }
  reset() { this.packet = []; this.expected = 0; this.services = new Map(); this.sequence = null; }
  clear(time) { for (const id of this.services.keys()) this.onText(id, '', time); this.services.clear(); }
  add(triple) {
    if (triple.type === 3) {
      const sequence = triple.a >> 6;
      if (this.expected || this.sequence !== null && sequence !== (this.sequence + 1 & 3)) this.clear(triple.time);
      this.sequence = sequence; this.expected = ((triple.a & 63) || 64) * 2 - 1; this.packet = [triple.b];
    } else if (triple.type === 2 && this.expected) this.packet.push(triple.a, triple.b);
    else return;
    if (this.packet.length >= this.expected) {
      this.parse(this.packet.slice(0, this.expected), triple.time); this.packet = []; this.expected = 0;
    }
  }
  parse(data, time) {
    let at = 0;
    while (at < data.length) {
      const header = data[at++]; let service = header >> 5; const size = header & 31;
      if (service === 7) { if (at >= data.length) return; service = data[at++] & 63; }
      if (at + size > data.length) return;
      if (service && size) this.block(service, data.slice(at, at + size), time);
      at += size;
    }
  }
  block(id, bytes, time) {
    let service = this.services.get(id);
    if (!service) {
      if (this.services.size >= CAPTION_LIMITS.services708) return;
      service = { current: 0, windows: Array.from({ length: CAPTION_LIMITS.windows708 }, () => ({ text: '', visible: false, defined: false })) };
      this.services.set(id, service);
    }
    let at = 0;
    const skip = count => { at = Math.min(bytes.length, at + count); };
    while (at < bytes.length) {
      const value = bytes[at++], window = service.windows[service.current];
      if (value >= 32 && value <= 127) { if (window.defined) window.text += value === 127 ? '♪' : String.fromCharCode(value); }
      else if (value >= 160) { if (window.defined) window.text += String.fromCharCode(value); }
      else if (value >= 128 && value <= 135) service.current = value - 128;
      else if (value >= 152 && value <= 159) {
        if (at + 6 > bytes.length) return;
        service.current = value - 152; const selected = service.windows[service.current];
        selected.defined = true; selected.visible = !!(bytes[at] & 32); skip(6);
      } else if (value >= 136 && value <= 140) {
        if (at >= bytes.length) return; const mask = bytes[at++];
        for (let index = 0; index < CAPTION_LIMITS.windows708; index++) if (mask & 1 << index) {
          const selected = service.windows[index];
          if (value === 136) selected.text = '';
          if (value === 137) selected.visible = true;
          if (value === 138) selected.visible = false;
          if (value === 139) selected.visible = !selected.visible;
          if (value === 140) { selected.defined = false; selected.text = ''; selected.visible = false; }
        }
      } else if (value === 143) for (const selected of service.windows) { selected.text = ''; selected.visible = false; selected.defined = false; }
      else if (value === 8) window.text = window.text.slice(0, -1);
      else if (value === 12) window.text = '';
      else if (value === 13) window.text += '\n';
      else if (value === 14) window.text = window.text.split('\n').slice(0, -1).join('\n');
      else if (value === 16) {
        if (at >= bytes.length) return; const ext = bytes[at++];
        if (ext <= 31) skip(ext <= 7 ? 0 : ext <= 15 ? 1 : ext <= 23 ? 2 : 3);
        else if (ext <= 127) {
          const chars = { 32: ' ', 33: '\u00a0', 37: '…', 42: 'Š', 44: 'Œ', 48: '█', 49: '‘', 50: '’', 51: '“', 52: '”', 53: '•', 57: '™', 58: 'š', 60: 'œ', 61: '℠', 63: 'Ÿ' };
          if (window.defined && chars[ext]) window.text += chars[ext];
        } else if (ext <= 159) {
          if (ext <= 135) skip(4); else if (ext <= 143) skip(5); else if (at < bytes.length) skip(bytes[at++] & 63);
        } else if (window.defined) window.text += ext === 160 ? '㏄' : '�';
      } else if (value === 24) {
        if (at + 2 > bytes.length) return; const a = bytes[at++], b = bytes[at++];
        if (window.defined) { try { window.text += a ? new TextDecoder('euc-kr').decode(new Uint8Array([a, b])) : String.fromCharCode(b); } catch (_) { window.text += '�'; } }
      } else if (value >= 17 && value <= 23) skip(1);
      else if (value >= 25 && value <= 31) skip(2);
      else if (value === 141) skip(1);
      else if (value === 144) skip(2);
      else if (value === 145) skip(3);
      else if (value === 146) skip(2);
      else if (value === 151) skip(4);
      for (const selected of service.windows) if (selected.text.length > CAPTION_LIMITS.windowCharacters)
        selected.text = selected.text.slice(-CAPTION_LIMITS.windowCharacters);
    }
    this.onText(id, service.windows.filter(window => window.visible && window.defined).map(window => window.text.trim()).filter(Boolean).join('\n'), time);
  }
}

/** Stateful decode only. The caller owns presentation order, clock, generation and rendering. */
export function createEmbeddedCaptionParser({ onUpdate = () => {} } = {}) {
  let states = new Map();
  const emit = (service, text, time) => {
    text = text.slice(0, CAPTION_LIMITS.updateCharacters);
    if ((!states.has(service) && !text) || states.get(service) === text) return;
    states.set(service, text); onUpdate(Object.freeze({ service, text, time }));
  };
  const output = () => ({ newCue() {}, dispatchCue() {}, reset() {} });
  const fields = [new Cea608Parser(1, output(), output()), new Cea608Parser(3, output(), output())];
  const digital = new DigitalCaptionParser((service, text, time) => emit(`SERVICE${service}`, text, time));
  const pushTriples = triples => {
    if (!Array.isArray(triples) || triples.length > CAPTION_LIMITS.triples) return;
    for (const triple of triples) {
      if (!triple || !Number.isFinite(triple.time) || !Number.isInteger(triple.type) || triple.type < 0 || triple.type > 3
        || !Number.isInteger(triple.a) || triple.a < 0 || triple.a > 255 || !Number.isInteger(triple.b) || triple.b < 0 || triple.b > 255) continue;
      if (triple.type < 2) {
        const field = fields[triple.type]; field.addData(triple.time, [triple.a, triple.b]);
        for (let index = 1; index <= 2; index++) emit(`CC${triple.type * 2 + index}`,
          field.channels[index].displayedMemory.getDisplayText(), triple.time);
      } else digital.add(triple);
    }
  };
  return Object.freeze({
    push(packet, options) { pushTriples(extractCaptionTriples(packet, options)); },
    pushTriples,
    reset() { for (const field of fields) field.reset(); digital.reset(); states = new Map(); },
  });
}
