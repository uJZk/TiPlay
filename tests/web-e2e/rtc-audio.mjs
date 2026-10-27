// SPDX-License-Identifier: GPL-3.0-only
// Actual browser RTP decoders -> MediaStreamSource -> common production Worklet.
// Synthetic browser senders exercise the receiver graph, not Android packetizer provenance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(fileURLToPath(new URL('../../site/play/', import.meta.url)));
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(resolve(root, 'index.html'), 'utf8'))[1];
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp }); response.end('<!doctype html><title>Native audio check</title>'); return; }
  try {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) throw Error('Invalid path');
    const bytes = readFileSync(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Content-Security-Policy': csp });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', cause => errors.push(cause.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { createRtcAudio } = await import('/rtc-audio.js');
    const { gatherLocalOffer } = await import('/webrtc-transport.js');
    const { loadNetEq } = await import('/neteq.js');
    const { loadAudioCore } = await import('/wasm/audio-core.js');
    const [neteqModule, audioCoreModule] = await Promise.all([loadNetEq(), loadAudioCore()]);
    const context = new AudioContext({ sampleRate: 48000 }), senderContext = new AudioContext({ sampleRate: 48000 });
    await context.audioWorklet.addModule('/audio-worklet.js');
    const node = new AudioWorkletNode(context, 'tiplay-audio', { numberOfInputs: 16, outputChannelCount: [2],
      processorOptions: { neteqModule, audioCoreModule } });
    const messages = [], failures = [], peers = [], oscillators = [], anchors = [], readyOwners = [];
    let audio;
    node.port.onmessage = ({ data }) => { messages.push(data); if (data.nativeAudioBound) audio?.bound(data.nativeAudioBound); };
    node.onprocessorerror = () => failures.push('processor-error');
    node.port.postMessage({ reset: true, generation: 1 });
    node.port.postMessage({ debug: true, diagnosticRevision: 1, generation: 1 });
    const analyser = context.createAnalyser(); analyser.fftSize = 4096;
    node.connect(analyser); analyser.connect(context.destination);
    let captureCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { captureCalls++; throw Error('Unexpected microphone capture'); };
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (name, ...args) => {
      if (String(name).toLowerCase() === 'video') throw Error('Unexpected video element');
      const element = originalCreateElement(name, ...args);
      if (String(name).toLowerCase() === 'audio') anchors.push(element);
      return element;
    };
    const tracks = [220, 1100].map((frequency, index) => {
      const oscillator = senderContext.createOscillator(), gain = senderContext.createGain(), output = senderContext.createMediaStreamDestination();
      oscillator.frequency.value = frequency; gain.gain.value = index ? .15 : .4;
      oscillator.connect(gain).connect(output); oscillator.start(); oscillators.push(oscillator);
      return output.stream.getAudioTracks()[0];
    });
    const nativeErrors = [];
    const gather = async (peer, signal, stage) => {
      try { return await gatherLocalOffer(peer, signal); }
      catch (cause) { throw Error(stage + ': ' + cause.message + '; ' + peer.localDescription?.sdp.split(/\r?\n/)
        .filter(line => /^(m=|a=mid:|a=send|a=recv|a=inactive)/.test(line)).join('; ')); }
    };
    audio = createRtcAudio({ context, node, generation: 1, onError: cause => nativeErrors.push(cause.message),
      ready: owner => readyOwners.push(owner),
      gather: (peer, signal) => gather(peer, signal, 'receiver'),
      exchange: async ({ sdp, generation }) => {
        const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' }); peers.push(peer);
        await peer.setRemoteDescription({ type: 'offer', sdp });
        for (const [index, transceiver] of peer.getTransceivers().entries()) {
          transceiver.direction = index < tracks.length ? 'sendonly' : 'inactive';
          if (index < tracks.length) await transceiver.sender.replaceTrack(tracks[index]);
        }
        await peer.setLocalDescription(await peer.createAnswer());
        return { generation, sdp: await gather(peer, null, 'sender') };
      } });
    const configure = type => audio.configure({ type, epoch: 1, mode: 'carplay', channels: 2, rate: 48000,
      config: { audioTransport: 'webrtc-track-v1', codec: 'opus', rtcGeneration: 1, rtpSlot: String(type), semanticType: type } });
    try {
      await Promise.all([context.resume(), senderContext.resume(), audio.start(1)]);
      // Anchor the nonfirst voice slot, then end it while music keeps rendering.
      await configure(1); await configure(0);
      const wait = async check => { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('Native audio render timed out'); };
      await wait(() => messages.some(message => message.nativeStarted?.type === 0)
        && messages.some(message => message.nativeStarted?.type === 1));
      await wait(() => messages.some(message => message.diagnostics?.stream1?.backend === 'webrtc-track'));
      const rms = () => { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length); };
      const mixedRms = rms();
      audio.end({ type: 1, epoch: 1, mode: 'carplay' });
      oscillators[1].stop();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mediaRms = rms(), diagnostics = messages.filter(message => message.diagnostics).at(-1)?.diagnostics;
      return { mixedRms, mediaRms, captureCalls, failures, nativeErrors, diagnostics,
        elements: document.querySelectorAll('audio').length, native: audio.stats(), readyOwners,
        playoutAnchors: anchors.map(anchor => ({ muted: anchor.muted, volume: anchor.volume,
          hidden: anchor.hidden, controls: anchor.controls, paused: anchor.paused })) };
    } finally {
      audio.close(); node.port.postMessage({ dispose: true }); node.disconnect(); analyser.disconnect();
      for (const peer of peers) peer.close(); for (const track of tracks) track.stop();
      await Promise.all([context.close(), senderContext.close()]);
    }
  });
  assert.deepEqual(errors, []); assert.deepEqual(result.failures, []); assert.deepEqual(result.nativeErrors, []);
  assert.equal(result.captureCalls, 0); assert.equal(result.elements, 0);
  assert.deepEqual(result.readyOwners.map(owner => owner.type), [1, 0]);
  assert.deepEqual(result.playoutAnchors, [{ muted: true, volume: 0, hidden: true, controls: false, paused: false }]);
  assert.ok(result.mixedRms > .01); assert.ok(result.mediaRms > result.mixedRms * 1.2, 'silent ended voice restores music gain');
  assert.equal(result.diagnostics.stream0.backend, 'webrtc-track');
  assert.equal(result.diagnostics.stream1.backend, 'webrtc-track');
  assert.equal(result.native.drainUnknown, true);
  console.log(JSON.stringify({ browser: browser.version(), result, physicalOutputMeasured: false }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
