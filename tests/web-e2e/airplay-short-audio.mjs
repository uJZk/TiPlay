// SPDX-License-Identifier: GPL-3.0-only
// Compare the production short-source tail with native Web Audio duration clipping.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const enginePath = resolve(root, 'airplay-media.js'), engine = readFileSync(enginePath);
const sha = value => createHash('sha256').update(value).digest('hex');
const engineSha256 = sha(engine);
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Short URL audio oracle</title>'); return;
  }
  const target = resolve(root, '.' + pathname);
  if (!target.startsWith(resolve(root) + sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(target)) ? 'text/javascript' : 'application/octet-stream');
    response.end(target === enginePath ? engine : readFileSync(target));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  console.log(JSON.stringify({ browser: await browser.version(), engineSha256,
    oracle: 'native OfflineAudioContext whole-buffer duration clipping versus production URL EOF', physicalOutputMeasured: false }));
  for (const sampleRate of [44100, 48000]) for (const [sourceFrames, metadataFrames] of [[1, 1], [32, .5], [64, 1], [64, 47.5], [200000, 48.5]]) {
    const result = await page.evaluate(async ({ sampleRate, sourceFrames, metadataFrames }) => {
      const { createMediaEngine } = await import('/airplay-media.js');
      const value = (frame, channel) => channel ? (frame + 1) / 2 ** 20 : .15 + .07 * Math.sin(frame * .37);
      const origin = 100, packetFrames = 1024;
      let wall = 0, audioClock = 0, context, graph, next = 0, playResolved = false;
      const callbacks = new Map(), nodes = [], events = [];
      const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
      const track = { canDecode: async () => true, isLive: async () => false };
      class Input {
        async getPrimaryVideoTrack() { return null; }
        async getPrimaryAudioTrack() { return track; }
        async getFirstTimestamp() { return origin; }
        async getDurationFromMetadata() { return origin + metadataFrames / sampleRate; }
        dispose() {}
      }
      class Sink {
        async *buffers(start) {
          for (let first = Math.max(0, Math.round((start - origin) * sampleRate)); first < sourceFrames; first += packetFrames) {
            const length = Math.min(packetFrames, sourceFrames - first);
            yield { timestamp: origin + first / sampleRate, duration: length / sampleRate,
              buffer: { sampleRate, numberOfChannels: 2, length, duration: length / sampleRate,
                getChannelData: channel => Float32Array.from({ length }, (_, i) => value(first + i, channel)) } };
          }
        }
      }
      class Context {
        constructor(options) {
          graph = new OfflineAudioContext(2, 4096, options.sampleRate);
          this.sampleRate = graph.sampleRate; this.destination = graph.destination; this.state = 'suspended'; context = this;
        }
        get currentTime() { return audioClock; }
        createGain() { return graph.createGain(); }
        createBuffer(...args) { return graph.createBuffer(...args); }
        createBufferSource() {
          const node = graph.createBufferSource(), nativeStart = node.start.bind(node), nativeStop = node.stop.bind(node);
          node.start = (...args) => { nodes.push({ node, time: args[0], offset: args[1], duration: args[2] }); nativeStart(...args); };
          // Native Offline time is still zero while the graph is constructed.
          // Stop must use the same test clock as the production Context wrapper.
          node.stop = time => nativeStop(time === undefined ? audioClock : time);
          // EOF cleanup happens after our manual playback clock reaches the
          // tail. Preserve that historical route until Offline renders it.
          node.disconnect = () => {};
          return node;
        }
        async resume() { this.state = 'running'; }
        async close() { this.state = 'closed'; }
      }
      const media = createMediaEngine(null, { library: { Input, AudioBufferSink: Sink, UrlSource: class {}, ALL_FORMATS: [] },
        AudioContext: Context, now: () => wall, requestFrame: callback => { callbacks.set(++next, callback); return next; },
        cancelFrame: id => callbacks.delete(id), presenter: { present() {}, clear() {}, dispose() {} } });
      for (const name of ['playing', 'ended']) media.addEventListener(name, () => events.push(name));
      async function tick(seconds) {
        wall += seconds; if (context?.state === 'running') audioClock += seconds;
        const entry = callbacks.entries().next().value;
        if (entry) { callbacks.delete(entry[0]); entry[1](); }
        await flush();
      }
      try {
        await media.load('https://fixture.test/short-audio.mp4'); await flush(); await tick(0);
        if (media.ended) throw new Error('Paused short source ended before play');
        const playing = media.play().then(() => { playResolved = true; events.push('play-resolved'); });
        void playing.catch(() => {}); await flush();
        for (let i = 0; i < 10 && !playResolved; i++) await tick(0);
        if (!playResolved || media.ended || !nodes.length) throw new Error('Short source must actually start before ending');
        for (let i = 0; i < 2000 && !media.ended; i++) await tick(.25 / sampleRate);
        if (!media.ended || media.error) throw new Error('Finite short source did not finish');
        if (audioClock > nodes[0].time + (metadataFrames + .5) / sampleRate + 1e-10)
          throw new Error('EOF waited beyond the effective clipped source tail');
        await playing;
        if (!(events.indexOf('playing') < events.indexOf('play-resolved') && events.indexOf('play-resolved') < events.indexOf('ended')))
          throw new Error('Play/ended ordering changed');
        if (events.filter(event => event === 'ended').length !== 1) throw new Error('EOF was emitted more than once');
        const anchor = nodes[0].time, actual = await graph.startRendering();
        const referenceContext = new OfflineAudioContext(2, 4096, sampleRate);
        const referenceBuffer = referenceContext.createBuffer(2, sourceFrames, sampleRate);
        for (let channel = 0; channel < 2; channel++) referenceBuffer.copyToChannel(Float32Array.from({ length: sourceFrames }, (_, i) => value(i, channel)), channel);
        const whole = referenceContext.createBufferSource(); whole.buffer = referenceBuffer; whole.connect(referenceContext.destination);
        whole.start(anchor, 0, metadataFrames / sampleRate);
        const expected = await referenceContext.startRendering();
        let maximumError = 0, actualNonzero = 0, expectedNonzero = 0;
        for (let frame = 0; frame < actual.length; frame++) {
          if (actual.getChannelData(1)[frame] !== 0) actualNonzero++;
          if (expected.getChannelData(1)[frame] !== 0) expectedNonzero++;
          for (let channel = 0; channel < 2; channel++)
            maximumError = Math.max(maximumError, Math.abs(actual.getChannelData(channel)[frame] - expected.getChannelData(channel)[frame]));
        }
        return { sampleRate, sourceFrames, metadataFrames, actualNonzero, expectedNonzero, maximumError,
          ended: media.ended, playResolved, events, signalPreserved: maximumError < 1e-7 && actualNonzero === expectedNonzero };
      } finally { media.dispose(); }
    }, { sampleRate, sourceFrames, metadataFrames });
    console.log(JSON.stringify(result));
    assert.equal(result.signalPreserved, true, 'Production tail differs from the native duration reference');
    assert.equal(result.expectedNonzero, Math.min(sourceFrames, Math.ceil(metadataFrames)));
  }
  assert.deepEqual(errors, []);
  assert.equal(sha(readFileSync(enginePath)), engineSha256, 'Production source changed during native verification');
  console.log(JSON.stringify({ result: 'Short URL native EOF checks passed' }));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
