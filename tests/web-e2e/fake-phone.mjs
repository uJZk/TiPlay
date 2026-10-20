// SPDX-License-Identifier: GPL-3.0-only
// Synthetic phone source with real browser DataChannels when rtcPage is supplied.
// Retained direct HTTP record/control routes are used only by compatibility/resource tests.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { installSrpFixture } from './srp-fixture.mjs';
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
 * Starts the fake phone. `frames` loop at `fps`; every stream starts at frame 0, which must be a key frame.
 * HTTP or DataChannel controls land in `events` as `{s, q, event}`.
 * rtcPage must be a separate real browser page on a secure test origin.
 */
export function startFakePhone({ code, frames, width, height, fps = 30, codec = 'vp8', host = '127.0.0.1', rtcPage = null, moduleBase = '/' }) {
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
      void rtcPage.evaluate(epoch => {
        if (globalThis.__fakeRtc?.epoch === epoch) { globalThis.__fakeRtc.peer.close(); globalThis.__fakeRtc = null; }
      }, previous.rtcEpoch).catch(() => {});
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
      q, clockMs: performance.now(), state: 'streaming', codec, display: { w: width, h: height }, viewport, fit, touch: 'ok', portalRevision,
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

  /** The remote endpoint is a real browser PeerConnection; Node only supplies the synthetic compressed source. */
  async function streamRtc(sdp) {
    closeVideo('replaced');
    const epoch = ++rtcEpoch;
    const answer = await rtcPage.evaluate(async ({ sdp, epoch, magic, headerBytes, fragmentBytes }) => {
      globalThis.__fakeRtc?.peer.close();
      const peer = new RTCPeerConnection({ iceServers: [] });
      const state = globalThis.__fakeRtc = { peer, epoch, channels: {}, sequence: 0, unconsumed: new Map(), bytes: 0 };
      peer.ondatachannel = ({ channel }) => {
        state.channels[channel.label] = channel;
        if (channel.label === 'control') channel.onmessage = async ({ data }) => {
          const message = JSON.parse(data);
          if (message.k === 'auth') {
            const response = await globalThis.__fakePhoneAuth(message, epoch);
            state.authorized = !response.error;
            if (channel.readyState === 'open') channel.send(JSON.stringify(response));
            return;
          }
          if (!state.authorized) throw new Error('media/control admitted before encrypted auth');
          if (message.k === 'audio-ready' && message.enabled) { channel.send(JSON.stringify({ k: 'audio-barrier', generation: message.generation, sequence: 0, epoch })); return; }
          if (message.k === 'bye') {
            const response = await globalThis.__fakePhoneBye(message, epoch);
            if (channel.readyState === 'open') channel.send(JSON.stringify(response));
            return;
          }
          if (message.k === 'ack') {
            if (message.channel !== 'video' || state.unconsumed.get(message.q) !== message.bytes) throw new Error('invalid fake-phone consumption credit');
            state.unconsumed.delete(message.q); state.bytes -= message.bytes;
          } else if (Array.isArray(message.e)) {
            const response = await globalThis.__fakePhoneControl(message, epoch);
            if (globalThis.__fakeRtc === state && channel.readyState === 'open') channel.send(JSON.stringify(response));
          }
        };
      };
      await peer.setRemoteDescription({ type: 'offer', sdp });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { peer.close(); reject(new Error('fake-phone ICE gathering timed out')); }, 5000);
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
        });
      });
      state.send = records => {
        const channel = state.channels.video;
        if (!state.authorized || channel?.readyState !== 'open' || channel.bufferedAmount > 1024 * 1024
          || state.bytes + records.reduce((bytes, record) => bytes + record.length, 0) > 4 * 1024 * 1024) return false;
        for (const bytes of records) {
          const sequence = state.sequence++;
          state.unconsumed.set(sequence, bytes.length); state.bytes += bytes.length;
          for (let offset = 0; offset < bytes.length;) {
            const size = Math.min(bytes.length - offset, fragmentBytes - headerBytes);
            const fragment = new Uint8Array(headerBytes + size), header = new DataView(fragment.buffer);
            [magic, epoch, sequence, bytes.length, offset, size].forEach((value, index) => header.setUint32(index * 4, value, true));
            fragment.set(bytes.subarray(offset, offset + size), headerBytes); channel.send(fragment); offset += size;
          }
        }
        return true;
      };
      return peer.localDescription.sdp;
    }, { sdp, epoch, magic: RTC_MAGIC, headerBytes: RTC_HEADER_BYTES, fragmentBytes: RTC_FRAGMENT_BYTES });
    let sequence = 0, cursor = 0, configSent = false, sending = false;
    const stream = { rtcEpoch: epoch, restart: () => { cursor = 0; }, bufferedBytes: 0, blocked: true,
      timer: setInterval(async () => {
        if (video !== stream || sending) return;
        sending = true;
        try {
          const frame = corrupt ? { key: true, data: new Uint8Array(2000).fill(0x5a) } : frames[cursor % frames.length];
          const payload = new Uint8Array(8); new DataView(payload.buffer).setFloat64(0, performance.now() - 50, true);
          const timestampUs = Math.round(sequence * 1e6 / fps);
          const batch = [
            ...(!configSent ? [encodeRecord({ kind: RECORD.CONFIG, epoch: 1, payload: config })] : []),
            encodeRecord({ kind: RECORD.TIMING, epoch: 1, sequence, timestampUs, payload }),
            encodeRecord({ kind: RECORD.FRAME, flags: frame.key ? FLAG.KEY : 0, epoch: 1, sequence, timestampUs, payload: frame.data }),
          ];
          const result = await rtcPage.evaluate(({ epoch, records }) => {
            const state = globalThis.__fakeRtc;
            if (state?.epoch !== epoch) return null;
            const sent = state.send(records.map(bytes => Uint8Array.from(atob(bytes), char => char.charCodeAt(0))));
            return { sent, bytes: state.bytes };
          }, { epoch, records: batch.map(record => Buffer.from(record).toString('base64')) });
          if (video !== stream || !result) return;
          stream.blocked = !result.sent; stream.bufferedBytes = result.bytes;
          if (result.sent) { cursor++; sequence++; framesWritten++; configSent = true; corrupt = false; }
        } catch (error) {
          if (video === stream) { bridgeErrors.push(error.message); closeVideo(null); }
        } finally { sending = false; }
      }, 1000 / fps) };
    video = stream; videoCount++;
    return { type: 'answer', sdp: answer, epoch, transport: RTC_TRANSPORT, fragmentBytes: RTC_FRAGMENT_BYTES };
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
      ...(rtcPage ? { transport: RTC_TRANSPORT } : {}) });
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
    get streamStats() { return { framesWritten, blocked: Boolean(video?.blocked), bufferedBytes: video?.bufferedBytes ?? video?.res?.writableLength ?? 0, active: Boolean(video) }; },
    setFit(value) { fit = value; },
    requestPortal() { portalRevision++; },
    /** Drops the current RTC peer or compatibility socket, as a vanished hotspot would. */
    dropVideo() { closeVideo(null); },
    /** Sends a key frame of garbage next, which the browser's decoder rejects. */
    corruptNextFrame() { corrupt = true; },
    close() {
      closeVideo('stopped');
      rtcPage?.off('pageerror', peerError);
      return closeServer(server);
    },
  }));
}
