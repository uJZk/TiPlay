// SPDX-License-Identifier: GPL-3.0-only
import { HlsWebVTTParser, HlsVTTParser, HlsVTTTimestamp } from './vendor/mediabunny/mediabunny.min.js';

const MAX_TRACKS = 8, MAX_SEGMENTS = 10000, MAX_CACHED_SEGMENTS = 6, MAX_CUES = 4000;
const PLAYLIST_BYTES = 2 * 1024 * 1024, VTT_BYTES = 512 * 1024;
const abortError = () => new DOMException('Subtitle request cancelled', 'AbortError');
const segmentKey = segment => `${segment.sequence}:${segment.url}:${segment.range?.offset ?? ''}`;

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
  let targetDuration = 6, endList = false, unsupported = false, rangeUrl = null;
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
    } else if (line.startsWith('#EXT-X-KEY:') && attributes(line.slice(11)).METHOD !== 'NONE') unsupported = true;
    else if (line.startsWith('#EXT-X-MAP:')) unsupported = true; // Fragmented MP4 subtitle payloads need a demuxer.
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
      const segment = { sequence: sequence++, cc, start, end: start + duration, url: resource, range };
      if (!discontinuities.get(cc).segment) discontinuities.get(cc).segment = segment;
      segments.push(segment); start += duration; duration = null; range = null;
      if (segments.length > MAX_SEGMENTS) throw new Error('Subtitle playlist is too large');
    }
  }
  return { segments, discontinuities, targetDuration, endList, unsupported };
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

async function readText(response, limit, signal) {
  if (signal.aborted || !response.ok || Number(response.headers?.get('Content-Length')) > limit) {
    await response.body?.cancel().catch(() => {});
    if (signal.aborted) throw abortError();
    if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
    throw new Error('Subtitle response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.arrayBuffer();
    if (signal.aborted) throw abortError();
    if (data.byteLength > limit) throw new Error('Subtitle response is too large');
    return new TextDecoder().decode(data);
  }
  let size = 0, result = '';
  const decoder = new TextDecoder();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Subtitle response is too large');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** HLS WebVTT uses hls.js's maintained parser, while cue activation follows TiPlay's media clock. */
export function createMediaTextTracks({ fetchResource = fetch, signal } = {}) {
  const tracks = new TrackList(), states = new Map(), queue = [];
  let session = null, generation = 0, disposed = false, currentTime = 0, requests = 0;
  let timestampOrigin;

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
          return { text: await readText(response, limit, timeout.signal), url: response.url || url };
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
    const unique = new Map();
    for (const cues of state.cache.values()) for (const cue of cues) {
      unique.set(`${cue.startTime}:${cue.endTime}:${cue.text}`, cue);
    }
    track.cues = [...unique.values()].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
    active(track);
  }
  function report(track, error) {
    track.error = error;
    tracks.dispatchEvent(Object.assign(trackEvent('error', track), { error }));
  }
  function addTrack(info, url, standalone = false) {
    const track = Object.assign(new EventTarget(), info, { cues: [], activeCues: [], error: null });
    const state = { url, standalone, cache: new Map(), anchors: new Map(), playlist: null, refreshed: 0, errorUntil: 0, busy: false, controller: null, mode: 'disabled' };
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
  async function segmentCues(segment, state, requestSignal) {
    const key = segmentKey(segment);
    if (state.cache.has(key)) {
      const cues = state.cache.get(key); state.cache.delete(key); state.cache.set(key, cues); return;
    }
    let anchor = state.anchors.get(segment.cc);
    if (!anchor) {
      const first = state.playlist.discontinuities.get(segment.cc).segment;
      const { text } = await request(first.url, VTT_BYTES, requestSignal, first.range), map = timestampMap(text);
      anchor = { start: first.start, origin: map ? { baseTime: map.mpegts - first.start * 90000, timescale: 90000 } : undefined };
      state.anchors.set(segment.cc, anchor);
      if (state.anchors.size > 64) state.anchors.delete(state.anchors.keys().next().value);
      if (first.sequence === segment.sequence) {
        state.cache.set(key, parseCues(text, segment, anchor, originFor(segment.cc)));
        return;
      }
    }
    const { text } = await request(segment.url, VTT_BYTES, requestSignal, segment.range);
    state.cache.set(key, parseCues(text, segment, anchor, originFor(segment.cc)));
  }
  function originFor(cc) { return typeof timestampOrigin === 'function' ? timestampOrigin(cc) : timestampOrigin; }
  function schedule(track, state) {
    if (disposed || state.manual || !session || signal?.aborted || session.signal.aborted || state.busy || track.mode === 'disabled' || Date.now() < state.errorUntil) return;
    if (state.standalone && state.cache.size) return;
    if (state.playlist && (state.playlist.endList || Date.now() - state.refreshed < Math.max(2000, state.playlist.targetDuration * 500))) {
      const index = state.playlist.segments.findIndex(segment => segment.start <= currentTime && currentTime < segment.end);
      if (index < 0 || state.playlist.segments.slice(Math.max(0, index - 1), index + 2).every(segment => state.cache.has(segmentKey(segment)))) return;
    }
    const owner = generation, ownerSession = session, time = currentTime, controller = new AbortController();
    const cancel = () => controller.abort();
    ownerSession.signal.addEventListener('abort', cancel, { once: true });
    state.busy = true; state.controller = controller; state.workTime = time;
    (async () => {
      if (state.standalone) {
        const { text } = await request(state.url, VTT_BYTES, controller.signal);
        state.cache.set('standalone', parseCues(text));
      } else {
        if (!state.playlist || !state.playlist.endList && Date.now() - state.refreshed >= Math.max(2000, state.playlist.targetDuration * 500)) {
          const { text, url } = await request(state.url, PLAYLIST_BYTES, controller.signal);
          state.url = url;
          state.playlist = parsePlaylist(text, url, state.playlist?.segments);
          state.refreshed = Date.now();
        }
        if (state.playlist.unsupported) throw new Error('Encrypted or fragmented MP4 subtitles are unsupported');
        const index = state.playlist.segments.findIndex(segment => segment.start <= time && time < segment.end);
        if (index >= 0) {
          for (const segment of state.playlist.segments.slice(Math.max(0, index - 1), index + 2)) {
            await segmentCues(segment, state, controller.signal);
          }
        }
        while (state.cache.size > MAX_CACHED_SEGMENTS) state.cache.delete(state.cache.keys().next().value);
      }
      if (owner === generation && !controller.signal.aborted && states.has(track)) { track.error = null; publish(track, state); }
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
  function reset() {
    generation++; session?.abort();
    for (const [track, state] of states) {
      state.controller?.abort(); track.cues = []; track.activeCues = []; track.dispatchEvent(new Event('cuechange'));
      state.cache.clear(); state.anchors.clear();
    }
    states.clear(); tracks.clear();
  }
  function stop() { disposed = true; reset(); signal?.removeEventListener('abort', stop); }
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();

  return { tracks,
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
      if (!/mpegurl|m3u8/i.test(type) && !/\.m3u8(?:[?#]|$)/i.test(base)) return;
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
        if (!selected && media.DEFAULT === 'YES') { selected = true; track.mode = 'showing'; }
      }
    },
    update(time) {
      if (disposed || !Number.isFinite(time)) return;
      currentTime = Math.max(0, time);
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
