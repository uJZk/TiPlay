// SPDX-License-Identifier: GPL-3.0-only
// Synthetic phone source with real H.264 RTP video and reliable control/metadata DataChannels.
// Retained direct HTTP record/control routes are used only by compatibility/resource tests.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { installSrpFixture } from './srp-fixture.mjs';
import { installFakeRtpSource } from './fake-rtp-source.mjs';
import { RTC_VIDEO_TRANSPORT } from '../../site/play/rtc-video.js';
import { History, listen, closeServer } from './resources.mjs';
import { RECORD, FLAG, encodeRecord } from '../../site/play/link.js';
import { RTC_TRANSPORT, RTC_MAGIC, RTC_HEADER_BYTES, RTC_FRAGMENT_BYTES } from '../../site/play/webrtc-transport.js';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Reads an IVF file into `{key, data}` frames. VP8 clears bit 0 of the first byte on a key frame; VP9 (profile 0,
 * no superframes) clears its frame_type bit, bit 2.
 */
export function parseIvf(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'DKIF') throw new Error('not an IVF file');
  const keyBit = { VP80: 0x01, VP90: 0x04 }[buffer.toString('latin1', 8, 12)];
  if (!keyBit) throw new Error('only VP8 and VP9 IVF files are supported');
  const frames = [];
  for (let offset = buffer.readUInt16LE(6); offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset);
    const data = new Uint8Array(buffer.subarray(offset + 12, offset + 12 + size));
    frames.push({ key: (data[0] & keyBit) === 0, data });
    offset += 12 + size;
  }
  return frames;
}

/**
 * Starts the fake phone. Native RTC uses a browser Canvas source; direct HTTP compatibility uses `frames`.
 * HTTP or DataChannel controls land in `events` as `{s, q, event}`.
 * rtcPage must be a separate real browser page on a secure test origin.
 */
