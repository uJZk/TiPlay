// SPDX-License-Identifier: GPL-3.0-only
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const args = process.argv.slice(2), options = new Map();
if (args.includes('--help')) {
  console.log('NODE_PATH=... CHROMIUM=/usr/bin/chromium node tests/web-e2e/capture-audio.mjs --capture DIR --clock-offset-ms NUMBER --start-ms 180000 --duration-ms 30000 --debug true [--capture-waveform true] --output DIR');
  process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  if (!['--capture', '--clock-offset-ms', '--start-ms', '--duration-ms', '--debug', '--output', '--stream', '--delay-ms', '--context-rate', '--capture-waveform'].includes(args[i]) || !args[i + 1]) throw Error('Use --help');
  options.set(args[i], args[i + 1]);
}
const startMs = Number(options.get('--start-ms') || 0), durationMs = Number(options.get('--duration-ms') || 30000);
const clockOffsetMs = Number(options.get('--clock-offset-ms')), delayMs = Number(options.get('--delay-ms') || 20);
const contextRate = Number(options.get('--context-rate') || 48000);
assert.ok(options.has('--capture') && options.has('--output') && options.has('--clock-offset-ms'));
assert.ok(Number.isFinite(startMs) && startMs >= 0 && Number.isFinite(durationMs) && durationMs >= 1000 && durationMs <= 300000);
assert.ok(Number.isFinite(clockOffsetMs) && Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 500);
assert.ok(Number.isInteger(contextRate) && contextRate >= 8000 && contextRate <= 96000);
assert.ok(['true', 'false'].includes(options.get('--debug') || 'true'));
assert.ok(['true', 'false'].includes(options.get('--capture-waveform') || 'false'));
const repo = fileURLToPath(new URL('../../', import.meta.url)), capture = resolve(options.get('--capture'));
const manifest = JSON.parse(await readFile(resolve(capture, 'manifest.json')));
assert.equal(manifest.format, 'tiplay-capture-replay-v1');
const stream = manifest.audio[Number(options.get('--stream') || 0)];
assert.ok(stream && /^audio-\d+\.bin$/.test(stream.file));
const payload = await readFile(resolve(capture, stream.file));
assert.equal(createHash('sha256').update(payload).digest('hex'), stream.sha256, 'Captured audio bytes must match the prepared manifest');
const selected = stream.events.filter(e => e.atMs >= startMs && e.atMs < startMs + durationMs);
assert.ok(selected.some(e => e.audio.kind === 7), 'Clip must contain encoded audio');
// Reinstall only the latest recorded configuration per type, without inventing codec parameters.
const previous = new Map();
for (const event of stream.events) {
  if (event.atMs >= startMs) break;
  if (event.audio.kind === 6) previous.set(event.audio.type, event);
  else if (event.audio.kind === 2) previous.delete(event.audio.type);
}
const events = [...previous.values()].map(e => ({ ...e, atMs: 0, bootstrap: true }))
  .concat(selected.map(e => ({ ...e, atMs: e.atMs - startMs })));
const fixture = { originEpochMillis: stream.originEpochMillis, startMs, durationMs, clockOffsetMs, delayMs, contextRate,
  captureWaveform: options.get('--capture-waveform') === 'true',
  debug: options.get('--debug') !== 'false', events };
