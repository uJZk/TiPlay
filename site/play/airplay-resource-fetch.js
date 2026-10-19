// SPDX-License-Identifier: GPL-3.0-only
const UNIT_BYTES = 256 * 1024;
const PLAYLIST_BYTES = 2 * 1024 * 1024;
const RETAINED_READERS = 4;
const RETAINED_BYTES = 4 * 1024 * 1024;
const abortError = () => new DOMException('Media resource canceled.', 'AbortError');
const check = signal => { if (signal.aborted) throw signal.reason || abortError(); };
const length = value => /^(0|[1-9][0-9]*)$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const range = value => {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) throw new TypeError('Unsupported media byte range.');
  const start = match[1] ? length(match[1]) : null, end = match[2] ? length(match[2]) : null;
  if (match[1] && start === null || match[2] && end === null || start !== null && end !== null && end < start || start === null && !end)
    throw new TypeError('Invalid media byte range.');
  return { start, end };
};
function interruptible(promise, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function responseLike(response, bytes, { status = response.status, headers = new Headers(response.headers) } = {}) {
  const result = new Response(bytes, { status, statusText: status === response.status ? response.statusText : '', headers });
  Object.defineProperties(result, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
  return result;
}

/**
 * Network reads are serialized across a player's engine and captions. Responses exposed
 * to the demuxer are virtual streams: each pull obtains a finite network unit. A small,
 * byte-bounded reader pool lets interleaved audio/video retain their own sequential body
 * when Range is ignored. Seeking backwards, eviction and cancellation retire that body.
 * Only one unit per consumer and bounded pending network chunks are buffered, never the file.
 */
export function createSerialMediaFetch(fetcher, { signal: parentSignal, deadline = 15000,
  unitBytes = UNIT_BYTES, playlistBytes = PLAYLIST_BYTES, busyRetries = 1,
  maxRetainedReaders = RETAINED_READERS, maxRetainedBytes = RETAINED_BYTES } = {}) {
  if (!Number.isSafeInteger(unitBytes) || unitBytes < 1 || !Number.isSafeInteger(playlistBytes) || playlistBytes < unitBytes ||
      !Number.isFinite(deadline) || deadline <= 0 || !Number.isInteger(busyRetries) || busyRetries < 0 || busyRetries > 2 ||
      !Number.isSafeInteger(maxRetainedReaders) || maxRetainedReaders < 1 || maxRetainedReaders > 4 ||
      !Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 1 || maxRetainedBytes > RETAINED_BYTES)
    throw new TypeError('Invalid media resource limits.');
  let tail = Promise.resolve(), retirement = Promise.resolve(), disposed = false, queued = 0;
  const sequential = new Map();
  const controllers = new Set(), playlists = new Set();
  const remember = url => {
    if (!url) return;
    playlists.delete(url); playlists.add(url);
    if (playlists.size > 256) playlists.delete(playlists.values().next().value);
  };
  const learnPlaylist = (bytes, base, original) => {
    remember(base); remember(original);
    let variant = false;
    for (const raw of new TextDecoder().decode(bytes).split(/\r?\n/)) {
      const line = raw.trim();
      let child;
      if (line.startsWith('#EXT-X-STREAM-INF:')) variant = true;
      else if (line && !line.startsWith('#')) { if (variant) child = line; variant = false; }
      else if (/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line)) child = /(?:[:,])URI="([^"]+)"/.exec(line)?.[1];
      if (child) { try { remember(new URL(child, base || original).href); } catch (_) {} }
    }
  };
  const schedule = (task, signal) => {
    check(signal);
    if (queued >= 64) return Promise.reject(new Error('Too many pending media resources.'));
    queued++;
    const result = tail.then(() => { check(signal); return task(); }).finally(() => { queued--; });
    tail = result.catch(() => {});
    return interruptible(result, signal);
  };
  const sequentialKey = (url, init) => {
    const headers = new Headers(init.headers); headers.delete('Range');
    return JSON.stringify([url instanceof Request ? url.url : String(url), [...headers],
      init.credentials, init.mode, init.redirect]);
  };
  function retireSequential(entry) {
    if (!entry) return retirement;
    if (sequential.get(entry.key) === entry) sequential.delete(entry.key);
    clearTimeout(entry.idleTimer); entry.controller.abort();
    entry.pending = null; entry.pendingBytes = 0;
    entry.closing ||= entry.reader.cancel().catch(() => {});
    retirement = Promise.all([retirement, entry.closing]).then(() => {});
    return retirement;
  }
  function retireAll() {
    for (const entry of sequential.values()) void retireSequential(entry);
    return retirement;
  }
  function touch(entry) { sequential.delete(entry.key); sequential.set(entry.key, entry); }
  async function retainPending(entry, value) {
    check(entry.controller.signal);
    if (value.byteLength > maxRetainedBytes) throw new Error('The media network chunk exceeds the retained memory limit.');
    const pendingBytes = () => [...sequential.values()].reduce((bytes, other) => bytes + (other === entry ? 0 : other.pendingBytes), 0);
    while (pendingBytes() + value.byteLength > maxRetainedBytes) {
      const oldest = [...sequential.values()].find(other => other !== entry);
      if (!oldest) break;
      await retireSequential(oldest);
    }
    check(entry.controller.signal);
    // Do not retain an arbitrarily large backing buffer behind a small view.
    entry.pending = new Uint8Array(value); entry.pendingBytes = value.byteLength;
  }
  async function readSequential(entry, requested, cursor, signal) {
    clearTimeout(entry.idleTimer); entry.owner = signal; touch(entry);
    const abort = () => entry.controller.abort(signal.reason || abortError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => entry.controller.abort(new DOMException('Media resource timed out.', 'TimeoutError')), deadline);
    try {
      check(signal); check(entry.controller.signal);
      if (entry.pending && !entry.pendingBytes) await retainPending(entry, entry.pending);
      const start = cursor === null ? entry.total !== null && requested?.start === null
        ? Math.max(0, entry.total - requested.end) : 0 : cursor;
      if (requested && entry.total !== null && start >= entry.total) {
        await retireSequential(entry);
        return { error: responseLike(entry.response, null, { status: 416,
          headers: new Headers({ 'Content-Range': `bytes */${entry.total}` }) }) };
      }
      const end = Math.min(start + unitBytes, entry.total ?? Infinity,
        requested?.start !== null && requested?.end !== null && requested ? requested.end + 1 : Infinity);
      const buffer = new Uint8Array(Math.max(0, end - start));
      let size = 0;
      while (entry.next < end && !entry.eof) {
        if (!entry.pending?.length) {
          entry.pending = null; entry.pendingBytes = 0;
          const item = await entry.nextBody();
          check(entry.controller.signal);
          if (item.done) { entry.eof = true; break; }
          await retainPending(entry, item.value);
        }
        const skip = Math.min(Math.max(0, start - entry.next), entry.pending.length);
        entry.next += skip; entry.pending = entry.pending.subarray(skip);
        const count = Math.min(entry.pending.length, buffer.length - size);
        if (count) {
          buffer.set(entry.pending.subarray(0, count), size); size += count;
          entry.next += count; entry.pending = entry.pending.subarray(count);
        }
      }
      if (entry.next < start) throw new Error('Media ended before the requested byte.');
      if (entry.eof && entry.total !== null && entry.next < end) throw new Error('Incomplete media resource response.');
      const eof = entry.eof || entry.total !== null && entry.next >= entry.total;
      if (eof) await retireSequential(entry);
      return { response: entry.response, bytes: buffer.subarray(0, size), start, next: start + size,
        total: entry.total, eof, sequential: entry.total === null, forceWhole: entry.forceWhole };
    } catch (error) {
      await retireSequential(entry); throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (!entry.pending?.length) { entry.pending = null; entry.pendingBytes = 0; }
      // An abandoned logical response must not retain an idle HTTP body indefinitely.
      if (sequential.get(entry.key) === entry) entry.idleTimer = setTimeout(() => { void retireSequential(entry); }, Math.min(deadline, 5000));
    }
  }

  async function load(url, init, requested, cursor, knownPlaylist, signal, forceWhole = false) {
    return schedule(async () => {
      const key = sequentialKey(url, init);
      const retained = sequential.get(key);
      if (!knownPlaylist && retained && !retained.controller.signal.aborted &&
          (retained.total !== null || forceWhole) &&
          cursor !== null && cursor >= retained.next) return readSequential(retained, requested, cursor, signal);
      // Another logical range on the same resource must keep its own honest byte coordinates.
      if (retained) await retireSequential(retained);
      while (sequential.size >= maxRetainedReaders) await retireSequential(sequential.values().next().value);
      await retirement;
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason || abortError());
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new DOMException('Media resource timed out.', 'TimeoutError')), deadline);
      let reader;
      try {
        for (let attempt = 0; ; attempt++) {
          check(signal);
          const headers = new Headers(init.headers);
          if (knownPlaylist || forceWhole) headers.delete('Range');
          else if (requested?.start === null && cursor === null) headers.set('Range', `bytes=-${requested.end}`);
          else if (requested || cursor > 0) {
            const end = Math.min(cursor + unitBytes - 1, requested?.end ?? Infinity);
            headers.set('Range', `bytes=${cursor}-${end}`);
          }
          const response = await interruptible(Promise.resolve(fetcher(url, { ...init, headers, signal: controller.signal,
            cache: 'no-store', referrerPolicy: 'no-referrer' })), controller.signal);
          if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            if ([502, 503, 504].includes(response.status) && attempt < busyRetries) {
              await interruptible(new Promise(resolve => setTimeout(resolve, 100)), controller.signal);
              continue;
            }
            const clean = new Headers(response.headers); clean.delete('Content-Encoding'); clean.set('Content-Length', '0');
            return { error: responseLike(response, null, { headers: clean }) };
          }
          if (!response.body) return { error: responseLike(response, null) };
          reader = response.body.getReader();
          // A transport chunk may contain only '#E'. Inspect a bounded prefix rather
          // than assuming one read contains the playlist signature.
          const prefetched = []; let prefixSize = 0, prefixEnded = false;
          while (prefixSize < 10) {
            const item = await interruptible(reader.read(), controller.signal);
            if (item.done) { prefixEnded = true; break; }
            prefetched.push(item.value); prefixSize += item.value.length;
          }
          const prefix = new Uint8Array(Math.min(10, prefixSize)); let prefixOffset = 0, prefetchedIndex = 0;
          for (const chunk of prefetched) {
            const part = chunk.subarray(0, prefix.length - prefixOffset); prefix.set(part, prefixOffset); prefixOffset += part.length;
            if (prefixOffset === prefix.length) break;
          }
          const nextBody = () => {
            if (prefetchedIndex < prefetched.length) {
              const value = prefetched[prefetchedIndex]; prefetched[prefetchedIndex++] = null;
              return Promise.resolve({ done: false, value });
            }
            return prefixEnded ? Promise.resolve({ done: true }) : interruptible(reader.read(), controller.signal);
          };
          const first = await nextBody();
          const sniff = new TextDecoder().decode(prefix).replace(/^\uFEFF/, '').startsWith('#EXTM3U');
          const isPlaylist = knownPlaylist || sniff || /mpegurl/i.test(response.headers.get('Content-Type') || '');
          const partialHeader = response.headers.get('Content-Range');
          const partial = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(partialHeader || '');
          const partialStart = partial ? length(partial[1]) : null, partialEnd = partial ? length(partial[2]) : null;
          const partialTotal = partial && partial[3] !== '*' ? length(partial[3]) : null;
          const validPartial = partial && partialStart !== null && partialEnd !== null && partialEnd >= partialStart &&
            (partial[3] === '*' || partialTotal !== null && partialEnd < partialTotal);
          if (response.status === 206 && partialHeader !== null && !validPartial) throw new Error('Invalid media range response.');
          const encoded = response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding') !== 'identity';
          const total = !encoded ? (response.status === 206 ? partial && partial[3] !== '*' ? length(partial[3]) : null : length(response.headers.get('Content-Length'))) : null;
          if (isPlaylist) {
            // A verified master declares its child playlist URIs; MAP/BYTERANGE/media
            // URIs are deliberately not marked. App-owned playlist loaders can reject
            // Range even though their complete representation is available.
            remember(String(url)); remember(response.url);
            if (response.status === 206 && (!partial || Number(partial[1]) !== 0 || total === null || Number(partial[2]) + 1 !== total)) {
              await reader.cancel(); reader = null;
              if (knownPlaylist) throw new Error('Incomplete media playlist response.');
              knownPlaylist = true;
              continue;
            }
            const chunks = []; let size = 0, item = first;
            while (!item.done) {
              size += item.value.byteLength;
              if (size > playlistBytes) throw new Error('Playlist too large.');
              chunks.push(item.value);
              item = await nextBody();
            }
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            learnPlaylist(bytes, response.url || String(url), String(url));
            const clean = new Headers(response.headers); clean.delete('Content-Range'); clean.delete('Content-Encoding');
            clean.set('Content-Length', String(size)); clean.set('Content-Type', 'application/vnd.apple.mpegurl');
            return { playlist: responseLike(response, bytes, { status: 200, headers: clean }) };
          }
          if (response.status === 206 && (!partial || encoded || total === null)) {
            await reader.cancel(); reader = null;
            if (forceWhole) throw new Error('Invalid media range response.');
            // Do not invent a total length or expose a truncated unit as EOF. Ask
            // for a complete sequential representation if Range metadata is unusable.
            forceWhole = true; cursor = 0;
            continue;
          }
          const base = response.status === 206 ? Number(partial[1]) : 0;
          const start = cursor === null ? total !== null && requested?.start === null ? Math.max(0, total - requested.end) : base : cursor;
          if (requested && total !== null && start >= total)
            return { error: responseLike(response, null, { status: 416, headers: new Headers({ 'Content-Range': `bytes */${total}` }) }) };
          if (response.status !== 206) {
            const entry = { key, response, reader, controller, nextBody, pending: first.done ? null : first.value,
              pendingBytes: 0, eof: first.done, total, next: 0, owner: signal, idleTimer: null,
              forceWhole: forceWhole || encoded || total === null };
            sequential.set(key, entry);
            // An unknown-length 200 retains its honest whole-response contract even if Range was requested.
            return await readSequential(entry, total === null ? null : requested,
              total === null && !forceWhole ? 0 : start, signal);
          }
          const wanted = start;
          if (base > wanted) throw new Error('Media range starts after the requested byte.');
          if (response.status === 206 && partialEnd < wanted) throw new Error('Media range ends before the requested byte.');
          const end = Math.min(wanted + unitBytes, requested && requested.end !== null && requested.start !== null ? requested.end + 1 : Infinity,
            total ?? Infinity);
          let skip = wanted - base, size = 0, eof = first.done, item = first;
          const buffer = new Uint8Array(Math.max(0, end - wanted));
          while (!item.done && size < buffer.length) {
            const discarded = Math.min(skip, item.value.length); skip -= discarded;
            const available = item.value.subarray(discarded), count = Math.min(available.length, buffer.length - size);
            buffer.set(available.subarray(0, count), size); size += count;
            if (size < buffer.length) { item = await nextBody(); eof = item.done; }
          }
          if (skip) throw new Error('Media ended before the requested byte.');
          if (!size && !eof && end > wanted) throw new Error('Empty media resource unit.');
          const expectedEnd = Math.min(end, response.status === 206 ? Number(partial[2]) + 1 : total ?? Infinity);
          if (eof && (response.status === 206 || total !== null) && wanted + size < expectedEnd) throw new Error('Incomplete media resource response.');
          const bytes = buffer.subarray(0, size);
          return { response, bytes, start: wanted, next: wanted + size, total, eof: total === null ? eof : wanted + size >= total,
            sequential: false, forceWhole: forceWhole || encoded };
        }
      } finally {
        // Retained readers pause between units. Retired readers finish cancellation before
        // another task can use their slot; each actual read still runs through schedule().
        if (sequential.get(key)?.controller !== controller) {
          controller.abort();
          if (reader) await reader.cancel().catch(() => {});
        }
        clearTimeout(timer); signal.removeEventListener('abort', abort);
      }
    }, signal);
  }

  const serialFetch = async (url, init = {}) => {
    if (disposed) throw abortError();
    const requestSignal = init.signal === undefined ? (url instanceof Request ? url.signal : undefined) : init.signal;
    const controller = new AbortController(), parents = [...new Set([parentSignal, requestSignal].filter(Boolean))];
    controllers.add(controller);
    const abort = event => controller.abort(event?.target?.reason || abortError());
    for (const parent of parents) {
      if (parent.aborted) abort({ target: parent });
      else parent.addEventListener('abort', abort, { once: true });
    }
    const cleanup = () => { controllers.delete(controller); for (const parent of parents) parent.removeEventListener('abort', abort); };
    try {
      check(controller.signal);
      const headers = new Headers(url instanceof Request ? url.headers : undefined);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      if ((init.method || (url instanceof Request ? url.method : 'GET')).toUpperCase() !== 'GET') throw new TypeError('Media resources require GET.');
      let requested = range(headers.get('Range'));
      init = { ...init, headers };
      const original = url instanceof Request ? url.url : String(url);
      let cursor = requested?.start ?? (requested ? null : 0);
      let unit = await load(url, init, requested, cursor, playlists.has(original), controller.signal);
      if (unit.error || unit.playlist) { cleanup(); return unit.error || unit.playlist; }
      const initial = unit, total = unit.total;
      if (unit.sequential) requested = null;
      if (requested && total !== null && unit.start >= total) {
        cleanup();
        return responseLike(initial.response, null, { status: 416, headers: new Headers({ 'Content-Range': `bytes */${total}` }) });
      }
      if (requested?.start === null) requested = { start: unit.start, end: total === null ? null : total - 1 };
      cursor = unit.start;
      let buffered = unit, closed = false, streamController;
      const end = requested?.start === null ? total : Math.min(total ?? Infinity, requested?.end !== null && requested ? requested.end + 1 : Infinity);
      const finish = () => { if (closed) return; closed = true; cleanup(); controller.signal.removeEventListener('abort', onAbort); };
      const onAbort = () => { for (const entry of sequential.values()) if (entry.owner === controller.signal) void retireSequential(entry);
        try { streamController?.error(controller.signal.reason || abortError()); } catch (_) {} finish(); };
      const body = new ReadableStream({
        start(stream) { streamController = stream; controller.signal.addEventListener('abort', onAbort, { once: true }); },
        async pull(stream) {
          try {
            check(controller.signal);
            if (cursor >= end || !buffered && unit.eof) { finish(); stream.close(); return; }
            if (!buffered) {
              unit = await load(url, init, requested, cursor, false, controller.signal, unit.forceWhole);
              if (unit.error) throw new Error(`Media resource failed: ${unit.error.status}.`);
              if (unit.playlist) throw new Error('Media resource changed into a playlist.');
            } else { unit = buffered; buffered = null; }
            cursor = unit.next;
            if (unit.bytes.length) stream.enqueue(unit.bytes);
            if (!unit.bytes.length || unit.eof || cursor >= end) { finish(); stream.close(); }
          } catch (error) { finish(); stream.error(error); }
        },
        cancel(reason) { controller.abort(reason || abortError()); finish(); },
      }, { highWaterMark: 0 });
      const clean = new Headers(initial.response.headers);
      clean.delete('Content-Range'); clean.delete('Content-Length'); clean.delete('Content-Encoding');
      const status = requested && !unit.sequential ? 206 : 200;
      if (total !== null) {
        clean.set('Content-Length', String(Math.max(0, end - cursor)));
        if (status === 206) clean.set('Content-Range', `bytes ${cursor}-${end - 1}/${total}`);
      }
      return responseLike(initial.response, body, { status, headers: clean });
    } catch (error) { cleanup(); throw error; }
  };
  serialFetch.dispose = (reason = abortError()) => {
    disposed = true;
    void retireAll();
    for (const controller of controllers) controller.abort(reason);
    controllers.clear(); playlists.clear();
  };
  return serialFetch;
}
