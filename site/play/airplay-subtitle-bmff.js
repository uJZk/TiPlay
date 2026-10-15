// SPDX-License-Identifier: GPL-3.0-only
// Bounded ISO BMFF timed-text demux. Audio/video payloads are never decoded here.
const decoder = new TextDecoder();
const text = data => decoder.decode(data);
const u32 = (data, at) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at);
const i32 = (data, at) => new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(at);
const u64 = (data, at) => { const n = u32(data, at) * 2 ** 32 + u32(data, at + 4); if (!Number.isSafeInteger(n)) throw new Error('Unsafe MP4 subtitle offset'); return n; };
export function subtitleBoxes(data, start = 0, end = data.length) {
  const boxes = []; let at = start;
  while (at < end) {
    if (end - at < 8 || boxes.length >= 10000) throw new Error('Invalid MP4 subtitle box');
    let size = u32(data, at), header = 8;
    if (size === 1) { if (end - at < 16) throw new Error('Truncated MP4 subtitle box'); size = u64(data, at + 8); header = 16; }
    if (size === 0) size = end - at;
    if (size < header || at + size > end) throw new Error('Truncated MP4 subtitle box');
    boxes.push({ type: text(data.subarray(at + 4, at + 8)), start: at, payload: at + header, end: at + size }); at += size;
  }
  return boxes;
}
const children = (data, box) => subtitleBoxes(data, box.payload, box.end);
const find = (data, box, type) => children(data, box).find(item => item.type === type);
function requireBytes(data, at, count, end = data.length) { if (at < 0 || at + count > end) throw new Error('Truncated MP4 subtitle fields'); }
function language(n) { return String.fromCharCode(96 + (n >> 10 & 31), 96 + (n >> 5 & 31), 96 + (n & 31)); }
export function parseSubtitleInit(data) {
  const top = subtitleBoxes(data), moov = top.find(box => box.type === 'moov');
  if (!moov) return [];
  const tracks = [];
  const mvhd = find(data, moov, 'mvhd');
  const movieScale = mvhd ? (requireBytes(data, mvhd.payload, data[mvhd.payload] ? 24 : 16, mvhd.end), u32(data, mvhd.payload + (data[mvhd.payload] ? 20 : 12))) : 0;
  for (const trak of children(data, moov).filter(box => box.type === 'trak')) {
    const tkhd = find(data, trak, 'tkhd'), mdia = find(data, trak, 'mdia'); if (!tkhd || !mdia) continue;
    const mdhd = find(data, mdia, 'mdhd'), minf = find(data, mdia, 'minf'); if (!mdhd || !minf) continue;
    const stbl = find(data, minf, 'stbl'); if (!stbl) continue;
    const stsd = find(data, stbl, 'stsd'); if (!stsd) continue;
    requireBytes(data, stsd.payload, 8, stsd.end);
    const entry = subtitleBoxes(data, stsd.payload + 8, stsd.end)[0];
    if (!entry || !['wvtt', 'stpp', 'tx3g'].includes(entry.type)) continue;
    requireBytes(data, tkhd.payload, data[tkhd.payload] ? 24 : 16, tkhd.end);
    const id = u32(data, tkhd.payload + (data[tkhd.payload] ? 20 : 12));
    const timescaleAt = mdhd.payload + (data[mdhd.payload] ? 20 : 12);
    requireBytes(data, timescaleAt, data[mdhd.payload] ? 14 : 10, mdhd.end);
    const timescale = u32(data, timescaleAt); if (!timescale) throw new Error('Invalid subtitle timescale');
    const langAt = timescaleAt + (data[mdhd.payload] ? 12 : 8);
    const info = { id, codec: entry.type, timescale, language: language((data[langAt] << 8) | data[langAt + 1]), samples: [] };
    const trex = top.find(box => box.type === 'moov') && find(data, moov, 'mvex');
    if (trex) for (const box of children(data, trex)) if (box.type === 'trex') {
      requireBytes(data, box.payload, 24, box.end);
      if (u32(data, box.payload + 4) === id) { info.defaultDuration = u32(data, box.payload + 12); info.defaultSize = u32(data, box.payload + 16); }
    }
    const stsz = find(data, stbl, 'stsz'), stts = find(data, stbl, 'stts'), stsc = find(data, stbl, 'stsc');
    const offsets = find(data, stbl, 'stco') ?? find(data, stbl, 'co64');
    if (stsz && stts && stsc && offsets) {
      requireBytes(data, stsz.payload, 12, stsz.end); const size = u32(data, stsz.payload + 4), count = u32(data, stsz.payload + 8);
      if (count > 100000) throw new Error('Too many embedded subtitle samples');
      requireBytes(data, stsz.payload + 12, size ? 0 : count * 4, stsz.end);
      const sizes = Array.from({ length: count }, (_, i) => size || u32(data, stsz.payload + 12 + i * 4));
      const durations = [];
      requireBytes(data, stts.payload, 8, stts.end); const n = u32(data, stts.payload + 4); requireBytes(data, stts.payload + 8, n * 8, stts.end);
      for (let i = 0; i < n; i++) { const repeat = u32(data, stts.payload + 8 + i * 8), duration = u32(data, stts.payload + 12 + i * 8); if (durations.length + repeat > count) throw new Error('Invalid subtitle sample timing'); for (let j = 0; j < repeat; j++) durations.push(duration); }
      if (durations.length !== count) throw new Error('Invalid subtitle sample timing');
      requireBytes(data, stsc.payload, 8, stsc.end); const mappings = u32(data, stsc.payload + 4); requireBytes(data, stsc.payload + 8, mappings * 12, stsc.end);
      const composition = new Array(count).fill(0), ctts = find(data, stbl, 'ctts');
      if (ctts) {
        requireBytes(data, ctts.payload, 8, ctts.end); const entries = u32(data, ctts.payload + 4); requireBytes(data, ctts.payload + 8, entries * 8, ctts.end);
        let sample = 0;
        for (let i = 0; i < entries; i++) { const repeat = u32(data, ctts.payload + 8 + i * 8), offset = data[ctts.payload] ? i32(data, ctts.payload + 12 + i * 8) : u32(data, ctts.payload + 12 + i * 8); if (sample + repeat > count) throw new Error('Invalid subtitle composition timing'); for (let j = 0; j < repeat; j++) composition[sample++] = offset; }
        if (sample !== count) throw new Error('Invalid subtitle composition count');
      }
      const chunks = []; for (let i = 0; i < mappings; i++) chunks.push({ first: u32(data, stsc.payload + 8 + i * 12), count: u32(data, stsc.payload + 12 + i * 12) });
      requireBytes(data, offsets.payload, 8, offsets.end); const numOffsets = u32(data, offsets.payload + 4), stride = offsets.type === 'co64' ? 8 : 4; requireBytes(data, offsets.payload + 8, numOffsets * stride, offsets.end);
      let sample = 0, time = 0, mapping = 0;
      for (let c = 1; c <= numOffsets && sample < count; c++) {
        while (mapping + 1 < chunks.length && chunks[mapping + 1].first <= c) mapping++;
        if (!chunks[mapping] || chunks[mapping].first > c || chunks[mapping].count > count) throw new Error('Invalid subtitle chunk map');
        let offset = stride === 8 ? u64(data, offsets.payload + 8 + (c - 1) * stride) : u32(data, offsets.payload + 8 + (c - 1) * stride);
        for (let j = 0; j < chunks[mapping].count && sample < count; j++, sample++) { info.samples.push({ offset, size: sizes[sample], startTime: (time + composition[sample]) / timescale, endTime: (time + composition[sample] + durations[sample]) / timescale }); offset += sizes[sample]; time += durations[sample]; }
      }
      if (sample !== count) throw new Error('Invalid subtitle chunk count');
    }
    const edts = find(data, trak, 'edts'), elst = edts && find(data, edts, 'elst');
    if (elst && info.samples.length) {
      if (!movieScale) throw new Error('Subtitle edit list has no movie timescale');
      requireBytes(data, elst.payload, 8, elst.end); const count = u32(data, elst.payload + 4), stride = data[elst.payload] ? 20 : 12;
      if (count > 10000) throw new Error('Too many subtitle edits'); requireBytes(data, elst.payload + 8, count * stride, elst.end);
      const edited = []; let presentation = 0;
      for (let i = 0; i < count; i++) {
        const at = elst.payload + 8 + i * stride, duration = (stride === 20 ? u64(data, at) : u32(data, at)) / movieScale;
        const mediaTime = stride === 20 ? (i32(data, at + 8) === -1 && u32(data, at + 12) === 0xffffffff ? -1 : u64(data, at + 8)) : i32(data, at + 4);
        const rateAt = at + (stride === 20 ? 16 : 8);
        if (data[rateAt] !== 0 || data[rateAt + 1] !== 1 || data[rateAt + 2] || data[rateAt + 3]) throw new Error('Unsupported subtitle edit rate');
        if (mediaTime >= 0) for (const sample of info.samples) {
          const from = Math.max(sample.startTime, mediaTime / timescale), to = Math.min(sample.endTime, mediaTime / timescale + duration);
          if (to > from) edited.push({ ...sample, startTime: presentation + from - mediaTime / timescale, endTime: presentation + to - mediaTime / timescale });
        }
        presentation += duration;
      }
      info.samples = edited;
    }
    tracks.push(info);
  }
  return tracks;
}
export function parseSubtitleFragment(data, tracks) {
  const result = [], top = subtitleBoxes(data), payloads = top.filter(box => box.type === 'mdat');
  for (const moof of top.filter(box => box.type === 'moof')) for (const traf of children(data, moof).filter(box => box.type === 'traf')) {
    const tfhd = find(data, traf, 'tfhd'), tfdt = find(data, traf, 'tfdt'); if (!tfhd || !tfdt) continue;
    requireBytes(data, tfhd.payload, 8, tfhd.end); const track = tracks.find(item => item.id === u32(data, tfhd.payload + 4)); if (!track) continue;
    const flags = u32(data, tfhd.payload) & 0xffffff; let at = tfhd.payload + 8, base = moof.start, duration = track.defaultDuration || 0, size = track.defaultSize || 0;
    if (flags & 1) { requireBytes(data, at, 8, tfhd.end); base = u64(data, at); at += 8; }
    if (flags & 2) at += 4;
    if (flags & 8) { requireBytes(data, at, 4, tfhd.end); duration = u32(data, at); at += 4; }
    if (flags & 16) { requireBytes(data, at, 4, tfhd.end); size = u32(data, at); at += 4; }
    requireBytes(data, tfdt.payload, data[tfdt.payload] ? 12 : 8, tfdt.end); let time = data[tfdt.payload] ? u64(data, tfdt.payload + 4) : u32(data, tfdt.payload + 4);
    let cursor = top.find(box => box.type === 'mdat' && box.start >= moof.end)?.payload;
    for (const trun of children(data, traf).filter(box => box.type === 'trun')) {
      requireBytes(data, trun.payload, 8, trun.end); const runFlags = u32(data, trun.payload) & 0xffffff, count = u32(data, trun.payload + 4); if (count > 10000) throw new Error('Too many subtitle fragment samples');
      let p = trun.payload + 8;
      if (runFlags & 1) { requireBytes(data, p, 4, trun.end); cursor = base + i32(data, p); p += 4; }
      if (runFlags & 4) p += 4;
      for (let i = 0; i < count; i++) {
        let d = duration, s = size, cto = 0;
        if (runFlags & 256) { requireBytes(data, p, 4, trun.end); d = u32(data, p); p += 4; }
        if (runFlags & 512) { requireBytes(data, p, 4, trun.end); s = u32(data, p); p += 4; }
        if (runFlags & 1024) p += 4;
        if (runFlags & 2048) { requireBytes(data, p, 4, trun.end); cto = data[trun.payload] ? i32(data, p) : u32(data, p); p += 4; }
        if (!d || !s || cursor === undefined || s > 512 * 1024) throw new Error('Invalid subtitle fragment sample');
        requireBytes(data, cursor, s);
        if (result.length >= 10000) throw new Error('Too many subtitle samples in one resource');
        if (!payloads.some(box => cursor >= box.payload && cursor + s <= box.end)) throw new Error('Subtitle sample is outside its media payload');
        result.push({ track, data: data.subarray(cursor, cursor + s), startTime: (time + cto) / track.timescale, endTime: (time + cto + d) / track.timescale }); cursor += s; time += d;
      }
    }
  }
  return result;
}
const entities = value => value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, name) => name[0] === '#' ? String.fromCodePoint(Math.min(0x10ffff, Number(name[1]?.toLowerCase() === 'x' ? `0x${name.slice(2)}` : name.slice(1)))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name.toLowerCase()]);
function ttmlTime(value, frameRate = 30, tickRate = 1) {
  if (!value) return null;
  const clock = /^(\d+):(\d\d):(\d\d)(?:\.(\d+)|:(\d+))?$/.exec(value);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + (clock[4] ? Number(`0.${clock[4]}`) : Number(clock[5] || 0) / frameRate);
  const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(value);
  if (!offset) throw new Error('Unsupported TTML timing');
  return Number(offset[1]) * ({ h: 3600, m: 60, s: 1, ms: .001, f: 1 / frameRate, t: 1 / tickRate })[offset[2]];
}
export function decodeSubtitleSample(data, codec, startTime, endTime) {
  if (codec === 'wvtt') return subtitleBoxes(data).filter(box => box.type === 'vttc').map(box => {
    const cue = children(data, box), payload = cue.find(part => part.type === 'payl');
    return payload ? { id: text(data.subarray(cue.find(part => part.type === 'iden')?.payload ?? payload.payload, cue.find(part => part.type === 'iden')?.end ?? payload.payload)), startTime, endTime, text: text(data.subarray(payload.payload, payload.end)) } : null;
  }).filter(Boolean);
  if (codec === 'tx3g') { requireBytes(data, 0, 2); const size = data[0] << 8 | data[1]; requireBytes(data, 2, size); let payload = data.subarray(2, 2 + size), value; if (payload[0] === 0xfe && payload[1] === 0xff) value = new TextDecoder('utf-16be').decode(payload.subarray(2)); else if (payload[0] === 0xff && payload[1] === 0xfe) value = new TextDecoder('utf-16le').decode(payload.subarray(2)); else value = text(payload); return value ? [{ startTime, endTime, text: value }] : []; }
  if (codec !== 'stpp') throw new Error('Unsupported embedded subtitle codec');
  const xml = text(data); if (xml.includes('<!DOCTYPE') || xml.includes('<!ENTITY')) throw new Error('Unsupported TTML entity declaration');
  const frameRate = Number(/(?:\w+:)?frameRate=["']([\d.]+)["']/.exec(xml)?.[1] ?? 30), tickRate = Number(/(?:\w+:)?tickRate=["']([\d.]+)["']/.exec(xml)?.[1] ?? 1);
  if (!(frameRate > 0 && tickRate > 0)) throw new Error('Invalid TTML clock');
  const cues = [];
  // TTML cues inherit timing from body/div. A DOM walk retains that timing without executing markup.
  if (globalThis.DOMParser) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('Invalid TTML document');
    const visit = (node, parentStart, parentEnd) => {
      const begin = ttmlTime(node.getAttribute('begin'), frameRate, tickRate), end = ttmlTime(node.getAttribute('end'), frameRate, tickRate), dur = ttmlTime(node.getAttribute('dur'), frameRate, tickRate);
      const from = parentStart + (begin ?? 0), to = Math.min(parentEnd, end === null ? dur === null ? parentEnd : from + dur : parentStart + end);
      if (node.localName === 'p') { const extract = value => [...value.childNodes].map(child => child.nodeType === 1 ? child.localName === 'br' ? '\n' : extract(child) : child.textContent).join(''); const value = extract(node).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).join('\n').trim(); if (value && to > from) cues.push({ startTime: from, endTime: to, text: value }); }
      else for (const child of node.children) visit(child, from, to);
    };
    visit(doc.documentElement, 0, endTime); return cues.filter(cue => cue.endTime > startTime).map(cue => ({ ...cue, startTime: Math.max(startTime, cue.startTime) }));
  }
  // Node tests lack XML DOM; accept the simple IMSC text profile only in that environment.
  for (const match of xml.matchAll(/<(?:\w+:)?p\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?p>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:]+)=["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
    const from = ttmlTime(attrs.begin, frameRate, tickRate) ?? startTime, to = ttmlTime(attrs.end, frameRate, tickRate) ?? (attrs.dur ? from + ttmlTime(attrs.dur, frameRate, tickRate) : endTime);
    const value = entities(match[2].replace(/<(?:\w+:)?br\s*\/?\s*>/g, '\n').replace(/<[^>]*>/g, '')).trim(); if (value && to > from) cues.push({ startTime: Math.max(startTime, from), endTime: Math.min(endTime, to), text: value });
  }
  return cues;
}

