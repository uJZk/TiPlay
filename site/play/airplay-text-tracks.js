// SPDX-License-Identifier: GPL-3.0-only
import { HlsWebVTTParser, HlsVTTParser, HlsVTTTimestamp, HlsCea608Parser } from './vendor/mediabunny/mediabunny.min.js';

import { captionTriples, DigitalCaptionParser } from './airplay-caption-data.js';
import { subtitleBoxes, parseSubtitleInit, parseSubtitleFragment, decodeSubtitleSample, parseTrackClocks, fragmentPresentationStart } from './airplay-subtitle-bmff.js';

const MAX_TRACKS = 8, MAX_SEGMENTS = 10000, MAX_CACHED_SEGMENTS = 6, MAX_CUES = 4000;
const PLAYLIST_BYTES = 2 * 1024 * 1024, VTT_BYTES = 512 * 1024;
const abortError = () => new DOMException('Subtitle request cancelled', 'AbortError');
const segmentKey = segment => `${segment.cc}:${segment.sequence}:${segment.url}:${segment.range?.offset ?? ''}:${segment.key?.url ?? ''}:${segment.key?.iv ?? ''}:${segment.init?.url ?? ''}`;

function trackEvent(type, track) {
  return Object.assign(new Event(type), { track });
}

class TrackList extends EventTarget {
  items = [];
  get length() { return this.items.length; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  getTrackById(id) { return this.items.find(track => track.id === id) ?? null; }
  add(track) {
    this[this.length] = track; this.items.push(track);
    this.dispatchEvent(trackEvent('addtrack', track));
  }
  clear() {
    const old = this.items.splice(0);
    for (let i = 0; i < old.length; i++) delete this[i];
    for (const track of old) this.dispatchEvent(trackEvent('removetrack', track));
  }
}

/** Resolve rewritten phone routes without dropping their pairing/session credentials. */
export function resolveSubtitleUrl(path, base) {
  const url = new URL(path, base), parent = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported subtitle URL');
  if (url.origin === parent.origin && url.pathname === '/airplay-resource' && parent.pathname === url.pathname) {
    for (const key of ['id', 'c', 's']) if (!url.searchParams.has(key) && parent.searchParams.has(key)) {
      url.searchParams.set(key, parent.searchParams.get(key));
    }
  }
  return url.href;
}

function attributes(input) {
  const values = {};
  for (const match of input.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    values[match[1]] = match[2].startsWith('"') ? match[2].slice(1, -1) : match[2].trim();
  }
  return values;
}

function parsePlaylist(text, url, previous = []) {
  const segments = [], discontinuities = new Map();
  const oldSegments = new Map(previous.map(segment => [segment.sequence, segment]));
  let sequence = 0, cc = 0, start = 0, duration = null, range = null, rangeEnd = 0;
  let targetDuration = 6, endList = false, key = null, init = null, rangeUrl = null;
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.slice(22));
    else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) cc = Number(line.slice(30));
    else if (line === '#EXT-X-DISCONTINUITY') cc++;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(line.slice(22)) || 6;
    else if (line === '#EXT-X-ENDLIST') endList = true;
    else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const parts = line.slice(17).split('@');
      range = { length: Number(parts[0]), offset: parts[1] === undefined ? null : Number(parts[1]) };
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const values = attributes(line.slice(11));
      if (values.METHOD === 'NONE') key = null;
      else {
        if (values.METHOD !== 'AES-128' || values.KEYFORMAT && values.KEYFORMAT !== 'identity') throw new Error('Unsupported subtitle encryption scheme (DRM/SAMPLE-AES)');
        if (!values.URI || values.IV && !/^0x[\da-f]{1,32}$/i.test(values.IV)) throw new Error('Invalid subtitle AES key/IV');
        key = { url: resolveSubtitleUrl(values.URI, url), iv: values.IV ? `0x${values.IV.slice(2).padStart(32, '0')}` : undefined };
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const values = attributes(line.slice(11));
      if (!values.URI) throw new Error('Missing subtitle initialization URL');
      let mapRange;
      if (values.BYTERANGE) {
        const [length, offset = '0'] = values.BYTERANGE.split('@'); mapRange = { length: Number(length), offset: Number(offset) };
        if (!Number.isSafeInteger(mapRange.length) || !Number.isSafeInteger(mapRange.offset) || mapRange.length <= 0 || mapRange.offset < 0) throw new Error('Invalid subtitle initialization byte range');
      }
      if (key && !key.iv) throw new Error('Encrypted subtitle initialization requires an explicit IV');
      init = { url: resolveSubtitleUrl(values.URI, url), range: mapRange, key };
    }
    else if (line && !line.startsWith('#') && duration !== null) {
      if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(cc) || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('Invalid subtitle playlist timing');
      }
      const resource = resolveSubtitleUrl(line, url);
      if (range) {
        if (range.offset === null) {
          if (rangeUrl !== resource) throw new Error('Subtitle byte range has no preceding offset');
          range.offset = rangeEnd;
        }
        if (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.length) || range.offset < 0 || range.length <= 0) {
          throw new Error('Invalid subtitle byte range');
        }
        rangeEnd = range.offset + range.length; rangeUrl = resource;
        if (!Number.isSafeInteger(rangeEnd)) throw new Error('Invalid subtitle byte range');
      }
      const overlap = oldSegments.get(sequence);
      if (!segments.length && overlap) start = overlap.start;
      if (!segments.length && previous.length && !overlap) throw new Error('Subtitle live window lost its timeline anchor');
      if (!discontinuities.has(cc)) discontinuities.set(cc, { start, segment: null });
      const segment = { sequence: sequence++, cc, start, end: start + duration, url: resource, range, key, init };
      if (!discontinuities.get(cc).segment) discontinuities.get(cc).segment = segment;
      segments.push(segment); start += duration; duration = null; range = null;
      if (segments.length > MAX_SEGMENTS) throw new Error('Subtitle playlist is too large');
    }
  }
  return { segments, discontinuities, targetDuration, endList };
}

