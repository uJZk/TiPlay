// Realtime decoder negotiation and libav Workers under production CSP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { loadFixtures } from '../bench/libav/fixtures.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../../site/play');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(await readFile(resolve(root, 'index.html'), 'utf8'))[1];
const fixtures = await loadFixtures();
fixtures.push(JSON.parse(await readFile(new URL('../web/fixtures/live-alac24.json', import.meta.url), 'utf8')));
const server = createServer(async (req, res) => {
  try {
    res.setHeader('Content-Security-Policy', csp);
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html>'); return; }
    const full = resolve(root, new URL(req.url, 'http://localhost').pathname.slice(1));
    if (!full.startsWith(root + sep)) throw Error('path');
    res.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(full)) ? 'text/javascript' : 'application/wasm');
    res.end(await readFile(full));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const results = await page.evaluate(async fixtures => {
    globalThis.AudioDecoder = class { static get isConfigSupported() { throw Error('Realtime WebCodecs probe'); } constructor() { throw Error('Realtime WebCodecs decoder'); } };
    const { createAirPlayAudioDecoder } = await import('/airplay-audio-decoder.js');
    const { createLiveAudioDecoder } = await import('/live-audio-software.js');
    const { probeMirrorAudioFormats } = await import('/airplay-capabilities.js');
    if ((await probeMirrorAudioFormats()) !== 0x3fffffc) throw Error('Software formats not negotiated');
    const profiles = [];
    const config = f => ({ codec: f.name.includes('ELD') ? 'aac-eld' : f.codec === 'alac' ? 'alac' : 'aac-lc',
      sampleRate: f.rate, channels: f.channels, bitDepth: f.bitDepth ?? 16,
      samplesPerFrame: f.name.includes('ELD') ? Number(f.name.split(' ').at(-1)) : f.codec === 'alac' ? 4096 : 1024,
      ...(f.codec === 'alac' ? { cookie: Array.from(f.asc) } : { asc: Array.from(f.asc) }) });
    const record = c => ({ type: 0, mode: 'airplay-mirror', epoch: 1, rate: c.sampleRate, channels: c.channels, flags: 2, config: c });
    for (const f of fixtures) {
      const c = config(f), output = [], failures = [];
      const decoder = createAirPlayAudioDecoder({ onPcm: r => { if (r.pcm.byteLength) output.push(r); }, onError: e => failures.push(String(e)) });
      try {
        if (!await decoder.configure(record(c))) throw Error('Configuration failed: ' + f.name);
        for (let i = 0; i < f.packets.length; i++) {
          const ok = await decoder.decode({ ...record(c), flags: 0, decodeTimestampUs: i * c.samplesPerFrame * 1e6 / f.rate,
            payload: Uint8Array.from(f.packets[i]).buffer });
          if (!ok) throw Error('Decode failed: ' + f.name + failures.join());
        }
        if (!await decoder.configure({ ...record(c), config: { ended: true } })) throw Error('EOF failed');
        if (failures.length) throw Error(failures.join());
        let samples = 0, end = null, peak = 0;
        for (const r of output) {
          if (r.rate !== 48000 || end !== null && Math.abs(end - r.decodeTimestampUs) > 25) throw Error('Discontinuous output: ' + f.name);
          end = r.decodeTimestampUs + r.pcm.byteLength / 2 / r.channels * 1e6 / 48000;
          samples += r.pcm.byteLength / 2 / r.channels;
          for (const v of new Int16Array(r.pcm)) peak = Math.max(peak, Math.abs(v));
        }
        if (!samples || !peak) throw Error('Silent decoder: ' + f.name);
        profiles.push({ name: f.name, samples, peak, outputRate: 48000 });
      } finally { decoder.dispose(); }
    }
    const f = fixtures.find(f => f.name === 'AAC-ELD 48000 2ch 480'), c = config(f);
    const render = async silentPackets => {
      const output = [], decoder = createAirPlayAudioDecoder({ onPcm: r => { if (r.pcm.byteLength) output.push(r); }, onError: e => { throw e; } });
      try {
        await decoder.configure(record(c));
        let sequence = 0;
        for (let i = 0; i < 4; i++) {
          if (i === 2) for (let n = 0; n < silentPackets; n++) await decoder.decode({ ...record(c), flags: 0,
            payload: Uint8Array.of(0,104,52,0).buffer, decodeTimestampUs: sequence++ * .01 * 1e6 });
          await decoder.decode({ ...record(c), flags: 0, payload: Uint8Array.from(f.packets[i]).buffer, decodeTimestampUs: sequence++ * .01 * 1e6 });
        }
        await decoder.configure({ ...record(c), config: { ended: true } });
        return output;
      } finally { decoder.dispose(); }
    };
    const baseline = await render(0), silence = await render(19);
    if (silence.length !== 23) throw Error('NoData packet loss');
    for (let i = 0; i < silence.length; i++) {
      const actual = new Int16Array(silence[i].pcm);
      if (i >= 2 && i < 21) { if (actual.some(v => v !== 0)) throw Error('NoData was decoded'); }
      else {
        const expected = new Int16Array(baseline[i < 2 ? i : i - 19].pcm);
        if (actual.some((v, n) => v !== expected[n])) throw Error('NoData corrupted codec history');
      }
    }
    const cancelled = createLiveAudioDecoder(c);
    await cancelled.ready;
    const pending = cancelled.decode(Uint8Array.from(f.packets[0]), 0); cancelled.close();
    let aborted = false; try { await pending; } catch (e) { aborted = e.name === 'AbortError'; }
    if (!aborted) throw Error('Pending decode did not cancel');
    return { profiles, noDataPackets: 19, cancellation: aborted, webCodecsUsed: false };
  }, fixtures.map(f => ({ ...f, asc: Array.from(f.asc), packets: f.packets.map(p => Array.from(p)) })));
  assert.equal(results.profiles.length, 13); assert.deepEqual(errors, []);
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
