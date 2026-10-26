// Actual Mediabunny demuxer and libav module Worker under production CSP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../../site/play');
const fixtures = resolve(import.meta.dirname, '../web/fixtures');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)[1];
const server = createServer(async (req, res) => {
  try {
    res.setHeader('Content-Security-Policy', csp);
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html>'); return; }
    const path = new URL(req.url, 'http://localhost').pathname;
    const base = path.startsWith('/fixtures/') ? fixtures : root;
    const full = resolve(base, path.startsWith('/fixtures/') ? path.slice(10) : path.slice(1));
    if (!full.startsWith(base + sep)) throw Error('path');
    res.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(full)) ? 'text/javascript'
      : extname(full) === '.wasm' ? 'application/wasm' : 'application/octet-stream');
    res.end(await readFile(full));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const alac = await Promise.all(['alac-tone.json', 'alac-48000-tone.json'].map(name =>
    readFile(resolve(import.meta.dirname, '../bench/libav', name), 'utf8').then(JSON.parse)));
  const result = await page.evaluate(async alac => {
    const lib = await import('/vendor/mediabunny/mediabunny.min.js');
    const { castAudioBuffers, canDecodeCastAudio } = await import('/airplay-libav.js');
    const NativeWorker = globalThis.Worker;
    let workers = 0, created = 0;
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); workers++; created++; this.alive = true; }
      terminate() { if (this.alive) { workers--; this.alive = false; } super.terminate(); }
    };
    const results = [], traces = new Map();
    for (const mode of ['unsupported', 'native', 'runtime-error', 'seek', 'abort']) {
      const input = new lib.Input({ source: new lib.UrlSource(location.origin + '/fixtures/airplay-aac-lc.m4a'), formats: [lib.MP4] });
      const track = await input.getPrimaryAudioTrack();
      if (['unsupported', 'seek', 'abort'].includes(mode)) track.canDecode = async () => false;
      const supported = await canDecodeCastAudio(track);
      let library = lib;
      if (mode === 'runtime-error') library = { ...lib, AudioBufferSink: class {
        async *buffers(start) {
          let count = 0;
          for await (const frame of new lib.AudioBufferSink(track).buffers(start)) {
            yield frame;
            if (++count === 3) throw new DOMException('Forced audio decoder failure', 'EncodingError');
          }
        }
      } };
      const controller = new AbortController(), before = created;
      let frames = 0, peak = 0, previous = -Infinity;
      const backends = [], rates = new Set(), samples = [];
      try {
        for await (const { timestamp, buffer } of castAudioBuffers(library, track, mode === 'seek' ? .1 : 0,
          { signal: controller.signal, onBackend: value => backends.push(value) })) {
          if (timestamp < previous - 1e-8) throw Error('Nonmonotonic output');
          if (mode === 'seek' && timestamp < .1 - 1e-8) throw Error('Untrimmed seek');
          previous = timestamp + buffer.duration;
          frames += buffer.length; rates.add(buffer.sampleRate);
          for (const value of buffer.getChannelData(0)) { peak = Math.max(peak, Math.abs(value)); samples.push(value); }
          if (mode === 'abort') controller.abort();
        }
        if (mode === 'abort') throw Error('Abort did not interrupt decoding');
      } catch (error) { if (mode !== 'abort' || error.name !== 'AbortError') throw error; }
      input.dispose();
      if (workers) throw Error('Worker leaked');
      if (mode === 'native' && created !== before) throw Error('Native path created software worker');
      traces.set(mode, samples);
      results.push({ mode, supported, frames, peak, backends, rates: [...rates] });
    }
    const native = traces.get('native'), recovered = traces.get('runtime-error');
    if (native.length !== recovered.length) throw Error('Fallback changed frame count');
    const rms = Math.sqrt(native.reduce((sum, value, i) => sum + (value - recovered[i]) ** 2, 0) / native.length);
    if (rms > .001) throw Error('Fallback waveform diverged: ' + rms);
    results[2].waveformRmsError = rms;
    for (const fixture of alac) {
      const track = { canDecode: async () => false, getDecoderConfig: async () => ({ codec: 'alac',
        sampleRate: fixture.rate, numberOfChannels: fixture.channels, description: Uint8Array.from(fixture.asc) }) };
      const library = { EncodedPacketSink: class {
        async getKeyPacket() { return null; }
        async *packets() { for (let i = 0; i < fixture.packets.length; i++)
          yield { data: Uint8Array.from(fixture.packets[i]), timestamp: i * 4096 / fixture.rate }; }
      } };
      let frames = 0, backend;
      for await (const frame of castAudioBuffers(library, track, 0, { onBackend: value => backend = value })) frames += frame.buffer.length;
      if (workers) throw Error('ALAC worker leaked');
      results.push({ mode: fixture.name, frames, backend });
    }
    return results;
  }, alac);
  for (const item of result.slice(0, 5)) {
    assert.equal(item.supported, true);
    assert.ok(item.frames > 0 && item.peak > .01 && item.peak < 1, JSON.stringify(item));
  }
  assert.deepEqual(result[0].backends, ['libav-simd']);
  assert.deepEqual(result[1].backends, ['webcodecs']);
  assert.deepEqual(result[2].backends, ['webcodecs', 'libav-wasm']);
  assert.deepEqual(result[2].rates, [44100]);
  assert.equal(result[5].backend, 'libav-simd');
  assert.equal(result[6].backend, 'libav-wasm');
  assert.equal(result[5].frames, 48000);
  assert.equal(result[6].frames, 48000);
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
