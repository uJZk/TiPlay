// SPDX-License-Identifier: GPL-3.0-only
// Product router + Kotlin/JNI/libdatachannel -> browser controller, ready barrier and Worklet.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve, delimiter, join, extname, sep } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../..'), site = resolve(root, 'site/play');
const native = process.env.RTC_AUDIO_HOST_DIR;
assert.ok(native, 'Build scripts/rtc-audio/build.py --host and set RTC_AUDIO_HOST_DIR to its build/host directory.');
const classes = resolve(root, 'shared/build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes');
let stdlib = process.env.KOTLIN_STDLIB;
if (!stdlib) {
  const base = join(process.env.GRADLE_USER_HOME, 'caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib');
  const jars = [];
  for (const version of await readdir(base)) for (const hash of await readdir(join(base, version)))
    for (const file of await readdir(join(base, version, hash))) if (file.endsWith('.jar')) jars.push(join(base, version, hash, file));
  stdlib = jars.sort().at(-1);
}
assert.ok(stdlib, 'KOTLIN_STDLIB must point at a Kotlin standard library JAR.');
const probeClasses = resolve(native, 'probe-classes'); await mkdir(probeClasses, { recursive: true });
const compiled = spawnSync('javac', ['-cp', [classes, stdlib].join(delimiter), '-d', probeClasses,
  resolve(root, 'tests/native/RoutedAudioPeerProbe.java')], { encoding: 'utf8' });