function timestampMap(text) {
  const header = text.split(/\r?\n\r?\n/, 1)[0];
  const line = header.split(/\r?\n/).find(value => value.startsWith('X-TIMESTAMP-MAP='));
  if (!line) return null;
  const localText = /(?:=|,)LOCAL:([^,]+)/.exec(line)?.[1];
  const mpegText = /(?:=|,)MPEGTS:(\d+)(?:,|$)/.exec(line)?.[1];
  const local = localText === undefined ? NaN : HlsVTTTimestamp(localText);
  const mpegts = Number(mpegText);
  if (!Number.isFinite(local) || !Number.isSafeInteger(mpegts) || mpegts < 0 || mpegts >= 2 ** 33) {
    throw new Error('Invalid subtitle timestamp map');
  }
  return { local, mpegts };
}

function plainCue(cue) {
  let text;
  try { text = cue.getCueAsHTML?.().textContent; } catch { /* hls.js's VTTCue fallback has no DOM converter. */ }
  if (text === undefined) {
    text = cue.text.replace(/<\/?(?:b|i|u|c(?:\.[^>\s]*)?|v(?:\s[^>]*)?|lang(?:\s[^>]*)?|ruby|rt)>/g, '')
      .replace(/<\d{2,}:\d{2}(?::\d{2})?\.\d{3}>/g, '')
      .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' })[entity]);
  }
  return Object.freeze({ id: cue.id, startTime: cue.startTime, endTime: cue.endTime, text });
}

function parseCues(text, segment, anchor, origin) {
  let cues = [], error = null;
  if (segment) {
    const ccStart = anchor.start;
    const map = timestampMap(text), initPTS = map ? origin ?? anchor.origin : undefined;
    if (map && (!initPTS || !Number.isFinite(initPTS.baseTime) || !Number.isFinite(initPTS.timescale) || initPTS.timescale <= 0)) {
      throw new Error('Subtitle timestamp anchor is unavailable');
    }
    HlsWebVTTParser(new TextEncoder().encode(text).buffer, initPTS,
      { ccOffset: ccStart, presentationOffset: 0, [segment.cc]: { start: ccStart, new: false, prevCC: -1 } },
      segment.cc, segment.start, value => { cues = value; }, value => { error = value; });
  } else {
    const parser = new HlsVTTParser();
    parser.oncue = cue => cues.push(cue); parser.onparsingerror = value => { error = value; };
    parser.parse(text.replace(/^\uFEFF/, '') + '\n'); parser.flush();
  }
  if (error) throw error;
  if (cues.length > MAX_CUES) throw new Error('Subtitle segment has too many cues');
  return cues.filter(cue => Number.isFinite(cue.startTime) && Number.isFinite(cue.endTime) && cue.endTime > cue.startTime).map(plainCue);
}

