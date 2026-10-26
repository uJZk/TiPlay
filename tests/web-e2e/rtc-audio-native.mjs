// SPDX-License-Identifier: GPL-3.0-only
// Real product Kotlin + C JNI + libdatachannel -> Chromium Opus decoding. No audio encoder.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve, delimiter, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../..');
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
const compile = spawnSync('javac', ['-cp', [classes, stdlib].join(delimiter), '-d', probeClasses,
  resolve(root, 'tests/native/EncodedAudioPeerProbe.java')], { encoding: 'utf8' });
assert.equal(compile.status, 0, compile.stderr);
let browser, child, errors = '';
const server = createServer((_, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Native audio interop</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const offer = await page.evaluate(async () => {
    const pc = globalThis.testPeer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const context = globalThis.testAudio = new AudioContext({ sampleRate: 48000 }); await context.resume();
    globalThis.testTracks = new Map();
    pc.ontrack = ({ track, transceiver }) => {
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser); analyser.connect(context.destination);
      testTracks.set(transceiver.mid, { track, analyser, peak: 0 });
    };
    globalThis.probeTimer = setInterval(() => {
      for (const entry of testTracks.values()) {
        const samples = new Float32Array(256); entry.analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) entry.peak = Math.max(entry.peak, Math.abs(sample));
      }
    }, 20);
    for (let i = 0; i < 2; i++) {
      const receiver = pc.addTransceiver('audio', { direction: 'recvonly' });
      receiver.setCodecPreferences(RTCRtpReceiver.getCapabilities('audio').codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus'));
    }
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('browser ICE timeout')), 5000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } };
    });
    return pc.localDescription.sdp;
  });
  assert.ok((offer.match(/^a=candidate:.* typ host/gm) || []).length > 0, 'Browser gathered no host ICE candidates; the local RTP environment is unavailable.');
  child = spawn('java', ['--enable-native-access=ALL-UNNAMED', '-Djava.library.path=' + [native, resolve(native, 'libdatachannel')].join(delimiter),
    '-cp', [probeClasses, classes, stdlib].join(delimiter), 'com.shilapi.xcertplay.web.EncodedAudioPeerProbe',
    resolve(root, 'tests/web/fixtures/neteq-opus.json')], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4000); });
  const lines = [], waiters = [];
  createInterface({ input: child.stdout }).on('line', line => waiters.length ? waiters.shift()(line) : lines.push(line));
  const nextLine = async () => lines.length ? lines.shift() : Promise.race([
    new Promise(resolve => waiters.push(resolve)), new Promise((_, reject) => setTimeout(() => reject(Error('native response timeout: ' + errors)), 7000)),
  ]);
  child.stdin.write(Buffer.from(offer).toString('base64') + '\n');
  const answer = Buffer.from(await nextLine(), 'base64').toString('utf8');
  assert.ok(answer.startsWith('v=0')); assert.equal((answer.match(/^m=audio /gm) || []).length, 2);
  await page.evaluate(sdp => testPeer.setRemoteDescription({ type: 'answer', sdp }), answer);
  child.stdin.write('start\n');
  const sent = await nextLine(); assert.equal(sent, 'sent:160', errors);
  await page.waitForTimeout(600);
  const result = await page.evaluate(async () => {
    const stats = [...(await testPeer.getStats()).values()];
    const received = stats.filter(stat => stat.type === 'inbound-rtp' && stat.kind === 'audio');
    return { connection: testPeer.connectionState, ice:testPeer.iceConnectionState, signaling:testPeer.signalingState, tracks: [...testTracks].map(([mid, value]) => ({ mid, peak: value.peak })),
      received: received.map(stat => ({ packets: stat.packetsReceived, bytes: stat.bytesReceived,
        energy: stat.totalAudioEnergy, codec: stats.find(codec => codec.id === stat.codecId)?.mimeType })),
      physicalOutputMeasured: false };
  });
  assert.deepEqual(pageErrors, []); assert.equal(result.connection, 'connected'); assert.equal(result.tracks.length, 2);
  assert.equal(result.received.length, 2);
  for (const track of result.tracks) assert.ok(track.peak > .001, 'native track has no decoded signal: ' + track.mid);
  for (const received of result.received) { assert.ok(received.packets >= 50); assert.ok(received.bytes > 0); assert.equal(received.codec.toLowerCase(), 'audio/opus'); }
  assert.equal(errors, '');
  child.stdin.write('close\n'); child.stdin.end();
  await page.evaluate(async () => { clearInterval(probeTimer); testPeer.close(); await testAudio.close(); });
  console.log(JSON.stringify({ browser: browser.version(), nativeBackend: 'libdatachannel-v0.24.6', ...result }));
} finally { child?.kill(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