export function startFakePhone({ code, frames, width, height, fps = 30, codec, host = '127.0.0.1', rtcPage = null, moduleBase = '/' }) {
  codec ??= rtcPage ? 'avc1.42e01f' : 'vp8';
  if (rtcPage && !/^avc1\.[0-9a-f]{6}$/i.test(codec)) throw Error('Synthetic native RTP requires an H.264 source codec.');
  let source = { mode: 'carplay', codec, width, height, fps, epoch: 1 };
  let closed = false;
  const retirements = new Set();
  const rtpStats = { framesEncoded: 0, sourcePaints: 0, metadataRecords: 0, compressedRecords: 0,
    videoGeneration: 1, renegotiations: 0, captureActive: false, readyGeneration: 1, controlState: 'connecting' };
  let portalRevision = 0;
  const events = new History(), requests = new History(), preflights = new History(), bridgeErrors = new History();
  const peerError = error => bridgeErrors.push(error.message);
  rtcPage?.on('pageerror', peerError);
  let current = null, lastSeen = 0, video = null, fit = false, viewport = null, videoCount = 0, corrupt = false, framesWritten = 0;
  const replaced = new Set(), lastQ = new Map();
  let rtcEpoch = 0, resourceToken = null;
  const config = new TextEncoder().encode(JSON.stringify({ mode: 'carplay', codec, width, height, fps, format: 'annexb', marker: 'none' }));

  function closeVideo(reason) {
    if (!video) return;
    const { res, timer, drain } = video;
    const previous = video;
    video = null;
    clearInterval(timer);
    if (previous.rtcEpoch) {
      const retirement = rtcPage.evaluate(epoch => {
        if (globalThis.__fakeRtc?.epoch === epoch) globalThis.__fakeRtc.dispose();
        if (globalThis.__fakeRtcRequest?.epoch === epoch) globalThis.__fakeRtcRequest = null;
      }, previous.rtcEpoch).catch(() => {});
      retirements.add(retirement); retirement.finally(() => retirements.delete(retirement));
      rtpStats.captureActive = false;
      return;
    }
    res.off('drain', drain);
    if (reason && !res.writableNeedDrain) res.end(encodeRecord({ kind: RECORD.END, payload: new TextEncoder().encode(reason) }));
    else res.socket?.destroy();
  }

  /** Latest session wins; a replaced session gets 409 from then on. */
  function authorize(res, c, s, keepVideo = false) {
    if (c !== code) return json(res, 401, { error: 'code' }), false;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(s ?? '')) return json(res, 400, { error: 'bad-request' }), false;
    if (replaced.has(s)) return json(res, 409, { error: 'replaced' }), false;
    if (!lastQ.has(s)) {
      if (lastQ.size >= 1024) return json(res, 503, { error: 'session-limit' }), false;
      lastQ.set(s, 0);
    }
    if (current !== s) {
      if (current && (video || Date.now() - lastSeen < 6000)) {
        if (replaced.size >= 1024) return json(res, 503, { error: 'session-limit' }), false;
        replaced.add(current);
      }
      if (!keepVideo) closeVideo('replaced');
      current = s;
    }
    lastSeen = Date.now();
    return true;
  }

  function streamVideo(res, timing = false) {
    closeVideo('replaced');
    videoCount++;
    // Close-delimited body: no Content-Length and no Transfer-Encoding.
    res.useChunkedEncodingByDefault = false;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', Connection: 'close' });
    res.socket.setNoDelay(true);
    let blocked = !res.write(encodeRecord({ kind: RECORD.CONFIG, epoch: 1, payload: config }));
    let sequence = 0, cursor = 0;
    const stream = {
      res,
      drain: () => { blocked = false; },
      get blocked() { return blocked; },
      restart: () => { cursor = 0; },
      timer: setInterval(() => {
        if (blocked || res.destroyed) return;
        const frame = corrupt ? { key: true, data: new Uint8Array(2000).fill(0x5a) } : frames[cursor++ % frames.length];
        corrupt = false;
        if (timing) {
          const payload = new Uint8Array(8);
          new DataView(payload.buffer).setFloat64(0, performance.now() - 50, true);
          res.write(encodeRecord({ kind: RECORD.TIMING, epoch: 1, sequence,
            timestampUs: Math.round(sequence * 1e6 / fps), payload }));
        }
        blocked = !res.write(encodeRecord({
          kind: RECORD.FRAME, flags: frame.key ? FLAG.KEY : 0, epoch: 1,
          sequence, timestampUs: Math.round(sequence * 1e6 / fps), payload: frame.data,
        }));
        sequence++;
        framesWritten++;
      }, 1000 / fps),
    };
    video = stream;
    res.on('drain', stream.drain);
    res.on('close', () => {
      if (video !== stream) return;
      clearInterval(stream.timer);
      res.off('drain', stream.drain);
      video = null;
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024) reject(new Error('body too large'));
        else chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function status(q) {
    return {
      q, clockMs: performance.now(), state: 'streaming', codec, display: { w: source.width, h: source.height }, viewport, fit, touch: 'ok', portalRevision,
      ...(rtcPage ? { videoTransport: RTC_VIDEO_TRANSPORT, videoGeneration: rtpStats.videoGeneration } : {}),
      phone: { fake: 1, videoStreams: videoCount },
    };
  }

  function applyControl(body) {
    if (body.q > (lastQ.get(body.s) ?? 0)) {
      lastQ.set(body.s, body.q);
      for (const event of body.e) {
        events.push({ s: body.s, q: body.q, event });
        if (event.k === 'vp') viewport = { w: event.w, h: event.h };
        if (event.k === 'kf') video?.restart();
      }
    }
    return status(lastQ.get(body.s));
  }

  /** The remote endpoint sends real H.264 RTP; the DataChannel carries CONFIG metadata only. */
  async function streamRtc(sdp) {
    if (closed) throw Error('Synthetic phone is closed.');
    closeVideo('replaced');
    const epoch = ++rtcEpoch;
    Object.assign(rtpStats, { framesEncoded: 0, sourcePaints: 0, metadataRecords: 0, compressedRecords: 0,
      videoGeneration: 1, readyGeneration: 1, renegotiations: 0, captureActive: false, controlState: 'connecting' });
    framesWritten = 0;
    const stream = { rtcEpoch: epoch, blocked: true, bufferedBytes: 0, restart() {} };
    video = stream;
    let result;
    try {
      result = await rtcPage.evaluate(installFakeRtpSource, { offer: sdp, epoch, source, moduleBase,
        magic: RTC_MAGIC, headerBytes: RTC_HEADER_BYTES, fragmentBytes: RTC_FRAGMENT_BYTES,
        videoTransport: RTC_VIDEO_TRANSPORT });
    } catch (error) {
      if (video === stream) closeVideo(null);
      throw error;
    }
    if (closed || video !== stream) throw Error('Synthetic phone source retired.');
    videoCount++;
    let sampling = false;
    stream.timer = setInterval(async () => {
      if (sampling || video !== stream) return;
      sampling = true;
      try {
        const snapshot = await rtcPage.evaluate(async epoch => {
          const state = globalThis.__fakeRtc;
          return state?.epoch === epoch ? state.snapshot() : null;
        }, epoch);
        if (!snapshot || video !== stream) return;
        Object.assign(rtpStats, snapshot);
        stream.bufferedBytes = snapshot.bufferedBytes; stream.blocked = snapshot.controlState !== 'open';
        framesWritten = snapshot.framesEncoded;
      } catch (error) {
        if (video === stream && !closed) { bridgeErrors.push(error.message); closeVideo(null); }
      } finally { sampling = false; }
    }, 100);
    return { type: 'answer', sdp: result.sdp, epoch, transport: RTC_TRANSPORT,
      videoTransport: RTC_VIDEO_TRANSPORT, fragmentBytes: RTC_FRAGMENT_BYTES };
  }

  async function rtcAction(action, value) {
    const epoch = video?.rtcEpoch;
    if (closed || !epoch) throw Error('Synthetic RTP source is not connected.');
    const result = await rtcPage.evaluate(async ({ epoch, action, value }) => {
      const state = globalThis.__fakeRtc;
      if (!state || state.epoch !== epoch) throw Error('Synthetic RTP source retired.');
      const result = state[action](value);
      return { result, snapshot: await state.snapshot() };
    }, { epoch, action, value });
    if (video?.rtcEpoch === epoch) Object.assign(rtpStats, result.snapshot);
    return result.result;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://phone');
    const requestEvidence = { method: req.method, path: url.pathname,
      secretInUrl: ['c', 'code'].some(key => url.searchParams.get(key) === code) };
    requests.push(requestEvidence);
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(req.headers.host ?? '')) return json(res, 421, { error: 'host' });
    if (req.method === 'OPTIONS') {
      preflights.push(Object.keys(req.headers));
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204, { 'Content-Length': '0' });
      return res.end();
    }
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /hello') return json(res, 200, { app: 'TiPlay', protocol: 1, clockMs: performance.now(),
      ...(rtcPage ? { transport: RTC_TRANSPORT, videoTransport: RTC_VIDEO_TRANSPORT } : {}) });
    if (rtcPage && ['/rtc', '/control', '/video', '/audio'].includes(url.pathname)) return json(res, 410, { error: 'transport-required' });
    if (rtcPage && (route === 'POST /rtc/pair/start' || route === 'POST /rtc/pair/finish')) {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (_) { return json(res, 400, { error: 'bad-request' }); }
      requestEvidence.signalingFields = Object.keys(body).sort();
      if ('c' in body || 'code' in body) return json(res, 400, { error: 'plaintext-code' });
      try {
        if (url.pathname.endsWith('/start')) {
          const result = await rtcPage.evaluate(body => globalThis.__srpFixture.start(body), body);
          return json(res, result.status, result.body);
        }
        const checked = await rtcPage.evaluate(body => globalThis.__srpFixture.verify(body), body);
        if (checked.status !== 200) return json(res, checked.status, checked.body);
        const answer = await streamRtc(body.offer);
        const result = await rtcPage.evaluate(({ body, answer }) => globalThis.__srpFixture.bind(body, answer), { body, answer });
        return json(res, result.status, result.body);
      } catch (error) { return json(res, 500, { error: 'rtc-failed', detail: error.message }); }
    }
    if (rtcPage && route === 'POST /bye') {
      let body; try { body = JSON.parse(await readBody(req)); } catch (_) { return json(res, 400, { error: 'bad-request' }); }
      if (body.c !== resourceToken || body.s !== current) return json(res, 401, { error: 'token' });
      closeVideo('stopped'); current = null; return res.writeHead(204).end();
    }
    if (route === 'GET /video') {
      if (authorize(res, url.searchParams.get('c'), url.searchParams.get('s'))) streamVideo(res, url.searchParams.get('timing') === '1');
      return;
    }
    if (route === 'POST /control' || route === 'POST /bye') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (_) {
        return json(res, 400, { error: 'bad-request' });
      }
      if (!authorize(res, body.c, body.s)) return;
      if (route === 'POST /bye') {
        if (video) closeVideo('stopped');
        current = null;
        res.writeHead(204);
        return res.end();
      }
      return json(res, 200, applyControl(body));
    }
    if (['/hello', '/video', '/control', '/bye'].includes(url.pathname)) return json(res, 405, { error: 'method' });
    json(res, 404, { error: 'not-found' });
  });

  const setup = rtcPage ? (async () => {
    await installSrpFixture(rtcPage, { code, moduleBase });
    await rtcPage.exposeFunction('__fakePhoneBridgeError', (message, epoch) => {
      if (video?.rtcEpoch === epoch && !closed) bridgeErrors.push(message);
    });
    await rtcPage.exposeFunction('__fakePhoneAuth', (body, epoch) => {
      let refusal;
      const response = { writeHead(status) { refusal = status; }, end() {} };
      if (epoch !== video?.rtcEpoch || !authorize(response, body.c, body.s, true)) return { q: body.q, error: refusal === 409 ? 'replaced' : 'code', status: refusal || 401 };
      resourceToken = randomBytes(32).toString('base64url');
      return { q: body.q, app: 'TiPlay', protocol: 1, clockMs: performance.now(), audio: false,
        transport: RTC_TRANSPORT, resourceToken, ...status(body.q) };
    });
    await rtcPage.exposeFunction('__fakePhoneControl', (body, epoch) => {
      if (epoch !== video?.rtcEpoch || body.s !== current || replaced.has(body.s)) return { q: body.q, error: 'replaced', status: 409 };
      if ('c' in body) throw new Error('ordinary DC control unexpectedly repeats the pairing code');
      lastSeen = Date.now(); return applyControl(body);
    });
    await rtcPage.exposeFunction('__fakePhoneBye', (body, epoch) => {
      if (epoch !== video?.rtcEpoch || body.s !== current) return { q: body.q, error: 'replaced', status: 409 };
      current = null; return { q: body.q, stopped: true };
    });
  })() : Promise.resolve();
  return setup.then(() => listen(server, host)).then(() => ({
    port: server.address().port,
    events, requests, preflights, bridgeErrors,
    assertHistories() { for (const history of [events, requests, preflights, bridgeErrors]) history.assertComplete(); },
    get videoCount() { return videoCount; },
    get streamStats() { return { ...rtpStats, framesWritten, blocked: Boolean(video?.blocked),
      bufferedBytes: video?.bufferedBytes ?? video?.res?.writableLength ?? 0, active: Boolean(video) }; },
    async changeSource({ mode = source.mode, width = source.width, height = source.height } = {}) {
      if (!['carplay', 'airplay-mirror'].includes(mode) || !Number.isSafeInteger(width) || width < 2 || width > 8192
        || !Number.isSafeInteger(height) || height < 2 || height > 8192) throw Error('Invalid synthetic video source.');
      const next = { ...source, mode, width, height, epoch: source.epoch + 1 };
      await rtcAction('changeSource', next); source = next;
    },
    injectCompressedVideo() { return rtcAction('injectCompressedVideo'); },
    failVideo(reason) {
      if (typeof reason !== 'string' || !/^[a-z0-9-]{1,100}$/.test(reason)) throw Error('Invalid synthetic video error.');
      return rtcAction('failVideo', reason);
    },
    setFit(value) { fit = value; },
    requestPortal() { portalRevision++; },
    /** Drops the current RTC peer or compatibility socket, as a vanished hotspot would. */
    dropVideo() { closeVideo(null); },
    /** Sends a key frame of garbage next, which the browser's decoder rejects. */
    corruptNextFrame() { corrupt = true; },
    async close() {
      closed = true; closeVideo('stopped');
      rtcPage?.off('pageerror', peerError);
      await Promise.all([...retirements]);
      await closeServer(server);
    },
  }));
}