async function readBytes(response, limit, signal, bmffOnly = false) {
  if (signal.aborted || !response.ok || Number(response.headers?.get('Content-Length')) > limit) {
    await response.body?.cancel().catch(() => {});
    if (signal.aborted) throw abortError();
    if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
    throw new Error('Subtitle response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (signal.aborted) throw abortError();
    if (data.length > limit) throw new Error('Subtitle response is too large');
    return data;
  }
  let size = 0; const chunks = [];
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Subtitle response is too large');
      chunks.push(value);
      if (bmffOnly && size >= 8) {
        const prefix = new Uint8Array(8); let offset = 0;
        for (const chunk of chunks) { const n = Math.min(chunk.length, 8 - offset); prefix.set(chunk.subarray(0, n), offset); offset += n; if (offset === 8) break; }
        if (!['ftyp', 'styp', 'moof', 'moov', 'sidx', 'free', 'emsg'].includes(new TextDecoder().decode(prefix.subarray(4)))) return null;
        bmffOnly = false;
      }
    }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return data;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** HLS WebVTT uses hls.js's maintained parser, while cue activation follows TiPlay's media clock. */
export function createMediaTextTracks({ fetchResource = fetch, signal } = {}) {
  const tracks = new TrackList(), states = new Map(), queue = [];
  let session = null, generation = 0, disposed = false, currentTime = 0, requests = 0;
  let timestampOrigin, observedMediaOrigin;
  const captionQueue = [];
  const aesKeys = new Map(), observedInit = new Map(), embedded = new Map(), captionParsers = new Map(), observedPlaylists = new Map(), resourceKeys = new Map(), playlistReads = new Set();

  function pump() {
    while (requests < 2 && queue.length) {
      const task = queue.shift();
      task.signal.removeEventListener('abort', task.cancel);
      if (task.signal.aborted) { task.reject(abortError()); continue; }
      requests++;
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { requests--; pump(); });
    }
  }
  function request(url, limit, requestSignal, range) {
    return new Promise((resolve, reject) => {
      if (requestSignal.aborted) { reject(abortError()); return; }
      const task = { signal: requestSignal, resolve, reject, run: async () => {
        const timeout = new AbortController();
        const abort = () => timeout.abort();
        requestSignal.addEventListener('abort', abort, { once: true });
        if (requestSignal.aborted) timeout.abort();
        const timer = setTimeout(abort, 15000);
        const headers = range ? { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : undefined;
        let rejectAbort;
        const cancelled = new Promise((_, reject) => { rejectAbort = () => reject(abortError()); });
        timeout.signal.addEventListener('abort', rejectAbort, { once: true });
        try {
          if (timeout.signal.aborted) throw abortError();
          const response = await Promise.race([
            Promise.resolve(fetchResource(url, { signal: timeout.signal, headers, referrerPolicy: 'no-referrer', cache: 'no-store' }))
              .then(value => {
                if (timeout.signal.aborted) { value.body?.cancel().catch(() => {}); throw abortError(); }
                return value;
              }), cancelled,
          ]);
          if (range && response.status !== 206) {
            await response.body?.cancel().catch(() => {});
            throw new Error('Subtitle server ignored its byte range');
          }
          const data = await readBytes(response, limit, timeout.signal);
          return { data, text: new TextDecoder().decode(data), url: response.url || url, contentRange: response.headers?.get('Content-Range') };
        } finally {
          clearTimeout(timer); requestSignal.removeEventListener('abort', abort);
          timeout.signal.removeEventListener('abort', rejectAbort);
        }
      }, cancel: () => {
        const index = queue.indexOf(task);
        if (index >= 0) queue.splice(index, 1);
        reject(abortError());
      } };
      requestSignal.addEventListener('abort', task.cancel, { once: true });
      queue.push(task); pump();
    });
  }
  function active(track) {
    const cues = track.mode === 'disabled' ? [] : track.cues.filter(cue => cue.startTime <= currentTime && currentTime < cue.endTime);
    if (cues.length === track.activeCues.length && cues.every((cue, index) => cue === track.activeCues[index])) return;
    track.activeCues = cues; track.dispatchEvent(new Event('cuechange'));
  }
  function publish(track, state) {
    const available = track.supported || track.cues.length > 0;
    track.supported = true;
    const unique = new Map();
    for (const cues of state.cache.values()) for (const cue of cues) {
      unique.set(`${cue.startTime}:${cue.endTime}:${cue.text}`, cue);
    }
    track.cues = [...unique.values()].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
    active(track);
    if (available !== (track.supported || track.cues.length > 0)) tracks.dispatchEvent(new Event('change'));
  }
  function report(track, error) {
    track.error = error;
    tracks.dispatchEvent(Object.assign(trackEvent('error', track), { error }));
  }
  function addTrack(info, url, standalone = false) {
    const track = Object.assign(new EventTarget(), info, { cues: [], activeCues: [], error: null });
    const state = { url, standalone, cache: new Map(), anchors: new Map(), inits: new Map(), playlist: null, refreshed: 0, errorUntil: 0, busy: false, controller: null, mode: 'disabled' };
    Object.defineProperty(track, 'mode', { enumerable: true, get: () => state.mode, set: value => {
      if (!['disabled', 'hidden', 'showing'].includes(value) || value === state.mode || !states.has(track)) return;
      state.mode = value;
      if (value === 'disabled') state.controller?.abort();
      active(track); tracks.dispatchEvent(new Event('change'));
      if (value !== 'disabled') schedule(track, state);
    } });
    states.set(track, state); tracks.add(track);
    return track;
  }
  async function payload(resource, state, requestSignal, sequence = 0) {
    const { data } = await request(resource.url, VTT_BYTES, requestSignal, resource.range);
    return decryptPayload(data, resource.key, requestSignal, sequence);
  }
  async function decryptPayload(data, encryption, requestSignal, sequence = 0) {
    if (!encryption) return data;
    if (!globalThis.crypto?.subtle) throw new Error('AES subtitle decryption requires Web Crypto');
    // A repeated EXT-X-KEY may rotate the bytes behind the same URI. Cache within
    // this declaration, including its MAP/segments, rather than across declarations.
    let key = aesKeys.get(encryption);
    if (!key) {
      const result = await request(encryption.url, 16, requestSignal);
      if (result.data.length !== 16) throw new Error('Invalid subtitle AES key length');
      key = await crypto.subtle.importKey('raw', result.data, 'AES-CBC', false, ['decrypt']);
      if (requestSignal.aborted) throw abortError();
      aesKeys.set(encryption, key);
      while (aesKeys.size > 8) aesKeys.delete(aesKeys.keys().next().value);
    }
    const iv = new Uint8Array(16);
    if (encryption.iv) for (let i = 0; i < 16; i++) iv[i] = parseInt(encryption.iv.slice(2 + i * 2, 4 + i * 2), 16);
    else { let value = BigInt(sequence); for (let i = 15; i >= 0; i--) { iv[i] = Number(value & 255n); value >>= 8n; } }
    if (!data.length || data.length % 16) throw new Error('Invalid encrypted subtitle segment');
    const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
    if (requestSignal.aborted) throw abortError();
    return clear;
  }
  async function segmentCues(segment, state, requestSignal) {
    const key = segmentKey(segment);
    if (state.cache.has(key)) {
      const cues = state.cache.get(key); state.cache.delete(key); state.cache.set(key, cues); return;
    }
    if (segment.init) {
      const initKey = JSON.stringify(segment.init);
      let info = state.inits.get(initKey);
      if (!info) {
        info = parseSubtitleInit(await payload(segment.init, state, requestSignal));
        if (!info.length) throw new Error('Initialization contains no supported timed-text track');
        state.inits.set(initKey, info);
        while (state.inits.size > 4) state.inits.delete(state.inits.keys().next().value);
      }
      const samples = parseSubtitleFragment(await payload(segment, state, requestSignal, segment.sequence), info);
      if (!samples.length) { state.cache.set(key, []); return; }
      let anchor = state.anchors.get(segment.cc);
      if (!anchor) {
        // Decode-time zero can differ from the EXTINF presentation timeline. Anchor the first
        // fragment of each discontinuity, including when playback starts in a later segment.
        const first = state.playlist.discontinuities.get(segment.cc).segment;
        const initial = first.sequence === segment.sequence ? samples : parseSubtitleFragment(await payload(first, state, requestSignal, first.sequence), info);
        if (!initial.length) throw new Error('Subtitle fragment timeline anchor unavailable');
        const sourceOrigin = originFor(segment.cc);
        const offset = sourceOrigin && Number.isFinite(sourceOrigin.baseTime) && sourceOrigin.timescale > 0 ? -sourceOrigin.baseTime / sourceOrigin.timescale : first.start - Math.min(...initial.map(sample => sample.startTime));
        anchor = { offset }; state.anchors.set(segment.cc, anchor);
      }
      state.cache.set(key, samples.flatMap(sample => decodeSubtitleSample(sample.data, sample.track.codec, sample.startTime, sample.endTime))
        .map(cue => plainCue({ ...cue, startTime: cue.startTime + anchor.offset, endTime: cue.endTime + anchor.offset })));
      return;
    }
    let anchor = state.anchors.get(segment.cc);
    if (!anchor) {
      const first = state.playlist.discontinuities.get(segment.cc).segment;
      const text = new TextDecoder().decode(await payload(first, state, requestSignal, first.sequence)), map = timestampMap(text);
      anchor = { start: first.start, origin: map ? { baseTime: map.mpegts - first.start * 90000, timescale: 90000 } : undefined };
      state.anchors.set(segment.cc, anchor);
      if (state.anchors.size > 64) state.anchors.delete(state.anchors.keys().next().value);
      if (first.sequence === segment.sequence) {
        state.cache.set(key, parseCues(text, segment, anchor, originFor(segment.cc)));
        return;
      }
    }
    const text = new TextDecoder().decode(await payload(segment, state, requestSignal, segment.sequence));
    state.cache.set(key, parseCues(text, segment, anchor, originFor(segment.cc)));
  }
  function originFor(cc) { return typeof timestampOrigin === 'function' ? timestampOrigin(cc) : timestampOrigin; }
  function schedule(track, state) {
    if (disposed || state.manual || !session || signal?.aborted || session.signal.aborted || state.busy || track.mode === 'disabled' && !state.probing || Date.now() < state.errorUntil) return;
    if (state.standalone && state.cache.size && !state.embeddedSamples) return;
    if (state.embeddedSamples) {
      const samples = state.embeddedSamples.filter(sample => sample.startTime <= currentTime + 10 && sample.endTime > currentTime - 2);
      if (!samples.length || samples.every(sample => state.cache.has(`sample:${sample.offset}:${sample.startTime}`))) return;
    }
    if (state.playlist && (state.playlist.endList || Date.now() - state.refreshed < Math.max(2000, state.playlist.targetDuration * 500))) {
      const index = state.playlist.segments.findIndex(segment => segment.start <= currentTime && currentTime < segment.end);
      if (index < 0 || state.playlist.segments.slice(Math.max(0, index - 1), index + 2).every(segment => state.cache.has(segmentKey(segment)))) return;
    }
    const owner = generation, ownerSession = session, time = currentTime, controller = new AbortController();
    const cancel = () => controller.abort();
    ownerSession.signal.addEventListener('abort', cancel, { once: true });
    state.busy = true; state.controller = controller; state.workTime = time;
    (async () => {
      if (state.embeddedSamples) {
        const samples = state.embeddedSamples.filter(sample => sample.startTime <= time + 10 && sample.endTime > time - 2).slice(0, 64);
        for (const sample of samples) {
          const key = `sample:${sample.offset}:${sample.startTime}`; if (state.cache.has(key)) continue;
          const { data } = await request(state.url, VTT_BYTES, controller.signal, { offset: sample.offset, length: sample.size });
          state.cache.set(key, decodeSubtitleSample(data, state.codec, sample.startTime, sample.endTime).map(plainCue));
        }
        while (state.cache.size > 64) state.cache.delete(state.cache.keys().next().value);
      } else if (state.standalone) {
        const { text } = await request(state.url, VTT_BYTES, controller.signal);
        state.cache.set('standalone', parseCues(text));
      } else {
        if (!state.playlist || !state.playlist.endList && Date.now() - state.refreshed >= Math.max(2000, state.playlist.targetDuration * 500)) {
          const { text, url } = await request(state.url, PLAYLIST_BYTES, controller.signal);
          state.url = url;
          state.playlist = parsePlaylist(text, url, state.playlist?.segments);
          state.refreshed = Date.now();
        }
        const index = state.playlist.segments.findIndex(segment => segment.start <= time && time < segment.end);
        if (index >= 0) {
          for (const segment of state.playlist.segments.slice(Math.max(0, index - 1), index + 2)) {
            await segmentCues(segment, state, controller.signal);
          }
        }
        while (state.cache.size > MAX_CACHED_SEGMENTS) state.cache.delete(state.cache.keys().next().value);
      }
      if (owner === generation && !controller.signal.aborted && states.has(track)) { state.probing = false; track.error = null; publish(track, state); }
    })().catch(error => {
      if (owner === generation && !controller.signal.aborted && states.has(track)) {
        state.errorUntil = Date.now() + 5000; report(track, error);
      }
    }).finally(() => {
      ownerSession.signal.removeEventListener('abort', cancel);
      state.busy = false; state.controller = null;
      if (owner === generation && (time !== currentTime || controller.signal.aborted) && states.has(track)) schedule(track, state);
    });
  }
  function embeddedTrack(info, key) {
    let track = embedded.get(key);
    if (track) return track;
    if (tracks.length >= MAX_TRACKS) return null;
    track = addTrack({ id: key, kind: info.kind ?? 'subtitles', label: info.label ?? `Subtitles ${info.language || info.id}`, language: info.language === 'und' ? '' : info.language ?? '' }, '', true);
    const state = states.get(track); state.manual = true;
    embedded.set(key, track); return track;
  }
  function appendEmbedded(info, cues, key, bucket) {
    if (!cues.length) return;
    const track = embeddedTrack(info, key); if (!track) return;
    const state = states.get(track);
    if (info.mediaOrigin !== undefined) state.mediaOrigin = info.mediaOrigin;
    if (info.hlsAligned !== undefined) state.hlsAligned = info.hlsAligned;
    state.cache.set(bucket, cues.filter(cue => cue.endTime > cue.startTime).map(plainCue));
    while (state.cache.size > MAX_CACHED_SEGMENTS) state.cache.delete(state.cache.keys().next().value);
    publish(track, state);
  }
  async function discoverMp4(url, requestSignal, sourceOrigin) {
    let offset = 0;
    for (let boxes = 0; boxes < 1000; boxes++) {
      const header = await request(url, 16, requestSignal, { offset, length: 16 });
      if (header.data.length < 8) return;
      const view = new DataView(header.data.buffer, header.data.byteOffset, header.data.byteLength);
      let size = view.getUint32(0); const type = new TextDecoder().decode(header.data.subarray(4, 8));
      if (size === 1) { if (header.data.length < 16) return; size = view.getUint32(8) * 2 ** 32 + view.getUint32(12); }
      if (!Number.isSafeInteger(size) || size < 8 || !Number.isSafeInteger(offset + size)) return;
      if (type === 'moov') {
        if (size > PLAYLIST_BYTES) throw new Error('Embedded subtitle index is too large');
        const { data } = await request(url, PLAYLIST_BYTES, requestSignal, { offset, length: size });
        const infos = parseSubtitleInit(data);
        for (const info of infos) {
          if (!info.samples.length) continue;
          const track = embeddedTrack(info, `mp4-${info.id}`); if (!track) continue;
          const state = states.get(track); state.manual = false; state.standalone = true; state.url = url; state.codec = info.codec;
          Object.defineProperty(state, 'embeddedSamples', { get: () => {
            const origin = Number(typeof sourceOrigin === 'function' ? sourceOrigin() : sourceOrigin) || 0;
            return info.samples.map(sample => ({ ...sample, startTime: sample.startTime - origin, endTime: sample.endTime - origin }));
          } });
          state.probing = true; schedule(track, state);
          // The menu is present only when a supported real track and sample table exist.
        }
        return;
      }
      const total = Number(/\/(\d+)$/.exec(header.contentRange ?? '')?.[1]);
      offset += size; if (total && offset >= total) return;
    }
    throw new Error('Embedded subtitle index has too many boxes');
  }
  function captionText(id, value, time) {
    const key = `cea708-${id}`, existing = embedded.get(key);
    if (!value && !existing) return;
    const track = existing ?? embeddedTrack({ id, kind: 'captions', label: `CC Service ${id}` }, key); if (!track) return;
    const state = states.get(track), last = state.openCaption;
    if (last?.text === value) return;
    if (last) {
      const endTime = Math.max(last.startTime, time);
      state.cache.set(`caption:${last.startTime}`, endTime > last.startTime ? [plainCue({ ...last, endTime })] : []);
    }
    state.openCaption = value ? { startTime: time, endTime: Number.MAX_VALUE, text: value } : null;
    state.cache.set('open', state.openCaption ? [plainCue(state.openCaption)] : []);
    while (state.cache.size > MAX_CACHED_SEGMENTS) state.cache.delete(state.cache.keys().next().value);
    publish(track, state);
  }
  const digitalCaptions = new DigitalCaptionParser(captionText);
  function resetCaptionDecoder(time = currentTime) {
    captionQueue.length = 0;
    for (const parser of captionParsers.values()) parser.reset();
    digitalCaptions.services.clear(); digitalCaptions.packet = []; digitalCaptions.expected = 0; digitalCaptions.sequence = null;
    currentTime = Math.max(0, Number(time) || 0);
    for (const [track, state] of states) if (/^cea/.test(track.id)) { state.openCaption = null; state.cache.delete('open'); state.cache.delete('live'); publish(track, state); }
  }
  function captionPacket(data, time, codec, config) {
    if (disposed || !session || session.signal.aborted) return;
    for (const triple of captionTriples(data, time, codec, config)) if (captionQueue.length < 4096) captionQueue.push(triple);
    captionQueue.sort((a, b) => a.timestamp - b.timestamp);
  }
  function consumeCaptions(time) {
    while (captionQueue.length && captionQueue[0].timestamp <= time) {
      const triple = captionQueue.shift(), time = triple.timestamp;
      if (triple.type >= 2) { digitalCaptions.add(triple); continue; }
      const field = triple.type === 0 ? 1 : 3;
      let parser = captionParsers.get(field);
      if (!parser) {
        const output = id => ({ reset() {}, dispatchCue() {}, newCue(startTime, endTime, screen) {
          const value = screen.getDisplayText(); if (!value) return;
          appendEmbedded({ id, kind: 'captions', label: `CC${id}` }, [{ startTime, endTime, text: value }], `cea608-${id}`, `caption:${startTime}:${endTime}`);
        } });
        parser = new HlsCea608Parser(field, output(field), output(field + 1)); captionParsers.set(field, parser);
      }
      parser.addData(time, [triple.a, triple.b]);
    }
  }
  async function inspectMediaResource(url, response, options = {}) {
    if (disposed || !session || session.signal.aborted || !response.ok) return;
    const owner = generation, requestSignal = session.signal;
    // Observations never turn an oversized video segment into a subtitle/media failure.
    if (Number(response.headers?.get('Content-Length')) > 16 * 1024 * 1024) { await response.body?.cancel().catch(() => {}); return; }
    const playlist = /mpegurl/i.test(response.headers?.get('Content-Type') ?? '') || /\.m3u8(?:[?#]|$)/i.test(url);
    if (playlist) {
      const reading = (async () => {
        const bytes = await readBytes(response, PLAYLIST_BYTES, requestSignal);
        if (owner !== generation || requestSignal.aborted) return;
        const text = new TextDecoder().decode(bytes);
        if (!text.includes('#EXTINF:')) return;
        const previous = observedPlaylists.get(url);
        const parsed = parsePlaylist(text, response.url || url, previous?.segments);
        observedPlaylists.set(url, parsed); while (observedPlaylists.size > 4) observedPlaylists.delete(observedPlaylists.keys().next().value);
        for (const segment of parsed.segments) {
          resourceKeys.set(`${segment.url}:${segment.range?.offset ?? ''}`, segment);
          if (segment.init) resourceKeys.set(`${segment.init.url}:${segment.init.range?.offset ?? ''}`, segment.init);
        }
        while (resourceKeys.size > 1024) resourceKeys.delete(resourceKeys.keys().next().value);
      })();
      playlistReads.add(reading);
      try { await reading; } catch (error) { if (owner === generation && !requestSignal.aborted) tracks.dispatchEvent(Object.assign(new Event('error'), { error })); }
      finally { playlistReads.delete(reading); }
      return;
    }
    await Promise.allSettled([...playlistReads]);
    if (owner !== generation || requestSignal.aborted) return;
    const offset = /bytes (\d+)-/.exec(response.headers?.get('Content-Range') ?? '')?.[1];
    const resource = resourceKeys.get(`${url}:${offset ?? ''}`) ?? resourceKeys.get(`${url}:`);
    let data;
    try {
      data = await readBytes(response, 16 * 1024 * 1024, requestSignal, !resource?.key);
      if (data && resource?.key) data = await decryptPayload(data, resource.key, requestSignal, resource.sequence);
    } catch (error) {
      if (resource?.key && owner === generation && !requestSignal.aborted) tracks.dispatchEvent(Object.assign(new Event('error'), { error }));
      return;
    }
    if (owner !== generation || requestSignal.aborted || !data || data.length < 8) return;
    if (!['ftyp', 'styp', 'moof', 'moov', 'sidx', 'free', 'emsg'].includes(new TextDecoder().decode(data.subarray(4, 8)))) return;
    try {
      const boxes = subtitleBoxes(data);
      if (boxes.some(box => box.type === 'moov')) {
        const infos = parseSubtitleInit(data); if (infos.length) {
          observedInit.set(url, { tracks: infos, clocks: parseTrackClocks(data) }); while (observedInit.size > 4) observedInit.delete(observedInit.keys().next().value);
        }
      }
      if (!boxes.some(box => box.type === 'moof')) return;
      const init = resource?.init ? observedInit.get(resource.init.url) : [...observedInit.values()].at(-1);
      if (!init?.tracks.length) return;
      const samples = parseSubtitleFragment(data, init.tracks), groups = new Map();
      const rawStart = resource?.start !== undefined ? fragmentPresentationStart(data, init.clocks) : null;
      const offset = rawStart === null ? null : resource.start - rawStart;
      for (const sample of samples) {
        const key = `embedded-${sample.track.id}`, cues = groups.get(key) ?? { info: sample.track, cues: [] };
        const origin = Number.isFinite(options.origin) ? options.origin : observedMediaOrigin ?? 0;
        cues.origin = origin;
        cues.hlsAligned = offset !== null;
        cues.cues.push(...decodeSubtitleSample(sample.data, sample.track.codec, sample.startTime, sample.endTime)
          .map(cue => ({ ...cue, startTime: cue.startTime + (offset ?? -origin), endTime: cue.endTime + (offset ?? -origin) })));
        groups.set(key, cues);
      }
      for (const [key, group] of groups) appendEmbedded({ ...group.info, mediaOrigin: group.origin, hlsAligned: group.hlsAligned }, group.cues, key, url);
    } catch (error) {
      // A valid media resource with an unsupported subtitle remains playable.
      tracks.dispatchEvent(Object.assign(new Event('error'), { error }));
    }
  }
  function setMediaOrigin(value) {
    if (!Number.isFinite(value) || disposed) return;
    observedMediaOrigin = value;
    for (const [track, state] of states) {
      if (!track.id.startsWith('embedded-') || state.hlsAligned || state.mediaOrigin === undefined || state.mediaOrigin === value) continue;
      const delta = state.mediaOrigin - value;
      for (const [key, cues] of state.cache) state.cache.set(key, cues.map(cue => Object.freeze({ ...cue, startTime: cue.startTime + delta, endTime: cue.endTime + delta })));
      state.mediaOrigin = value; publish(track, state);
    }
  }
  function reset() {
    generation++; session?.abort(); observedMediaOrigin = undefined;
    for (const [track, state] of states) {
      state.controller?.abort(); track.cues = []; track.activeCues = []; track.dispatchEvent(new Event('cuechange'));
      state.cache.clear(); state.anchors.clear(); state.inits.clear();
    }
    states.clear(); tracks.clear(); aesKeys.clear(); observedInit.clear(); embedded.clear(); captionParsers.clear(); digitalCaptions.services.clear(); digitalCaptions.packet = []; digitalCaptions.expected = 0; digitalCaptions.sequence = null; captionQueue.length = 0; observedPlaylists.clear(); resourceKeys.clear(); playlistReads.clear();
  }
  function stop() { disposed = true; reset(); signal?.removeEventListener('abort', stop); }
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();

  return { tracks, inspectMediaResource, appendCaptionPacket: captionPacket, resetCaptionDecoder, setMediaOrigin,
    addTextTrack(kind, label = '', language = '') {
      if (disposed) throw new Error('Subtitle controller is disposed');
      if (tracks.length >= MAX_TRACKS) throw new Error('Too many subtitle tracks');
      const track = addTrack({ id: `subtitle-${tracks.length}`, kind, label, language }, '', true);
      const state = states.get(track), cues = new Map(); state.manual = true;
      track.addCue = cue => {
        if (!states.has(track)) return;
        if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime) || cue.endTime <= cue.startTime) throw new Error('Invalid subtitle cue timing');
        if (cues.size >= MAX_CUES && !cues.has(cue)) throw new Error('Too many subtitle cues');
        cues.set(cue, plainCue(cue)); state.cache.set('manual', [...cues.values()]); publish(track, state);
      };
      track.removeCue = cue => {
        cues.delete(cue); state.cache.set('manual', [...cues.values()]); publish(track, state);
      };
      track.mode = 'hidden'; return track;
    },
    async load(src, type = '', options = {}) {
      reset();
      if (disposed || signal?.aborted) return;
      session = new AbortController(); timestampOrigin = options.timestampOrigin; currentTime = 0;
      const owner = generation, base = new URL(src, globalThis.location?.href).href;
      if (/vtt/i.test(type) || /\.vtt(?:[?#]|$)/i.test(base)) {
        const track = addTrack({ id: 'subtitle-0', kind: 'subtitles', label: options.label ?? 'Subtitles', language: options.language ?? '' }, base, true);
        track.mode = 'showing'; return;
      }
      if (!/mpegurl|m3u8/i.test(type) && !/\.m3u8(?:[?#]|$)/i.test(base)) {
        if (/mp4|quicktime/i.test(type) || /\.(?:mp4|m4v|mov)(?:[?#]|$)/i.test(base)) {
          await discoverMp4(base, session.signal, options.mediaOrigin);
        }
        return;
      }
      const { text, url: playlistUrl } = await request(base, PLAYLIST_BYTES, session.signal);
      if (owner !== generation || session.signal.aborted) return;
      let selected = false;
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('#EXT-X-MEDIA:')) continue;
        const media = attributes(line.slice(13));
        if (media.TYPE !== 'SUBTITLES' || !media.URI || tracks.length >= MAX_TRACKS) continue;
        const url = resolveSubtitleUrl(media.URI, playlistUrl);
        if ([...states.values()].some(state => state.url === url)) continue;
        const kind = media.CHARACTERISTICS?.includes('public.accessibility.transcribes-spoken-dialog') ? 'captions' : 'subtitles';
        const track = addTrack({ id: `subtitle-${tracks.length}`, kind, label: media.NAME ?? media.LANGUAGE ?? 'Subtitles', language: media.LANGUAGE ?? '' }, url);
        track.forced = media.FORCED === 'YES';
        if (!selected && (media.DEFAULT === 'YES' || track.forced)) { selected = true; track.mode = 'showing'; }
        else { const state = states.get(track); state.probing = true; schedule(track, state); }
      }
    },
    update(time) {
      if (disposed || !Number.isFinite(time)) return;
      const nextTime = Math.max(0, time);
      if (nextTime < currentTime - .5 || nextTime > currentTime + 5) {
        for (const parser of captionParsers.values()) parser.reset();
        digitalCaptions.services.clear(); digitalCaptions.packet = []; digitalCaptions.expected = 0; digitalCaptions.sequence = null;
        for (const [track, state] of states) if (/^cea/.test(track.id)) { state.openCaption = null; state.cache.delete('open'); state.cache.delete('live'); publish(track, state); }
        while (captionQueue.length && captionQueue[0].timestamp < nextTime) captionQueue.shift();
      }
      currentTime = nextTime; consumeCaptions(currentTime);
      for (const [field, parser] of captionParsers) {
        parser.cueSplitAtTime(currentTime);
        for (let channel = 1; channel <= 2; channel++) {
          const value = parser.channels[channel]?.displayedMemory?.getDisplayText() ?? '', id = field + channel - 1;
          const existing = embedded.get(`cea608-${id}`);
          if (value) appendEmbedded({ id, kind: 'captions', label: `CC${id}` }, [{ startTime: currentTime, endTime: Number.MAX_VALUE, text: value }], `cea608-${id}`, 'live');
          else if (existing) { const state = states.get(existing); if (state.cache.delete('live')) publish(existing, state); }
        }
      }
      for (const [track, state] of states) {
        active(track);
        // A remote seek must not wait behind a slow fetch for the old playback window.
        if (state.busy && Math.abs(currentTime - state.workTime) > Math.max(2, (state.playlist?.targetDuration ?? 5) * 2)) state.controller?.abort();
        schedule(track, state);
      }
    },
    clear: reset,
    dispose: stop,
  };
}
