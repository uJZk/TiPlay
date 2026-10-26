// SPDX-License-Identifier: GPL-3.0-only
// Real libav Workers -> MessagePort -> production AudioWorklet, under production CSP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname, sep } from 'node:path';
import { loadFixtures } from '../bench/libav/fixtures.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../../site/play');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(await readFile(resolve(root, 'index.html'), 'utf8'))[1];
const fixtures = (await loadFixtures()).filter(f => ['AAC-LC 44100 stereo', 'ALAC 44100 stereo', 'AAC-ELD 48000 2ch 512'].includes(f.name));
assert.ok(fixtures.length >= 2);
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const result = await page.evaluate(async fixtures => {
    const { loadNetEq } = await import('/neteq.js');
    const { loadAudioCore } = await import('/wasm/audio-core.js');
    const { createAirPlayAudioDecoder } = await import('/airplay-audio-decoder.js');
    const [neteqModule, audioCoreModule] = await Promise.all([loadNetEq(), loadAudioCore()]);
    const context = new AudioContext({ sampleRate: 48000 });
    await context.audioWorklet.addModule('/audio-worklet.js');
    const node = new AudioWorkletNode(context, 'tiplay-audio', { outputChannelCount: [2], processorOptions: { neteqModule, audioCoreModule } });
    node.connect(context.destination);
    const owners = new Map(), metadata = [], metrics = [], errors = [];
    let sequence = 0, mainPcmBytes = 0, admitted = 0, consumed = 0;
    node.onprocessorerror = () => errors.push('processor error');
    node.port.onmessage = ({ data }) => {
      if (data.consumed) consumed += data.consumed;
      if (data.diagnostics) metrics.push(data.diagnostics);
      if (data.directPcm) {
        const batch = data.directPcm, owner = owners.get(batch.id);
        if (!owner) return;
        for (const record of batch.records) {
          if (record.pcm !== undefined) errors.push('PCM leaked to main');
          admitted += record.pcmBytes; metadata.push(record);
          decoder.directPcm(record);
        }
        const waiter = owner.pending.get(batch.deliveryId);
        if (waiter) { owner.pending.delete(batch.deliveryId); waiter.resolve(); } else owner.done.add(batch.deliveryId);
      }
    };
    node.port.postMessage({ debug: true, diagnosticRevision: 1, generation: 1 });
    const decoder = createAirPlayAudioDecoder({
      onPcm: record => { mainPcmBytes += record.pcm.byteLength; }, onError: cause => errors.push(cause.message),
      createDirectOutput(record) {
        const channel = new MessageChannel(), id = ++sequence;
        const owner = { done: new Set(), pending: new Map() }; owners.set(id, owner);
        const base = { ...record, generation: 1, arrivalTimeOrigin: performance.timeOrigin };
        node.port.postMessage({ directInput: { id, port: channel.port1, record: base } }, [channel.port1]);
        return { id, port: channel.port2, record: base,
          wait(deliveryId) { return owner.done.delete(deliveryId) ? Promise.resolve()
            : new Promise((resolve, reject) => owner.pending.set(deliveryId, { resolve, reject })); },
          close() {
            owners.delete(id);
            for (const pending of owner.pending.values()) pending.reject(Error('closed'));
            owner.pending.clear(); channel.port2.close();
            node.port.postMessage({ directClose: { id, type: record.type, generation: 1 } });
          },
        };
      },
    });
    decoder.debug(true);
    try {
      await context.resume();
      await Promise.all(fixtures.map(async (f, i) => {
        const config = { codec: f.name.includes('ELD') ? 'aac-eld' : f.codec === 'alac' ? 'alac' : 'aac-lc', sampleRate: f.rate,
          channels: f.channels, bitDepth: 16, samplesPerFrame: f.name.includes('ELD') ? Number(f.name.split(' ').at(-1)) : f.codec === 'alac' ? 4096 : 1024,
          ...(f.codec === 'alac' ? { cookie: Array.from(f.asc) } : { asc: Array.from(f.asc) }) };
        const record = { type: i, mode: 'airplay-mirror', epoch: 1, flags: 2, rate: f.rate, channels: f.channels, config };
        if (!await decoder.configure(record)) throw Error('setup ' + f.name + ': ' + errors.join('; '));
        for (let j = 0; j < Math.min(5, f.packets.length); j++) {
          if (!await decoder.decode({ ...record, flags: 0, decodeTimestampUs: j * config.samplesPerFrame * 1e6 / f.rate,
            payload: Uint8Array.from(f.packets[j]).buffer })) throw Error('decode ' + f.name);
        }
        if (!await decoder.configure({ ...record, config: { ended: true } })) throw Error('EOF ' + f.name);
      }));
      await new Promise(r => setTimeout(r, 1100));
      return { errors, mainPcmBytes, admitted, consumed, metadataRecords: metadata.length,
        eos: metadata.filter(r => r.ended).length, scalarNonzero: metadata.reduce((sum, r) => sum + (r.pcmStats?.nonzero || 0), 0),
        renderedNonzero: Math.max(0, ...metrics.map(m => m.renderNonzero)), owners: owners.size,
        profiles: fixtures.map(f => f.name), physicalOutputMeasured: false };
    } finally { decoder.dispose(); node.port.postMessage({ dispose: true }); node.disconnect(); await context.close(); }
  }, fixtures);
  assert.deepEqual(pageErrors, []); assert.deepEqual(result.errors, []);
  assert.equal(result.mainPcmBytes, 0); assert.ok(result.admitted > 0); assert.equal(result.consumed, result.admitted);
  assert.equal(result.eos, fixtures.length); assert.equal(result.owners, 0);
  assert.ok(result.scalarNonzero > 1000); assert.ok(result.renderedNonzero > 1000);
  console.log(JSON.stringify({ browser: browser.version(), ...result }));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
