// SPDX-License-Identifier: GPL-3.0-only
// Genuine browser ICE/DTLS/SCTP check of the production transport. Android and physical output are separate checks.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(fileURLToPath(new URL('../../site/play/', import.meta.url)));
const code = '2718', requests = [];
let phone, browser, client;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/test/vector') {
      const bytes = await readFile(new URL('../web/fixtures/rtc-srp.json', import.meta.url));
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(bytes); return;
    }
    if (pathname === '/rtc/pair/start' || pathname === '/rtc/pair/finish') {
      let body = '';
      for await (const bytes of request) { body += bytes; if (body.length > 128 * 1024) throw new Error('Oversized offer'); }
      const offer = JSON.parse(body);
      requests.push({ path: request.url, fields: Object.keys(offer).sort(), exposedCode: body.includes(`"${code}"`) });
      const answer = await phone.evaluate(({ path, body }) => globalThis.pairRequest(path, body), { path: pathname, body: offer });
      response.writeHead(answer.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(answer.body)); return;
    }
    if (pathname === '/test/pairing-mode') {
      let mode = ''; for await (const bytes of request) mode += bytes;
      await phone.evaluate(mode => { globalThis.pairingMode = mode; }, mode);
      response.writeHead(204); response.end(); return;
    }
    if (pathname === '/test/disconnect' || pathname === '/test/stale-session') {
      await phone.evaluate(stale => globalThis.interruptLatest(stale), pathname.endsWith('stale-session'));
      response.writeHead(204); response.end(); return;
    }
    if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>RTC check</title>'); return; }
    const path = resolve(root, pathname.slice(1));
    if (!path.startsWith(root + sep) || !path.endsWith('.js')) throw new Error('Invalid asset');
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(bytes);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking',
      '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const context = await browser.newContext();
  await context.grantPermissions(['local-network-access']);
  const pageErrors = [];
  phone = await context.newPage();
  phone.on('pageerror', error => pageErrors.push(error.message));
  await phone.goto(origin);
  await phone.evaluate(async code => {
    const { encodeRecord, RECORD, FLAG } = await import('/link.js');
    const { RTC_HEADER_BYTES, RTC_FRAGMENT_BYTES, RTC_MAGIC } = await import('/rtc-transport.js');
    const certificate = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
    const { pairingRoutines, pairingTranscript } = await import('/rtc-pairing.js');
    const { SRPServerSession } = await import('/vendor/tssrp6a/session-server.js');
    const { bigIntToArrayBuffer } = await import('/vendor/tssrp6a/utils.js');
    const pending = new Map(), hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    globalThis.pairingMode = 'success';
    globalThis.pairRequest = async (path, body) => {
      if (path.endsWith('/start')) {
        const routines = pairingRoutines(), saltBytes = crypto.getRandomValues(new Uint8Array(32)); saltBytes[0] |= 1;
        const salt = hex(saltBytes), id = hex(crypto.getRandomValues(new Uint8Array(16)));
        const saltValue = BigInt('0x' + salt);
        const verifier = routines.computeVerifier(await routines.computeX('TiPlay browser', saltValue, code));
        const server = await new SRPServerSession(routines).step1('TiPlay browser', saltValue, verifier);
        const B = server.B.toString(16); pending.set(id, { routines, server, salt, B, session: body.s });
        return { status: 200, body: { id, salt, B } };
      }
      const state = pending.get(body.id); pending.delete(body.id);
      if (!state || state.session !== body.s) return { status: 401, body: { error: 'code' } };
      const { routines, server, salt, B } = state; let M2;
      try { M2 = await server.step2(BigInt('0x' + body.A), BigInt('0x' + body.M1)); }
      catch (_) { return { status: 401, body: { error: 'code' } }; }
      const answered = body.s.startsWith('pairing-probe') ? { session: 177, answer: 'v=0\r\na=fingerprint:sha-256 PHONE\r\n' }
        : await globalThis.answerOffer(body);
      const result = { M2: M2.toString(16), sdp: answered.answer, session: answered.session };
      const secret = await server.sessionKey(BigInt('0x' + body.A));
      const keyBytes = await routines.hashPadded(bigIntToArrayBuffer(secret));
      const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const offer = globalThis.pairingMode === 'offer' ? body.offer + 'tampered' : body.offer;
      result.binding = hex(await crypto.subtle.sign('HMAC', key, pairingTranscript(['TiPlay-RTC-SRP6a-v1', body.id, body.s, body.A, B, salt, offer, result.sdp, result.session])));
      if (globalThis.pairingMode === 'proof') result.M2 = '1';
      if (globalThis.pairingMode === 'binding') result.binding = '00'.repeat(32);
      if (globalThis.pairingMode === 'answer') result.sdp += 'tampered';
      if (globalThis.pairingMode === 'session') result.session++;
      return { status: 200, body: result };
    };
    const video = [], canvas = new OffscreenCanvas(640, 360), drawing = canvas.getContext('2d');
    const image = drawing.createImageData(canvas.width, canvas.height);
    let seed = 17;
    for (let i = 0; i < image.data.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; image.data[i] = i % 4 === 3 ? 255 : seed >>> 24; }
    drawing.putImageData(image, 0, 0);
    const encoder = new VideoEncoder({ output(chunk) {
      const payload = new Uint8Array(chunk.byteLength); chunk.copyTo(payload);
      video.push(encodeRecord({ kind: RECORD.FRAME, flags: chunk.type === 'key' ? FLAG.KEY : 0,
        sequence: video.length + 1, epoch: 1, timestampUs: chunk.timestamp, payload }));
    }, error(error) { throw error; } });
    encoder.configure({ codec: 'vp8', width: 640, height: 360, bitrate: 20_000_000, framerate: 30, latencyMode: 'realtime' });
    for (let i = 0; i < 3; i++) { const frame = new VideoFrame(canvas, { timestamp: i * 33333 }); encoder.encode(frame, { keyFrame: i === 0 }); frame.close(); }
    await encoder.flush(); encoder.close();
    const audio = new Uint8Array(28 + 20000 * 2), header = new DataView(audio.buffer);
    header.setUint32(0, audio.length - 4); audio[4] = 2; audio[6] = 1; header.setUint32(8, 48000);
    header.setFloat64(20, 1000);
    for (let i = 0; i < 20000; i++) header.setInt16(28 + i * 2, i % 32767, true);
    globalThis.evidence = { auth: 0, touches: 0, clocks: 0, ready: 0, ack: { video: 0, audio: 0 }, fragmentCount: 0, bye: 0, connections: [], channels: [], maxFragment: 0 };
    globalThis.peers = [];
    let identity = 0;
    globalThis.answerOffer = async ({ offer }) => {
      const session = ++identity, peer = new RTCPeerConnection({ iceServers: [], certificates: [certificate] }), channels = {};
      globalThis.peers.push(peer);
      globalThis.interruptLatest = stale => {
        if (!stale) { channels.video.close(); return; }
        const fragment = new Uint8Array(RTC_HEADER_BYTES + 1), view = new DataView(fragment.buffer);
        [RTC_MAGIC, session - 1, 4, 1, 0, 1].forEach((value, i) => view.setUint32(i * 4, value, true));
        channels.video.send(fragment);
      };
      const sent = { video: 0, audio: 0 }, consumed = { video: 0, audio: 0 }, queues = { video: [...video], audio: [audio] };
      const sequence = { video: 0, audio: 0 }; let credits;
      function pump(label) {
        while (queues[label].length && sent[label] + queues[label][0].length - consumed[label] <= credits[label]) {
          const record = queues[label].shift(), id = ++sequence[label]; sent[label] += record.length;
          for (let offset = 0; offset < record.length; offset += RTC_FRAGMENT_BYTES - RTC_HEADER_BYTES) {
            const length = Math.min(RTC_FRAGMENT_BYTES - RTC_HEADER_BYTES, record.length - offset);
            const fragment = new Uint8Array(RTC_HEADER_BYTES + length), view = new DataView(fragment.buffer);
            [RTC_MAGIC, session, id, record.length, offset, length].forEach((value, i) => view.setUint32(i * 4, value, true));
            fragment.set(record.subarray(offset, offset + length), RTC_HEADER_BYTES);
            channels[label].send(fragment); globalThis.evidence.fragmentCount++;
            globalThis.evidence.maxFragment = Math.max(globalThis.evidence.maxFragment, fragment.length);
          }
        }
      }
      peer.ondatachannel = ({ channel }) => {
        channels[channel.label] = channel;
        globalThis.evidence.channels.push({ label: channel.label, ordered: channel.ordered,
          maxRetransmits: channel.maxRetransmits, maxPacketLifeTime: channel.maxPacketLifeTime });
        if (channel.label !== 'control') return;
        channel.onmessage = ({ data }) => {
          const request = JSON.parse(data), reply = result => channel.send(JSON.stringify({ id: request.id, ok: true, result }));
          if (request.type === 'auth') {
            if (request.c !== code) { channel.send(JSON.stringify({ id: request.id, ok: false, status: 401, error: 'bad code' })); return; }
            globalThis.evidence.auth++; reply({ session, audio: true, state: 'streaming' });
          } else if (request.type === 'rtc-ready') {
            globalThis.evidence.ready++; credits = { video: request.videoCredit, audio: request.audioCredit };
            pump('video'); pump('audio');
          } else if (request.type === 'rtc-ack') {
            consumed[request.channel] = request.consumed; globalThis.evidence.ack[request.channel] += 1; pump(request.channel);
          } else if (request.type === 'control') {
            globalThis.evidence.touches += request.e.filter(event => event.k === 't').length; reply({ q: request.q, state: 'streaming' });
          } else if (request.type === 'clock') { globalThis.evidence.clocks++; reply({ r: 1000, t: 1001 }); }
          else if (request.type === 'bye') globalThis.evidence.bye++;
        };
      };
      await peer.setRemoteDescription({ type: 'offer', sdp: offer });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve(); }));
      globalThis.evidence.connections.push(session);
      return { session, answer: peer.localDescription.sdp };
    };
  }, code);
  client = await context.newPage();
  client.on('pageerror', error => pageErrors.push(error.message));
  await client.goto(origin);
  const pairingResult = await client.evaluate(async code => {
    const { authenticateRtcOffer, pairingRoutines, pairingTranscript } = await import('/rtc-pairing.js');
    const { SRPClientSession } = await import('/vendor/tssrp6a/session-client.js');
    const { bigIntToArrayBuffer } = await import('/vendor/tssrp6a/utils.js');
    const vector = await (await fetch('/test/vector')).json(), routines = pairingRoutines();
    routines.generatePrivateValue = () => BigInt('0x' + vector.a);
    const proof = await (await new SRPClientSession(routines).step1('TiPlay browser', vector.code))
      .step2(BigInt('0x' + vector.salt), BigInt('0x' + vector.B));
    if (proof.A.toString(16) !== vector.A || proof.M1.toString(16) !== vector.M1 || proof.S.toString(16) !== vector.S) throw new Error('BC 1.79 cross-language vector mismatch');
    await proof.step3(BigInt('0x' + vector.M2));
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    const keyBytes = await routines.hashPadded(bigIntToArrayBuffer(proof.S));
    if (hex(keyBytes) !== vector.K) throw new Error('BC 1.79 shared key mismatch');
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const binding = hex(await crypto.subtle.sign('HMAC', key, pairingTranscript(['TiPlay-RTC-SRP6a-v1', vector.id,
      vector.session, vector.A, vector.B, vector.salt, vector.offer, vector.sdp, vector.rtcSession])));
    if (binding !== vector.binding) throw new Error('BC 1.79 transcript binding mismatch');
    const cases = [];
    for (const mode of ['success', 'proof', 'binding', 'offer', 'answer', 'session', 'wrong-code']) {
      await fetch('/test/pairing-mode', { method: 'POST', body: mode });
      let accepted = false, status = null;
      try {
        const answer = await authenticateRtcOffer({ fetchPhone: (path, options) => fetch(path, options), session: 'pairing-probe-session',
          code: mode === 'wrong-code' ? '0000' : code, offer: 'v=0\r\na=fingerprint:sha-256 CLIENT\r\n' });
        accepted = answer.session === 177;
      } catch (error) { status = error.status || error.message; }
      if (accepted !== (mode === 'success')) throw new Error('Pairing case ' + mode + ' did not fail closed');
      cases.push({ mode, accepted, status });
    }
    await fetch('/test/pairing-mode', { method: 'POST', body: 'success' });
    return { passed: true, bouncyCastle179Vector: true, cases, engine: 'Chromium native WebCrypto + production SRP6a helper' };
  }, code);
  assert.equal(requests.length, 14);
  assert.equal(requests.some(request => request.exposedCode || request.path.includes(code)), false);
  assert.equal((await phone.evaluate(() => globalThis.evidence.auth)), 0, 'Tamper checks never authorize a DataChannel');
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ pairing: pairingResult, sctpConnected: false, androidNativeMeasured: false, physicalOutputMeasured: false }, null, 2));
  if (!process.argv.includes('--pairing-only')) {
    const result = await client.evaluate(async ({ code }) => {
      const { connectRtc } = await import('/rtc-transport.js');
      const { authenticateRtcOffer } = await import('/rtc-pairing.js');
      const { RecordParser } = await import('/link.js');
      const { readAudioRecords } = await import('/audio-protocol.js');
      const within = (promise, label) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 12000);
        promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
      });
      globalThis.clientPeers = [];
      class ObservedPeer extends RTCPeerConnection {
        constructor(configuration) { super(configuration); globalThis.clientPeers.push(this); }
      }
      const closures = [];
      const connect = () => connectRtc({ fetchPhone: (path, options) => fetch(path, options), session: 'browser-smoke-session', code,
        codecs: ['vp8'], PeerConnection: ObservedPeer, authenticateOffer: authenticateRtcOffer, onClose: error => closures.push(error.message) });
      let decoded = 0, audioSamples = 0, videoBytes = 0, lastStats;
      for (let run = 0; run < 3; run++) {
        const connection = await connect(), reader = connection.video.getReader(), parser = new RecordParser();
        const decoder = new VideoDecoder({ output(frame) { decoded++; frame.close(); }, error(error) { throw error; } });
        decoder.configure({ codec: 'vp8', codedWidth: 640, codedHeight: 360 });
        for (let i = 0; i < 3; i++) {
          const chunk = await within(reader.read(), 'Video record'); if (chunk.done) throw new Error('Video ended early'); videoBytes += chunk.value.length;
          for (const record of parser.push(chunk.value)) decoder.decode(new EncodedVideoChunk({ type: record.flags & 1 ? 'key' : 'delta', timestamp: record.timestampUs, data: record.payload }));
        }
        await decoder.flush(); decoder.close();
        const audio = readAudioRecords(connection.audio), next = await within(audio.next(), 'Audio record');
        if (next.done) throw new Error('Audio ended early');
        const samples = new Int16Array(next.value.pcm); audioSamples += samples.length;
        if (samples[12345] !== 12345) throw new Error('PCM data changed in transport');
        const control = await connection.control(run + 1, [{ k: 't', x: 0.5, y: 0.5, p: 1 }]);
        if (control.q !== run + 1) throw new Error('Control response changed');
        const clock = await connection.clock();
        if (clock.r !== 1000 || clock.t !== 1001) throw new Error('Clock response changed');
        lastStats = connection.stats();
        if (lastStats.state !== 'connected') throw new Error('RTC peer did not connect');
        if (run < 2) {
          const failed = reader.read().then(() => { throw new Error('Invalid/lost session remained readable'); }, error => error.message);
          await fetch(run === 0 ? '/test/disconnect' : '/test/stale-session', { method: 'POST' });
          const reason = await within(failed, 'Peer retirement');
          if (run === 0 ? !/channel closed/.test(reason) : !/identity or bounds/.test(reason)) throw new Error(`Wrong retirement reason: ${reason}`);
        } else {
          connection.bye();
          await reader.read().catch(() => {});
          // Let the remote SCTP endpoint consume the graceful bye before closing Chromium.
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        reader.releaseLock(); await audio.return();
      }
      return { decoded, audioSamples, videoBytes, lastStats, closures };
    }, { code });
    const evidence = await phone.evaluate(() => globalThis.evidence);
    assert.equal(evidence.auth, 3, 'Only mutually authenticated SDP reaches DTLS authorization');
    assert.equal(result.decoded, 9);
    assert.equal(result.audioSamples, 60000);
    assert.ok(result.videoBytes > 16384, 'Encoded keyframe exercises fragmentation');
    assert.ok(evidence.fragmentCount > 8);
    assert.equal(evidence.maxFragment, 16384);
    assert.equal(evidence.touches, 3); assert.equal(evidence.clocks, 3); assert.equal(evidence.ready, 3);
    assert.equal(evidence.bye, 1);
    assert.equal(evidence.ack.video, 9); assert.equal(evidence.ack.audio, 3);
    assert.equal(evidence.channels.length, 9);
    for (const channel of evidence.channels) {
      assert.equal(channel.ordered, true); assert.equal(channel.maxRetransmits, null); assert.equal(channel.maxPacketLifeTime, null);
    }
    assert.equal(result.closures.length, 3);
    for (const request of requests) assert.deepEqual(request.fields, request.path.endsWith('/start') ? ['s'] : ['A', 'M1', 'id', 'offer', 's']);
    assert.equal(requests.some(request => request.exposedCode || request.path.includes(code)), false);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ browser: await browser.version(), transport: 'real browser ICE/DTLS/SCTP', ...result, evidence,
      pairing: pairingResult, signalingExposedCode: false, androidNativeMeasured: false, physicalOutputMeasured: false }, null, 2));
  }
} catch (error) {
  const states = async page => page?.evaluate(() => (globalThis.peers || globalThis.clientPeers || []).map(peer => ({
    connection: peer.connectionState, ice: peer.iceConnectionState, gathering: peer.iceGatheringState,
    candidates: peer.localDescription?.sdp.split(/\r?\n/).filter(line => line.startsWith('a=candidate:')),
  })));
  console.error(JSON.stringify({ phone: await states(phone), browser: await states(client) }));
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