const output = resolve(options.get('--output'));
await mkdir(output, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright-core');
const pageRoot = resolve(repo, 'site/play'), testRoot = resolve(repo, 'tests/web-e2e');
const index = await readFile(resolve(pageRoot, 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)?.[1];
assert.ok(csp);
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let data, type;
    if (url.pathname === '/') {
      data = '<!doctype html><title>TiPlay captured audio replay</title><button id="start">Start capture replay</button><script type="module" src="/e2e/capture-audio-probe.js"></script>';
      type = 'text/html';
    } else if (url.pathname === '/fixture.json') { data = JSON.stringify(fixture); type = 'application/json'; }
    else if (url.pathname === '/audio.bin') { data = payload; type = 'application/octet-stream'; }
    else {
      const root = url.pathname.startsWith('/play/') ? pageRoot : url.pathname.startsWith('/e2e/') ? testRoot : null;
      if (!root) throw Error('Unknown route');
      const path = resolve(root, url.pathname.replace(/^\/(play|e2e)\//, ''));
      if (!path.startsWith(root + sep)) throw Error('Invalid route');
      data = await readFile(path); type = types[extname(path)] || 'application/octet-stream';
    }
    response.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking'] });
  const context = await browser.newContext(), page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => globalThis.captureReady, null, { timeout: 30000 });
  const cdp = await context.newCDPSession(page), trace = [];
  cdp.on('Tracing.dataCollected', data => trace.push(...data.value));
  if (!fixture.captureWaveform) {
    await cdp.send('Tracing.start', { categories: 'toplevel,devtools.timeline,blink.user_timing,v8,audio,webaudio,disabled-by-default-audio',
      options: 'record-as-much-as-possible' });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  }
  await page.getByRole('button', { name: 'Start capture replay' }).click();
  await page.waitForFunction(() => globalThis.captureStarted, null, { timeout: 30000 });
  await page.evaluate(() => performance.mark('capture-window-start'));
  if (!fixture.captureWaveform) await cdp.send('Profiler.start');
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  await page.waitForFunction(() => globalThis.captureResult !== null, null, { timeout: durationMs + 30000, polling: 100 });
  const after = await metrics(), result = await page.evaluate(() => globalThis.captureResult);
  if (result.waveform) {
    let offset = 0;
    const chunks = result.waveform.chunks.map(({ base64, ...rest }) => {
      const bytes = Buffer.from(base64, 'base64');
      const row = { ...rest, byteOffset: offset, byteLength: bytes.length }; offset += bytes.length;
      return { bytes, row };
    });
    await writeFile(resolve(output, 'output.f32'), Buffer.concat(chunks.map(c => c.bytes)));
    await writeFile(resolve(output, 'output-index.json'), JSON.stringify({ sampleRate: result.waveform.sampleRate,
      channels: result.waveform.channels, chunks: chunks.map(c => c.row) }));
    delete result.waveform;
  }
  await page.evaluate(() => performance.mark('capture-window-end'));
  if (!fixture.captureWaveform) {
    const { profile } = await cdp.send('Profiler.stop');
    const complete = new Promise(done => cdp.once('Tracing.tracingComplete', done));
    await cdp.send('Tracing.end'); await complete;
    await writeFile(resolve(output, 'main.cpuprofile'), JSON.stringify(profile));
    await writeFile(resolve(output, 'trace.json'), JSON.stringify({ traceEvents: trace }));
  }
  const report = { browser: await browser.version(), sourceArchiveSha256: manifest.sourceArchiveSha256,
    startMs, durationMs, debug: fixture.debug, captureWaveform: fixture.captureWaveform, errors,
    cpuBenchmarkEligible: !fixture.captureWaveform,
    mainTaskPercent: fixture.captureWaveform ? null : (after.TaskDuration - before.TaskDuration) / (after.Timestamp - before.Timestamp) * 100,
    mainScriptPercent: fixture.captureWaveform ? null : (after.ScriptDuration - before.ScriptDuration) / (after.Timestamp - before.Timestamp) * 100,
    result, limitations: ['Desktop audio-only replay; no vehicle CPU or acoustic output measured.',
      'Original Android send timing and encoded bytes; local SCTP acceptance is not evidence of browser receipt.',
      'Fixed clock mapping and native desktop output timestamp behavior differ from the car browser.',
      'AudioWorklet and native task CPU require thread-time trace analysis; Profiler covers main JS only.'] };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ browser: report.browser, startMs, durationMs, debug: fixture.debug,
    mainTaskPercent: report.mainTaskPercent, mainScriptPercent: report.mainScriptPercent,
    packets: result.final.debug?.decoder?.packets ?? null, replay: result.replay, errors: [...errors, ...result.errors] }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  assert.ok(result.replay.emittedRecords > 0);
  assert.ok(result.playingReferences > 0, 'Replay must reach actual playing output, including when Debug is off');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