assert.equal(compiled.status, 0, compiled.stderr);
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(resolve(site, 'index.html'), 'utf8'))[1];
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Product native audio check</title>'); return; }
  try {
    const path = resolve(site, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(site + sep)) throw Error('Invalid path');
    response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : extname(path) === '.wasm' ? 'application/wasm' : 'application/octet-stream');
    response.end(readFileSync(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixture = JSON.parse(readFileSync(resolve(root, 'tests/web/fixtures/neteq-opus.json'), 'utf8'));
let browser, child, page, stderr = '', sequence = 0;
const pending = new Map(), events = [];
function command(k, fields = {}) {
  const q = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(q); reject(Error('Native command timed out: ' + k + '; ' + stderr)); }, 12000);
    pending.set(q, value => { clearTimeout(timer); if (value.ok === false) reject(Error(value.error)); else resolve(value); });
    child.stdin.write(JSON.stringify({ ...fields, k, q }) + '\n');
  });
}
async function deliver(records) {
  if (records?.length) await page.evaluate(records => { for (const record of records) injectAudio(record); }, records);
}
function record(kind, payload, { epoch, timestamp = 0 } = {}) {
  const start = kind === 7 ? 36 : 28, bytes = Buffer.alloc(start + payload.length);
  bytes.writeUInt32BE(bytes.length - 4, 0); bytes[4] = kind; bytes[5] = 1; bytes[6] = 1; bytes[7] = kind === 6 ? 2 : 0;
  bytes.writeUInt32BE(48000, 8); bytes.writeUInt32BE(epoch, 16); bytes.writeDoubleBE(NaN, 20);
  if (kind === 7) bytes.writeDoubleBE(timestamp, 28);
  payload.copy(bytes, start); return bytes.toString('base64');
}
async function route(value) { const result = await command('route', { record: value }); await deliver(result.records); return result; }
try {
  child = spawn('java', ['--enable-native-access=ALL-UNNAMED', '-Djava.library.path=' + [native, resolve(native, 'libdatachannel')].join(delimiter),
    '-cp', [probeClasses, classes, stdlib].join(delimiter), 'com.shilapi.xcertplay.web.RoutedAudioPeerProbe'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', value => { stderr = (stderr + value.toString()).slice(-4000); });
  createInterface({ input: child.stdout }).on('line', line => {
    const value = JSON.parse(line);
    if (value.q !== undefined) { pending.get(value.q)?.(value); pending.delete(value.q); }
    else {
      events.push(value);
      page?.evaluate(value => nativeAudioEvent(value), value).catch(() => {});
    }
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage(); const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('nativeOffer', async value => {
    const result = await command('offer', value); await deliver(result.records);
    return { generation: value.generation, sdp: result.sdp };
  });
  await page.exposeFunction('nativeReady', async fields => {
    const result = await command('ready', { fields }); await deliver(result.records);
    assert.equal(result.readyok, true, 'Product router rejected the exact browser ready owner.');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const OriginalNode = AudioWorkletNode, OriginalPeer = RTCPeerConnection;
    globalThis.testPeers = []; globalThis.playoutAnchors = [];
    globalThis.RTCPeerConnection = class extends OriginalPeer { constructor(...args) { super(...args); testPeers.push(this); } };
    const createElement = document.createElement.bind(document);
    document.createElement = (name, ...args) => {
      if (String(name).toLowerCase() === 'video') throw Error('Unexpected video element');
      const element = createElement(name, ...args);
      if (String(name).toLowerCase() === 'audio') playoutAnchors.push(element);
      return element;
    };
    globalThis.AudioWorkletNode = class extends OriginalNode {
      constructor(context, ...args) {
        super(context, ...args); globalThis.analyser = context.createAnalyser(); analyser.fftSize = 2048;
        const silent = context.createGain(); silent.gain.value = 0;
        this.connect(analyser); analyser.connect(silent).connect(context.destination);
      }
    };
    globalThis.peak = 0;
    globalThis.probeTimer = setInterval(() => {
      if (!globalThis.analyser) return;
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    }, 10);
    const { createBrowserAudio } = await import('/audio.js');
    globalThis.audio = createBrowserAudio({ credentials: () => ({ code: '1234', session: 'test' }),
      fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(controller) { globalThis.audioInput = controller; } }) }) });
    globalThis.injectAudio = encoded => audioInput.enqueue(Uint8Array.from(atob(encoded), value => value.charCodeAt(0)));
    await audio.activate(); audio.debug(true);
    audio.attach(new AbortController().signal, { audio: true, audioTransport: 'webrtc-track-v1' }, null,
      { exchange: nativeOffer, ready: nativeReady, subscribe: listener => { globalThis.nativeAudioEvent = listener; return () => {}; } });
  });
  await page.waitForFunction(() => globalThis.audioInput && audio.stats().nativeAudio?.state === 'ready');
  const config = { codec: 'opus', sampleRate: 48000, channels: 1, samplesPerFrame: 960, semanticType: 1 };
  let firstPeerPeak;
  // Original source owners consume sixteen immutable slots; owner seventeen rotates the peer.
  for (let owner = 0; owner < 17; owner++) {
    const epoch = owner * 2 + 1;
    if (owner === 16) firstPeerPeak = await page.evaluate(() => peak);
    await route(record(6, Buffer.from(JSON.stringify(config)), { epoch }));
    if (owner === 16) {
      await page.waitForFunction(() => audio.stats().nativeAudio?.rtcGeneration === 2 && audio.stats().nativeAudio?.readySlots === 1);
      // Let the old Worklet's 5 ms retirement fade end before measuring the new
      // generation. No source packet for this owner has been admitted yet.
      await page.waitForTimeout(50);
      await page.evaluate(() => { peak = 0; });
    }
    const count = owner === 0 ? 80 : owner === 1 ? 20 : 8;
    for (let packet = 0; packet < count; packet++) {
      await route(record(7, Buffer.from(fixture.packets[packet], 'base64'), { epoch, timestamp: packet * 20000 }));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await route(record(6, Buffer.from(JSON.stringify({ ...config, ended: true })), { epoch: epoch + 1 }));
  }
  await page.waitForFunction(() => audio.stats().nativeAudio?.rtcGeneration === 2 && audio.stats().nativeAudio?.state === 'ready');
  await page.waitForTimeout(600);
  const result = await page.evaluate(async () => {
    const received = await Promise.all(testPeers.filter(peer => peer.connectionState !== 'closed').map(async peer =>
      [...(await peer.getStats()).values()].filter(value => value.type === 'inbound-rtp' && value.kind === 'audio')
        .map(value => ({ packets: value.packetsReceived, samples: value.totalSamplesReceived, emitted: value.jitterBufferEmittedCount }))));
    const anchors = playoutAnchors.map(anchor => ({ muted: anchor.muted, defaultMuted: anchor.defaultMuted, volume: anchor.volume,
      hidden: anchor.hidden, controls: anchor.controls, paused: anchor.paused, attached: anchor.srcObject !== null }));
    return { peak, native: audio.stats().nativeAudio, error: audio.stats().error, received: received.flat(), anchors };
  });
  const snapshot = await command('snapshot');
  assert.deepEqual(pageErrors, []); assert.equal(stderr, ''); assert.equal(result.error, null);
  assert.ok(firstPeerPeak > .001, 'Decoded original Opus never reached the first production Worklet generation.');
  assert.ok(result.peak > .001, 'Decoded original Opus never reached the replacement production Worklet generation.');
  assert.equal(snapshot.snapshot.generation, 2); assert.equal(snapshot.snapshot.receiverReadySlots, 1);
  assert.equal(result.anchors.length, 2);
  for (const anchor of result.anchors) {
    assert.equal(anchor.muted, true); assert.equal(anchor.defaultMuted, true); assert.equal(anchor.volume, 0);
    assert.equal(anchor.hidden, true); assert.equal(anchor.controls, false);
  }
  assert.equal(result.anchors[0].paused, true); assert.equal(result.anchors[0].attached, false);
  assert.ok(result.received.some(value => value.packets === 8 && value.samples > 0 && value.emitted > 0));
  assert.deepEqual(events.map(value => value.k), ['audio-restart-required']);
  await page.evaluate(() => { clearInterval(probeTimer); audio.dispose(); });
  assert.equal(await page.evaluate(() => playoutAnchors.every(anchor => anchor.paused && anchor.srcObject === null)), true);
  await command('close');
  console.log(JSON.stringify({ browser: browser.version(), backend: 'product Router + Kotlin/JNI + libdatachannel', owners: 17,
    slotsPerPeer: 16, firstPeerPeak, replacementPeerPeak: result.peak, received: result.received, peerGeneration: snapshot.snapshot.generation,
    silentAnchors: result.anchors.length, readyBarrierVerified: true, originalFixturePayloads: true, physicalOutputMeasured: false }));
} finally { child?.kill(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
