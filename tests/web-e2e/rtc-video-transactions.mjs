// SPDX-License-Identifier: GPL-3.0-only
// Genuine Chromium SDP/DataChannel recovery; does not establish Android RTP or picture continuity.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, closeServer } from './resources.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Video transaction test</title>');
  if (!/^\/[a-z0-9-]+\.js$/.test(path)) return response.writeHead(404).end();
  try { response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await readFile(resolve(root, path.slice(1)))); }
  catch { response.writeHead(404).end(); }
});
let browser;
try {
  await listen(server, '127.0.0.1');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-breakpad'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { createRtcMediaTransport, RTC_FRAGMENT_BYTES, RTC_TRANSPORT } = await import('/webrtc-transport.js');
    const sender = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const channels = new Map(), offers = [], ready = [], prepared = [], failures = [];
    let cached = null, applied = 0, queue = Promise.resolve(), control;
    const check = (value, message) => { if (!value) throw Error(message); };
    async function until(predicate) {
      const end = performance.now() + 5000;
      while (!predicate()) { if (performance.now() >= end) throw Error('condition timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    async function gathered(peer) {
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => peer.addEventListener('icegatheringstatechange', function done() {
        if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', done); resolve(); }
      }));
      return peer.localDescription;
    }
    sender.ondatachannel = ({ channel }) => {
      channels.set(channel.label, channel);
      if (channel.label !== 'control') return;
      control = channel;
      channel.onmessage = ({ data }) => {
        const request = JSON.parse(data);
        queue = queue.then(async () => {
          if (request.k === 'auth') channel.send(JSON.stringify({ q: request.q, app: 'TiPlay', protocol: 1,
            clockMs: performance.timeOrigin + performance.now(), audio: true, transport: RTC_TRANSPORT, resourceToken: 'r'.repeat(43) }));
          if (request.k === 'video-ready') ready.push(request.generation);
          if (request.k !== 'video-offer') return;
          offers.push(request);
          if (cached?.q === request.q) {
            check(cached.offer === request.sdp && cached.generation === request.generation, 'Retry changed its offer');
            channel.send(JSON.stringify(cached.answer)); return;
          }
          await sender.setRemoteDescription({ type: 'offer', sdp: request.sdp });
          check(sender.signalingState === 'have-remote-offer', 'Sender must have the actual remote offer');
          for (const transceiver of sender.getTransceivers()) if (!transceiver.stopped && transceiver.receiver.track.kind === 'video') transceiver.direction = 'sendonly';
          await sender.setLocalDescription(await sender.createAnswer());
          const answer = await gathered(sender);
          applied++;
          cached = { q: request.q, generation: request.generation, offer: request.sdp,
            answer: { k: 'video-answer', q: request.q, generation: request.generation, videoTransport: 'webrtc-track-v1', sdp: answer.sdp } };
          // Lose the first successful answer after SDP commits. Its retry must
          // reuse that answer, not apply the offer to a stable peer again.
          if (applied !== 1) channel.send(JSON.stringify(cached.answer));
        }).catch(error => failures.push(error.message));
      };
    };
    const codec = RTCRtpReceiver.getCapabilities('video').codecs.find(value => /^video\/H264$/i.test(value.mimeType)
      && /(?:^|;)packetization-mode=1(?:;|$)/.test(value.sdpFmtpLine));
    check(codec, 'H264 capability unavailable');
    let receiver;
    class Receiver extends RTCPeerConnection { constructor(options) { super(options); receiver = this; } }
    const media = createRtcMediaTransport({ PeerConnection: Receiver, videoTrack: true, videoCodecs: [codec], videoTimeoutMs: 2000,
      credentials: () => ({ code: '1234', session: 'test' }), onError: error => failures.push(error.reason),
      onVideoGeneration: generation => prepared.push(generation),
      exchange: async sdp => {
        await sender.setRemoteDescription({ type: 'offer', sdp });
        for (const transceiver of sender.getTransceivers()) transceiver.direction = 'sendonly';
        await sender.setLocalDescription(await sender.createAnswer());
        const answer = await gathered(sender);
        return { type: 'answer', sdp: answer.sdp, epoch: 7, fragmentBytes: RTC_FRAGMENT_BYTES, transport: RTC_TRANSPORT };
      } });
    try {
      await media.connect(); await until(() => channels.size === 3);
      const sctp = receiver.sctp, dtls = sctp.transport, originalChannels = [...channels.values()];
      await media.restartVideo(); await until(() => ready.includes(2));
      check(offers.length >= 2 && applied === 1, 'A lost answer must replay without another SDP application');
      check(receiver.signalingState === 'stable' && sender.signalingState === 'stable', 'Both actual peers must settle');
      control.send(JSON.stringify({ k: 'video-error', generation: 2, reason: 'video-ready-timeout' }));
      await until(() => ready.filter(value => value === 2).length === 2);
      check(applied === 1, 'Ready recovery must replay the committed transaction');
      await media.restartVideo(); await until(() => ready.includes(3));
      const beforeStale = offers.length;
      control.send(JSON.stringify({ k: 'video-error', generation: 2, reason: 'video-ready-timeout' }));
      await new Promise(resolve => setTimeout(resolve, 50));
      check(offers.length === beforeStale, 'A retired generation must not reopen');
      check(receiver.sctp === sctp && receiver.sctp.transport === dtls, 'SCTP and DTLS ownership changed');
      check(originalChannels.every(channel => channel.readyState === 'open' && channels.get(channel.label) === channel), 'Audio/control channels changed');
      check(prepared.join(',') === '2,3', 'A retry reinstalled the receiver');
      check(!failures.length, failures.join('; '));
      return { actualPeerConnections: true, answerApplications: applied, replacementGenerations: prepared,
        repeatedOfferCount: offers.length, permanentDataTransportRetained: true, androidRtpTested: false };
    } finally { media.close(); sender.close(); }
  });
  assert.deepEqual(errors, []); assert.equal(result.answerApplications, 2);
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await closeServer(server); }