/** Media presentation anchor in a mixed HLS fragment. Retain timescales from its init. */
export function parseTrackClocks(data) {
  const moov = subtitleBoxes(data).find(box => box.type === 'moov'); if (!moov) return [];
  const result = [];
  for (const trak of children(data, moov).filter(box => box.type === 'trak')) {
    const tkhd = find(data, trak, 'tkhd'), mdia = find(data, trak, 'mdia'); if (!tkhd || !mdia) continue;
    const mdhd = find(data, mdia, 'mdhd'), hdlr = find(data, mdia, 'hdlr'); if (!mdhd || !hdlr) continue;
    const idAt = tkhd.payload + (data[tkhd.payload] ? 20 : 12), scaleAt = mdhd.payload + (data[mdhd.payload] ? 20 : 12);
    requireBytes(data, idAt, 4, tkhd.end); requireBytes(data, scaleAt, 4, mdhd.end); requireBytes(data, hdlr.payload, 12, hdlr.end);
    const timescale = u32(data, scaleAt), kind = text(data.subarray(hdlr.payload + 8, hdlr.payload + 12));
    if (timescale && ['vide', 'soun'].includes(kind)) {
      const id = u32(data, idAt), mvex = find(data, moov, 'mvex'); let defaultDuration = 0;
      if (mvex) for (const trex of children(data, mvex).filter(box => box.type === 'trex')) {
        requireBytes(data, trex.payload, 20, trex.end); if (u32(data, trex.payload + 4) === id) defaultDuration = u32(data, trex.payload + 12);
      }
      result.push({ id, timescale, kind, defaultDuration });
    }
  }
  return result;
}
export function fragmentPresentationStart(data, clocks) {
  const values = [];
  for (const moof of subtitleBoxes(data).filter(box => box.type === 'moof')) for (const traf of children(data, moof).filter(box => box.type === 'traf')) {
    const tfhd = find(data, traf, 'tfhd'), tfdt = find(data, traf, 'tfdt'); if (!tfhd || !tfdt) continue;
    requireBytes(data, tfhd.payload, 8, tfhd.end); const clock = clocks.find(item => item.id === u32(data, tfhd.payload + 4)); if (!clock) continue;
    requireBytes(data, tfdt.payload, data[tfdt.payload] ? 12 : 8, tfdt.end);
    let time = data[tfdt.payload] ? u64(data, tfdt.payload + 4) : u32(data, tfdt.payload + 4), duration = clock.defaultDuration || 0;
    const flags = u32(data, tfhd.payload) & 0xffffff; let at = tfhd.payload + 8 + (flags & 1 ? 8 : 0) + (flags & 2 ? 4 : 0);
    if (flags & 8) { requireBytes(data, at, 4, tfhd.end); duration = u32(data, at); }
    let first = Infinity;
    for (const run of children(data, traf).filter(box => box.type === 'trun')) {
      requireBytes(data, run.payload, 8, run.end); const flags = u32(data, run.payload) & 0xffffff, count = u32(data, run.payload + 4); if (count > 10000) throw new Error('Too many media anchor samples');
      let at = run.payload + 8 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0);
      for (let i = 0; i < count; i++) {
        let delta = duration, offset = 0;
        if (flags & 256) { requireBytes(data, at, 4, run.end); delta = u32(data, at); at += 4; }
        if (flags & 512) at += 4;
        if (flags & 1024) at += 4;
        if (flags & 2048) { requireBytes(data, at, 4, run.end); offset = data[run.payload] ? i32(data, at) : u32(data, at); at += 4; }
        if (at > run.end) throw new Error('Truncated media anchor');
        first = Math.min(first, (time + offset) / clock.timescale); time += delta;
      }
    }
    if (Number.isFinite(first)) values.push({ kind: clock.kind, first });
  }
  const video = values.filter(value => value.kind === 'vide');
  const selected = video.length ? video : values;
  return selected.length ? Math.min(...selected.map(value => value.first)) : null;
}
