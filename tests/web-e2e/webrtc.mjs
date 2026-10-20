// SPDX-License-Identifier: GPL-3.0-only
// Production transport against a second real Chromium PeerConnection; no media API stand-ins.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, closeServer } from './resources.mjs';
import { installSrpFixture } from './srp-fixture.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  if (pathname === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>DataChannel integration</title>');
  const path = resolve(root, `.${pathname}`);
  if (!path.startsWith(root.replace(/\/$/, '') + sep) || !existsSync(path) || !statSync(path).isFile()) return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream' });
  response.end(readFileSync(path));
});
let browser;
try {
  await listen(server, '127.0.0.1');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox', '--no-proxy-server', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await installSrpFixture(page);
  const result = await page.evaluate(async () => {
    const { createRtcMediaTransport, RTC_MAGIC, RTC_HEADER_BYTES, RTC_FRAGMENT_BYTES, RTC_TRANSPORT } = await import('/webrtc-transport.js');
    const { authenticateRtcOffer } = await import('/rtc-pairing.js');
    const checks = [];
    function check(condition, message) { if (!condition) throw new Error(message); checks.push(message); }
    async function until(predicate, label, timeout = 5000) {
      const deadline = performance.now() + timeout;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error(`Timeout: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    async function pair() {
      const remote = new RTCPeerConnection({ iceServers: [] });
      const channels = {}, messages = [], errors = [], epoch = 41;
      let offerCandidates = 0, answerCandidates = 0;
      let nextAudioSequence = 0, staleOnNextOpen = null, authorized = false;
      remote.ondatachannel = ({ channel }) => {
        channels[channel.label] = channel;
        if (channel.label === 'control') channel.onmessage = ({ data }) => {
          const message = JSON.parse(data); messages.push(message);
          if (message.k === 'auth') {
            if (message.c !== '2718' || message.s !== 'integration_session_01') throw new Error('encrypted auth identity mismatch');
            authorized = true;
            channel.send(JSON.stringify({ q: message.q, app: 'TiPlay', protocol: 1, transport: RTC_TRANSPORT,
              audio: true, clockMs: performance.now(), resourceToken: 'A'.repeat(43) }));
            return;
          }
          if (!authorized) throw new Error('control admitted before encrypted authentication');
          if (message.k === 'bye') channel.send(JSON.stringify({ q: message.q, stopped: true }));
          if (message.e) setTimeout(() => { if (channel.readyState === 'open') channel.send(JSON.stringify({ q: message.q, state: 'streaming', touch: 'ok', clockMs: performance.now() })); }, 30);
          if (message.k === 'audio-ready' && message.enabled) {
            if (staleOnNextOpen) { send('audio', staleOnNextOpen, nextAudioSequence); staleOnNextOpen = null; }
            channel.send(JSON.stringify({ k: 'audio-barrier', generation: message.generation,
              sequence: nextAudioSequence, epoch }));
          }
        };
      };
      const controller = new AbortController();
      const transport = createRtcMediaTransport({ signal: controller.signal,
        credentials: () => ({ code: '2718', session: 'integration_session_01' }),
        onError: error => errors.push(error.reason),
        exchange: sdp => authenticateRtcOffer({ session: 'integration_session_01', code: '2718', offer: sdp,
          fetchPhone: async (path, options) => {
            const body = JSON.parse(options.body);
            if ('c' in body || 'code' in body) throw new Error('SRP signaling exposed the code');
            let response;
            if (path.endsWith('/start')) response = await globalThis.__srpFixture.start(body);
            else {
              response = await globalThis.__srpFixture.verify(body);
              if (response.status === 200) {
                offerCandidates = (body.offer.match(/^a=candidate:/gm) || []).length;
                await remote.setRemoteDescription({ type: 'offer', sdp: body.offer });
                await remote.setLocalDescription(await remote.createAnswer());
                await until(() => remote.iceGatheringState === 'complete', 'remote ICE');
                answerCandidates = (remote.localDescription.sdp.match(/^a=candidate:/gm) || []).length;
                response = await globalThis.__srpFixture.bind(body, { type: 'answer', sdp: remote.localDescription.sdp,
                  epoch, session: epoch, fragmentBytes: RTC_FRAGMENT_BYTES, transport: RTC_TRANSPORT });
                if ('resourceToken' in response.body) throw new Error('SRP finish exposed resource bearer');
              }
            }
            return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
          } }) });
      try { await transport.connect(); }
      catch (error) {
        const evidence = JSON.stringify({ local: transport.stats(), remote: remote.connectionState,
          ice: remote.iceConnectionState, offerCandidates, answerCandidates,
          channels: Object.fromEntries(Object.entries(channels).map(([name, channel]) => [name, channel.readyState])) });
        transport.close(); remote.close();
        throw new Error(`${error.reason || error.message}; ${evidence}`);
      }
      await until(() => Object.keys(channels).length === 3 && Object.values(channels).every(channel => channel.readyState === 'open'), 'three channels');
      function send(name, bytes, sequence, recordEpoch = epoch) {
        if (!authorized) throw new Error('media admitted before encrypted auth');
        const channel = channels[name];
        if (name === 'audio') nextAudioSequence = (sequence + 1) >>> 0;
        for (let offset = 0; offset < bytes.length;) {
          const size = Math.min(bytes.length - offset, RTC_FRAGMENT_BYTES - RTC_HEADER_BYTES);
          const fragment = new Uint8Array(RTC_HEADER_BYTES + size), header = new DataView(fragment.buffer);
          [RTC_MAGIC, recordEpoch, sequence, bytes.length, offset, size].forEach((value, index) => header.setUint32(index * 4, value, true));
          fragment.set(bytes.subarray(offset, offset + size), RTC_HEADER_BYTES);
          channel.send(fragment); offset += size;
        }
      }
      return { transport, remote, channels, messages, errors, controller, send,
        queueStaleAudio(bytes) { staleOnNextOpen = bytes; },
        close() { transport.close(); remote.close(); } };
    }
    const session = await pair();
    try {
      check(session.transport.hello().app === 'TiPlay' && Number.isFinite(session.transport.clockSample().serverMs)
        && session.transport.resourceToken()?.length === 43 && !('resourceToken' in session.transport.hello()),
        'mutual SRP and encrypted auth establish the trusted clock and private resource bearer');
      check(Object.values(session.channels).every(channel => channel.ordered && channel.maxRetransmits === null && channel.maxPacketLifeTime === null), 'three real channels use reliable ordered delivery');
      const large = Uint8Array.from({ length: 512 * 1024 + 37 }, (_, index) => (index * 31) % 251);
      const tail = new Uint8Array([19, 27, 83]);
      const reader = session.transport.video.getReader();
      session.send('video', large, 0); session.send('video', tail, 1);
      const first = await reader.read();
      check(first.value.length === large.length && first.value.every((value, index) => value === large[index]), 'large compressed record is reassembled byte for byte over SCTP');
      check(!session.messages.some(message => message.k === 'ack' && message.channel === 'video'), 'transport receipt does not return application credit before the reader advances');
      const second = await reader.read();
      await until(() => session.messages.some(message => message.k === 'ack' && message.channel === 'video' && message.q === 0), 'first consumption credit');
      check(second.value.every((value, index) => value === tail[index]), 'next record preserves decode order');
      const acknowledgement = session.messages.find(message => message.k === 'ack' && message.channel === 'video' && message.q === 0);
      check(acknowledgement.bytes === large.length, 'consumption credit accounts for the exact complete record');
      const control = await session.transport.control(9, [{ k: 't', p: [[0, 0.4, 0.6, 1]] }]);
      check(control.q === 9 && control.touch === 'ok' && session.messages.some(message => message.e?.[0]?.k === 't'), 'touch and status round trip over the separate control channel');
      const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => session.transport.control(20 + index, [{ k: 'hb' }])));
      check(concurrent.every((reply, index) => reply.q === 20 + index), 'eight concurrent ordered controls survive delayed real-channel replies');
      const audio = session.transport.openAudio().getReader();
      await until(() => session.messages.some(message => message.k === 'audio-ready' && message.enabled), 'audio activation');
      session.send('audio', new Uint8Array([3, 1, 4, 1, 5]), 0);
      const packet = await audio.read();
      check(packet.value.join(',') === '3,1,4,1,5', 'audio uses an independent reliable record stream');
      await audio.cancel();
      await until(() => session.messages.some(message => message.k === 'audio-ready' && !message.enabled), 'audio cancellation');
      check(session.transport.isConnected(), 'cancelling audio leaves video and control alive');
      session.queueStaleAudio(new Uint8Array([99, 98, 97]));
      const reopened = session.transport.openAudio().getReader();
      await until(() => session.transport.stats().audioFirstSequence === 2, 'new audio subscription barrier');
      session.send('audio', new Uint8Array([8, 6, 7, 5]), 2);
      const fresh = await reopened.read();
      check(fresh.value.join(',') === '8,6,7,5', 'audio reopen excludes old in-flight records across real channels');
      await reopened.cancel();
      const statistics = session.transport.stats();
      check(statistics.recordsReceived === 5 && statistics.highWaterBytes <= 16 * 1024 * 1024 + 2 * 1024 * 1024, 'real delivery exposes bounded queue and record evidence');
      const bye = await session.transport.bye();
      check(bye.stopped && session.messages.some(message => message.k === 'bye' && !('c' in message)), 'graceful encrypted bye needs no pairing code');
      session.controller.abort();
      check(!session.transport.isConnected(), 'owner abort closes the peer and all media');
      await reader.cancel().catch(() => {});
    } finally { session.close(); }
    const malformed = await pair();
    try {
      const reader = malformed.transport.video.getReader();
      const rejected = reader.read().then(() => false, error => error.reason === 'fragment-epoch');
      malformed.send('video', new Uint8Array([1]), 0, 42);
      check(await rejected, 'stale transport epochs fail explicitly before decoder admission');
      check(malformed.errors.includes('fragment-epoch') && !malformed.transport.isConnected(), 'protocol errors close the peer with a diagnostic reason');
    } finally { malformed.close(); }
    const controller = new AbortController();
    let exchangeCalled = false;
    const stalled = createRtcMediaTransport({ signal: controller.signal, timeoutMs: 2000,
      credentials: () => ({ code: '2718', session: 'integration_session_02' }),
      exchange: () => { exchangeCalled = true; return new Promise(() => {}); } });
    const started = performance.now();
    const bounded = await Promise.race([stalled.connect().then(() => false, () => true), new Promise(resolve => setTimeout(() => resolve(false), 3500))]);
    stalled.close();
    check(exchangeCalled && bounded && performance.now() - started < 3500, 'a stalled signaling exchange cannot outlive the connection deadline');
    return checks;
  });
  assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
  for (const check of result) console.log(`ok - ${check}`);
  console.log('WebRTC integration: all checks passed');
} finally {
  await browser?.close();
  await closeServer(server);
}
