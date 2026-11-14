// SPDX-License-Identifier: GPL-3.0-only
// Product router + Kotlin/JNI/libdatachannel -> browser controller, ready barrier and Worklet.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, delimiter, join, dirname, extname, sep } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../..'), site = resolve(root, 'site/play');
const native = process.env.RTC_AUDIO_HOST_DIR;
const fault = process.argv.find(value => value.startsWith('--fault='))?.slice('--fault='.length) ?? 'none';
const encodedTapEnabled = process.argv.includes('--encoded-tap');
assert.ok(['none', 'udp-blackhole', 'wrong-ice-password'].includes(fault), 'Unknown test fault.');
assert.ok(fault === 'none' || !encodedTapEnabled, 'Run byte measurement separately from fault controls.');
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
let browser, child, page, blackhole, blackholeEndpoint, blackholeRequests = 0, encodedFallbackRecordsDelivered = 0, stderr = '', sequence = 0;
const pending = new Map(), events = [], ownerBindings = new Map(), expectedFrames = new Map();
async function report(value) {
  if (process.env.RTC_AUDIO_INTEROP_OUTPUT) {
    const output = resolve(process.env.RTC_AUDIO_INTEROP_OUTPUT);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(value, null, 2) + '\n');
  }
  console.log(JSON.stringify(value));
}
function injectedSdp(sdp) {
  if (fault === 'wrong-ice-password') return sdp.replace(/^a=ice-pwd:(\S+)/gm,
    (_, password) => 'a=ice-pwd:' + (password.startsWith('A') ? 'B' : 'A') + password.slice(1));
  if (fault === 'udp-blackhole') return sdp.replace(/^a=candidate:([^\r\n]+)/gm, (_, candidate) => {
    const fields = candidate.split(/\s+/);
    if (fields[2]?.toLowerCase() === 'udp') { fields[4] = blackholeEndpoint.address; fields[5] = String(blackholeEndpoint.port); }
    return 'a=candidate:' + fields.join(' ');
  });
  return sdp;
}
function command(k, fields = {}) {
  const q = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(q); reject(Error('Native command timed out: ' + k + '; stderrBytes=' + stderr.length)); }, 12000);
    pending.set(q, value => { clearTimeout(timer); if (value.ok === false) reject(Error(value.error)); else resolve(value); });
    child.stdin.write(JSON.stringify({ ...fields, k, q }) + '\n');
  });
}
async function deliver(records) {
  for (const encoded of records ?? []) {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes[4] === 7) encodedFallbackRecordsDelivered++;
    if (bytes[4] !== 6) continue;
    const config = JSON.parse(bytes.subarray(28).toString('utf8'));
    if (config.audioTransport === 'webrtc-track-v1' && !config.ended)
      ownerBindings.set(config.rtcOwnerEpoch, `${config.rtcGeneration}:${config.rtpSlot}`);
  }
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
  if (fault === 'udp-blackhole') {
    const address = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
    assert.ok(address, 'No normal IPv4 interface is available for the local negative control.');
    blackhole = createSocket('udp4');
    blackhole.on('message', bytes => {
      if (bytes.length >= 20 && bytes.readUInt16BE(0) === 1 && bytes.readUInt32BE(4) === 0x2112a442) blackholeRequests++;
    });
    await new Promise((resolve, reject) => { blackhole.once('error', reject); blackhole.bind(0, '0.0.0.0', resolve); });
    blackholeEndpoint = { address, port: blackhole.address().port };
  }
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
    args: ['--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage(); const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('nativeOffer', async value => {
    const result = await command('offer', { ...value, sdp: injectedSdp(value.sdp) }); await deliver(result.records);
    return { generation: value.generation, sdp: injectedSdp(result.sdp) };
  });
  await page.exposeFunction('nativeReady', async fields => {
    const result = await command('ready', { fields }); await deliver(result.records);
    assert.equal(result.readyok, true, 'Product router rejected the exact browser ready owner.');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async ({ encodedTapEnabled }) => {
    const OriginalNode = AudioWorkletNode, OriginalPeer = RTCPeerConnection;
    globalThis.testPeers = []; globalThis.playoutAnchors = []; globalThis.encodedFrames = []; globalThis.encodedTapErrors = 0;
    globalThis.encodedTapInitializations = []; globalThis.encodedTapInstallations = [];
    if (encodedTapEnabled) {
      if (typeof RTCRtpScriptTransform !== 'function') throw Error('Encoded receive measurement is unavailable.');
      // Measurement copies bytes, then enqueues the exact original frame unchanged.
      // The production receiver, decoder, ready barrier and Worklet remain in use.
      globalThis.encodedTap = new Worker(URL.createObjectURL(new Blob([`
        self.onrtctransform = event => {
          const { generation, mid } = event.transformer.options;
          self.postMessage({ initialized: true, generation, mid });
          const tap = new TransformStream({ transform(frame, controller) {
            const copy = new Uint8Array(frame.data).slice();
            self.postMessage({ generation, mid, timestamp: frame.timestamp, bytes: copy }, [copy.buffer]);
            controller.enqueue(frame);
          } });
          event.transformer.readable.pipeThrough(tap).pipeTo(event.transformer.writable)
            .catch(() => self.postMessage({ failed: true }));
        };
      `], { type: 'text/javascript' })));
      encodedTap.onmessage = ({ data }) => {
        if (data.initialized) { encodedTapInitializations.push(data.generation + ':' + data.mid); return; }
        if (data.failed) { encodedTapErrors++; return; }
        encodedFrames.push({ key: data.generation + ':' + data.mid, timestamp: data.timestamp, bytes: Array.from(data.bytes) });
      };
      encodedTap.onerror = () => { encodedTapErrors++; };
    }
    globalThis.RTCPeerConnection = class extends OriginalPeer {
      constructor(...args) {
        // Chromium otherwise short-circuits encoded streams before ontrack.
        // This opt-in belongs only to the separate measurement control.
        if (encodedTapEnabled) args[0] = { ...args[0], encodedInsertableStreams: true };
        super(...args); testPeers.push(this); const generation = testPeers.length;
        if (encodedTapEnabled) this.addEventListener('track', event => {
          const transform = new RTCRtpScriptTransform(encodedTap, { generation, mid: event.transceiver.mid });
          event.receiver.transform = transform;
          encodedTapInstallations.push({ key: generation + ':' + event.transceiver.mid, installed: event.receiver.transform === transform });
        });
      }
    };
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
      onNativeAudioFailure: value => { globalThis.firstNativeFailure ??= value; },
      fetchPhone: async () => ({ ok: true, body: new ReadableStream({ start(controller) { globalThis.audioInput = controller; } }) }) });
    globalThis.injectAudio = encoded => audioInput.enqueue(Uint8Array.from(atob(encoded), value => value.charCodeAt(0)));
    await audio.activate(); audio.debug(true);
    audio.attach(new AbortController().signal, { audio: true, audioTransport: 'webrtc-track-v1' }, null,
      { exchange: nativeOffer, ready: nativeReady, subscribe: listener => { globalThis.nativeAudioEvent = listener; return () => {}; } });
  }, { encodedTapEnabled });
  if (fault !== 'none') {
    const config = { codec: 'opus', sampleRate: 48000, channels: 1, samplesPerFrame: 960, semanticType: 1 };
    await route(record(6, Buffer.from(JSON.stringify(config)), { epoch: 1 }));
    for (let packet = 0; packet < 10; packet++)
      await route(record(7, Buffer.from(fixture.packets[packet], 'base64'), { epoch: 1, timestamp: packet * 20000 }));
    await page.waitForFunction(() => Boolean(globalThis.firstNativeFailure), null, { timeout: 35000 });
    const result = await page.evaluate(() => ({ failure: firstNativeFailure, peak,
      readySlots: audio.stats().nativeAudio?.readySlots }));
    const snapshot = await command('snapshot');
    assert.deepEqual(pageErrors, []); assert.equal(stderr, '');
    assert.equal(result.failure.state, 'failed'); assert.equal(result.failure.iceStatsState, 'sampled');
    assert.ok(result.failure.icePairCount > 0, 'The injected fault was not observed by real browser candidate-pair stats.');
    assert.ok(result.failure.iceRequestsSent > 0, 'No browser connectivity checks were observed.');
    assert.equal(result.readySlots, 0); assert.equal(encodedFallbackRecordsDelivered, 0);
    assert.ok(result.peak < 1e-8, 'Failed native negotiation unexpectedly produced Worklet audio.');
    if (fault === 'udp-blackhole') assert.ok(blackholeRequests > 0, 'The local blackhole did not receive any checks.');
    await page.evaluate(() => { clearInterval(probeTimer); audio.dispose(); });
    await command('close');
    await report({ status: 'passed', browser: browser.version(), injectedFault: fault,
      backend: 'product Router + Kotlin/JNI + libdatachannel', negativeControlExpected: true,
      browserFailure: result.failure, native: snapshot.snapshot.native?.transportDiagnostics ?? null,
      failures: snapshot.failures, blackholeRequests: fault === 'udp-blackhole' ? blackholeRequests : null,
      peak: result.peak, encodedFallbackRecordsDelivered, physicalOutputMeasured: false });
    process.exitCode = 0;
  } else {
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
      assert.ok(ownerBindings.has(epoch), 'The product router did not bind the native owner.');
      expectedFrames.set(ownerBindings.get(epoch), fixture.packets.slice(0, count));
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
      return { peak, native: audio.stats().nativeAudio, error: audio.stats().error, received: received.flat(), anchors,
        encodedFrames, encodedTapErrors, encodedTapInitializations, encodedTapInstallations };
    });
    const snapshot = await command('snapshot');
    assert.deepEqual(pageErrors, []); assert.equal(stderr, ''); assert.equal(result.error, null);
    assert.equal(encodedFallbackRecordsDelivered, 0);
    if (encodedTapEnabled) {
      assert.equal(result.encodedTapErrors, 0);
      assert.equal(result.encodedTapInstallations.length, 32, 'Every receiver on both peers must have its measurement installed.');
      assert.equal(result.encodedTapInstallations.every(value => value.installed), true);
      assert.deepEqual([...result.encodedTapInitializations].sort(), result.encodedTapInstallations.map(value => value.key).sort());
      for (const [key, expected] of expectedFrames) {
        const received = result.encodedFrames.filter(frame => frame.key === key);
        assert.equal(received.length, expected.length, 'Original encoded frame count differs for owner slot ' + key);
        received.forEach((frame, index) => {
          assert.deepEqual(Buffer.from(frame.bytes), Buffer.from(expected[index], 'base64'), 'Received Opus payload changed.');
          assert.equal(frame.timestamp, index * 960, 'Received RTP timestamp changed.');
        });
      }
      assert.equal(result.encodedFrames.length, [...expectedFrames.values()].reduce((count, frames) => count + frames.length, 0));
    }
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
    await page.evaluate(() => { clearInterval(probeTimer); audio.dispose(); globalThis.encodedTap?.terminate(); });
    assert.equal(await page.evaluate(() => playoutAnchors.every(anchor => anchor.paused && anchor.srcObject === null)), true);
    await command('close');
    await report({ status: 'passed', browser: browser.version(), backend: 'product Router + Kotlin/JNI + libdatachannel', owners: 17,
      slotsPerPeer: 16, firstPeerPeak, replacementPeerPeak: result.peak, received: result.received, peerGeneration: snapshot.snapshot.generation,
      silentAnchors: result.anchors.length, readyBarrierVerified: true, originalFixturePayloads: true,
      encodedFramesVerified: encodedTapEnabled ? result.encodedFrames.length : null,
      encodedPayloadsByteExact: encodedTapEnabled ? true : null, rtpTimestampsExact: encodedTapEnabled ? true : null,
      encodedTapInitializations: encodedTapEnabled ? result.encodedTapInitializations.length : null,
      encodedFallbackRecordsDelivered, physicalOutputMeasured: false });
  }
} catch (cause) {
  const diagnostics = await page?.evaluate(encodedTapEnabled => ({ native: globalThis.audio?.stats().nativeAudio,
    error: globalThis.audio?.stats().error,
    encodedTap: { enabled: encodedTapEnabled, initialized: globalThis.encodedTapInitializations ?? null,
      installations: globalThis.encodedTapInstallations ?? null, errors: globalThis.encodedTapErrors ?? null,
      frameCountsByKey: globalThis.encodedFrames?.reduce((counts, frame) => {
        counts[frame.key] = (counts[frame.key] ?? 0) + 1; return counts;
      }, {}) ?? null },
    anchors: (globalThis.playoutAnchors ?? []).map(anchor => ({ paused: anchor.paused, readyState: anchor.readyState,
      networkState: anchor.networkState, currentTime: anchor.currentTime, tracks: anchor.srcObject?.getAudioTracks()
        .map(track => ({ muted: track.muted, readyState: track.readyState })) ?? [] })),
    peers: (globalThis.testPeers ?? []).map(peer => ({ connection: peer.connectionState, ice: peer.iceConnectionState,
      gathering: peer.iceGatheringState, localCandidates: (peer.localDescription?.sdp.match(/^a=candidate:/gm) ?? []).length,
      remoteCandidates: (peer.remoteDescription?.sdp.match(/^a=candidate:/gm) ?? []).length })) }), encodedTapEnabled).catch(() => null);
  const snapshot = child?.exitCode === null ? await command('snapshot').catch(() => null) : null;
  const blocked = diagnostics?.peers?.some(peer => peer.localCandidates === 0) === true;
  await report({ status: blocked ? 'blocked' : 'failed', injectedFault: fault, diagnostics,
    native: snapshot?.snapshot, nativeStderrBytes: stderr.length, failureClass: cause.constructor.name });
  console.error(cause.message);
  process.exitCode = 1;
} finally { child?.kill(); await browser?.close(); if (blackhole) await new Promise(resolve => blackhole.close(resolve));
  await new Promise(resolve => server.close(resolve)); }
