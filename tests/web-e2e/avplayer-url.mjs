// SPDX-License-Identifier: GPL-3.0-only
// Real production URL adapter and self-hosted AVPlayer, under the production CSP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { listen, closeServer } from './resources.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
import { SOFTWARE_VIDEO, configureVideoDecoder } from './avplayer-hardware-override.mjs';
const cancellationOnly = process.argv.includes('--cancellation-only');
const root = resolve(import.meta.dirname, '../../site/play');
const fixtures = await mkdtemp(resolve(tmpdir(), 'tiplay-avplayer-'));
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(await readFile(resolve(root, 'index.html'), 'utf8'))[1];
const requests = [], pending = new Set(), foreignRequests = [];
let foreignOrigin;
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.ts': 'video/mp2t', '.m3u8': 'application/vnd.apple.mpegurl' };
const foreignServer = createServer(async (req, res) => {
  foreignRequests.push(req.url);
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^(movie\.mp4|part\d+\.ts)$/.test(name)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(resolve(fixtures, name));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', mime[extname(name)]); res.setHeader('Content-Length', data.length); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    res.setHeader('Content-Security-Policy', csp);
    // Intentionally no COOP/COEP: the hosted page must work without SharedArrayBuffer.
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><style>body{margin:0}#stage{position:relative;width:640px;height:360px;background:#000}</style><div id="stage"></div>'); return;
    }
    if (url.pathname === '/airplay-resource') {
      requests.push({ resource: url.searchParams.get('r'), range: req.headers.range || null });
      if (url.searchParams.get('c') !== '1234' || url.searchParams.get('s') !== 'fixture') {
        res.writeHead(403); res.end(); return;
      }
      const name = url.searchParams.get('r');
      if (['mixed.m3u8', 'hdr-only.m3u8'].includes(name)) {
        const child = name => `/airplay-resource?c=1234&s=fixture&r=${name}`;
        let body = '#EXTM3U\n';
        body += '#EXT-X-STREAM-INF:BANDWIDTH=9000000,CODECS="hvc1.2.4.L150.B0",VIDEO-RANGE=PQ\n'+child('forbidden-pq.m3u8')+'\n';
        body += '#EXT-X-STREAM-INF:BANDWIDTH=8500000,CODECS="dvhe.05.06",VIDEO-RANGE=SDR\n'+child('forbidden-dolby.m3u8')+'\n';
        if (name === 'mixed.m3u8') {
          body += '#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="avc1.42c00c,mp4a.40.2"\n'+child('forbidden-unknown.m3u8')+'\n';
          body += '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c00c,mp4a.40.2",RESOLUTION=320x180,VIDEO-RANGE=SDR\n'+child('index.m3u8')+'\n';
        }
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end(body); return;
      }
      if (name?.startsWith('forbidden-')) { res.writeHead(502); res.end('a disallowed rendition was requested'); return; }
      if (name === 'malformed.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('invalid HLS fixture'); return; }
      if (name === 'broken') { res.writeHead(502); res.end('fixture failure'); return; }
      if (name === 'redirect') { res.writeHead(302, { Location: foreignOrigin + '/movie.mp4' }); res.end(); return; }
      if (['hang', 'hang-key'].includes(name)) {
        pending.add(res); res.on('close', () => pending.delete(res)); return;
      }
      if (!/^(movie\.mp4|index\.m3u8|live\.m3u8|remote\.m3u8|encrypted\.m3u8|part\d+\.ts)$/.test(name || '')) { res.writeHead(404); res.end(); return; }
      let data = await readFile(resolve(fixtures, ['live.m3u8', 'remote.m3u8', 'encrypted.m3u8'].includes(name) ? 'index.m3u8' : name));
      if (name === 'encrypted.m3u8') data = Buffer.from(data.toString().replace('#EXTINF:', '#EXT-X-KEY:METHOD=AES-128,URI="/airplay-resource?c=1234&s=fixture&r=hang-key"\n#EXTINF:'));
      if (name === 'live.m3u8') data = Buffer.from(data.toString().replace('#EXT-X-ENDLIST', ''));
      res.setHeader('Content-Type', mime[extname(name)]);
      if (name.endsWith('.m3u8')) {
        data = Buffer.from(data.toString().replace(/^part\d+\.ts$/gm, part =>
          name === 'remote.m3u8' ? `${foreignOrigin}/${part}` : `/airplay-resource?c=1234&s=fixture&r=${part}`));
      }
      res.setHeader('Accept-Ranges', 'bytes');
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (match) {
        const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : data.length - 1, data.length - 1);
        if (start >= data.length || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); res.end(); return; }
        res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
        data = data.subarray(start, end + 1);
      }
      res.setHeader('Content-Length', data.length); res.end(data); return;
    }
    const path = resolve(root, '.' + url.pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path);
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
async function instrument(page) {
    await page.addInitScript(() => {
      window.audioProbes = [];
      window.evidence = { videoCreates: 0, workers: 0, contexts: 0, events: [], cspViolations: [] };
      addEventListener('securitypolicyviolation', event => evidence.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
      const create = Document.prototype.createElement;
      Document.prototype.createElement = function(name, ...args) {
        if (String(name).toLowerCase() === 'video') evidence.videoCreates++;
        return create.call(this, name, ...args);
      };
      const createNS = Document.prototype.createElementNS;
      Document.prototype.createElementNS = function(namespace, name, ...args) {
        if (String(name).toLowerCase() === 'video') evidence.videoCreates++;
        return createNS.call(this, namespace, name, ...args);
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); evidence.workers++; this.alive = true; }
        terminate() { if (this.alive) { evidence.workers--; this.alive = false; } return super.terminate(); }
      };
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) {
          super(...args); evidence.contexts++; this.alive = true;
          this.outputProbe = this.createAnalyser(); this.outputProbe.fftSize = 2048;
          audioProbes.push(this.outputProbe);
        }
        createGain() { const node = super.createGain(); node.connect(this.outputProbe); return node; }
        close() {
          return this.closePromise ||= super.close().then(() => {
            if (this.alive) { evidence.contexts--; this.alive = false; }
          });
        }
      };
    });
}
let browser;
try {
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-g', '24', '-bf', '0',
    '-c:a', 'aac', '-movflags', '+faststart', resolve(fixtures, 'movie.mp4')]);
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-i', resolve(fixtures, 'movie.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0',
    '-hls_segment_filename', resolve(fixtures, 'part%d.ts'), resolve(fixtures, 'index.m3u8')]);
  await listen(foreignServer, '127.0.0.1');
  foreignOrigin = `http://127.0.0.1:${foreignServer.address().port}`;
  await listen(server, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  for (const format of cancellationOnly ? [] : ['mp4', 'hls', 'sdr-master', 'live']) {
    const page = await browser.newPage();
    const errors = [], remote = [];
    if (process.env.AVPLAYER_DEBUG) page.on('request', request => console.log('request:', request.url()));
    page.on('console', message => { if (process.env.AVPLAYER_DEBUG) console.log('browser:', message.type(), message.text()); });
    page.on('response', response => { if (response.status() >= 400) console.log('HTTP:', response.status(), response.url()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('blob:')) remote.push(request.url()); });
    await instrument(page);
    await configureVideoDecoder(page);
    await page.goto(origin);
    const capabilities = await page.evaluate(async format => {
      const { createMediaEngine } = await import('/airplay-media.js');
      window.media = createMediaEngine(document.querySelector('#stage'), { fetchResource: (url, init) => fetch(url, init) });
      for (const type of ['loadedmetadata', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'error'])
        media.addEventListener(type, () => evidence.events.push(type));
      await Promise.race([media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=${format === 'mp4' ? 'movie.mp4' : format === 'live' ? 'live.m3u8' : format === 'sdr-master' ? 'mixed.m3u8' : 'index.m3u8'}`,
        format === 'mp4' ? 'video/mp4' : 'application/vnd.apple.mpegurl'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('URL metadata load timed out: '+JSON.stringify(media.getPlaybackDiagnostics()))), 20000))]);
      await Promise.race([media.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('URL play timed out: '+JSON.stringify(media.getPlaybackDiagnostics()))), 20000))]);
      return { crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer, duration: media.duration };
    }, format).catch(async error => { console.log('startup-evidence:', JSON.stringify(await page.evaluate(() => evidence)), 'page-errors:', errors); throw error; });
    assert.equal(capabilities.crossOriginIsolated, false);
    assert.equal(capabilities.sharedArrayBuffer, 'undefined');
    if (format === 'live') assert.equal(capabilities.duration, Infinity, 'no-ENDLIST HLS was classified as VOD');
    else assert.ok(capabilities.duration > 7 && capabilities.duration < 10, JSON.stringify(capabilities));
    await page.waitForFunction(() => media.currentTime > 0.5 && media.videoWidth === 320, null, { timeout: 20000 });
    const first = await page.locator('#stage').screenshot();
    await page.waitForTimeout(500);
    const second = await page.locator('#stage').screenshot();
    assert.notDeepEqual(first, second, `${format}: canvas picture did not change`);
    const pixels = await page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d');
      context.drawImage(image, 0, 0); image.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 40) colored++;
      return colored;
    }, [...second]);
    assert.ok(pixels > 1000, `${format}: canvas remained black`);
    const audioRms = await page.evaluate(() => Math.max(0, ...audioProbes.map(probe => {
      const samples = new Float32Array(probe.fftSize); probe.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    })));
    assert.ok(audioRms > .001 && audioRms < .5, format+': decoded URL tone did not reach the actual Web Audio graph: '+audioRms);
    if (format === 'live') {
      await page.waitForTimeout(2200);
      assert.ok(requests.filter(request => request.resource === 'live.m3u8').length >= 2, 'live HLS playlist did not refresh');
      await page.evaluate(() => media.pause());
      await page.waitForFunction(() => evidence.workers === 0 && evidence.contexts === 0, null, { timeout: 10000 });
      const pausedRequests = requests.length, pausedPosition = await page.evaluate(() => media.currentTime);
      await page.waitForTimeout(1200);
      assert.equal(requests.length, pausedRequests, 'paused live source continued fetching');
      assert.equal(await page.evaluate(() => media.currentTime), pausedPosition);
      await page.evaluate(async () => { await media.play(); });
      assert.ok(requests.length > pausedRequests, 'live resume did not reopen the playlist');
      await page.evaluate(() => media.dispose());
      await page.waitForFunction(() => evidence.workers === 0 && evidence.contexts === 0, null, { timeout: 10000 })
        .catch(async error => { console.log('live-cleanup-evidence:', await page.evaluate(() => evidence)); throw error; });
      const live = await page.evaluate(() => ({ ...evidence, canvases: document.querySelectorAll('#stage canvas').length }));
      assert.equal(live.videoCreates, 0); assert.equal(live.canvases, 0); assert.deepEqual(live.cspViolations, []);
      assert.deepEqual(errors, []); assert.deepEqual(remote, []);
      console.log(JSON.stringify({ format, softwareVideoOverride: SOFTWARE_VIDEO, audioRms, live: true, playlistRefresh: true,
        pauseStopsRequests: true, freshResume: true, rotatingWindowTested: false, cleanup: live }));
      await page.close(); continue;
    }
    const paused = await page.evaluate(() => { media.pause(); return { position: media.currentTime, paused: media.paused }; });
    assert.equal(paused.paused, true);
    await page.waitForTimeout(300);
    assert.ok(Math.abs(await page.evaluate(() => media.currentTime) - paused.position) < 0.1, `${format}: paused clock advanced from ${paused.position} to ${await page.evaluate(() => media.currentTime)}`);
    await page.evaluate(() => { media.currentTime = 4; });
    await page.waitForFunction(() => !media.seeking && Math.abs(media.currentTime - 4) < 0.25);
    await page.evaluate(async () => { await media.play(); });
    await page.waitForFunction(() => media.currentTime > 4.3);
    await page.evaluate(() => { media.currentTime = media.duration - 0.7; });
    await page.waitForFunction(() => media.ended, null, { timeout: 12000 });
    const endedPicture = await page.locator('#stage').screenshot();
    await page.evaluate(async () => { await media.play(); });
    await page.waitForFunction(() => !media.ended && media.currentTime > .3 && media.currentTime < media.duration / 2,
      null, { timeout: 12000 });
    assert.notDeepEqual(endedPicture, await page.locator('#stage').screenshot(), format+': replay did not render new pictures');
    const result = await page.evaluate(async () => {
      const result = { duration: media.duration, position: media.currentTime, canvases: document.querySelectorAll('#stage canvas').length,
        videos: document.querySelectorAll('video').length, ...evidence };
      await media.dispose(); return result;
    });
    assert.deepEqual(result.cspViolations, [], 'playback violated production CSP');
    assert.equal(result.videos, 0);
    assert.equal(result.videoCreates, 0, `${format}: a video element was created, possibly for hidden playback or capability detection`);
    assert.ok(result.canvases > 0);
    assert.ok(result.events.includes('ended'));
    await page.waitForFunction(() => evidence.workers === 0 && evidence.contexts === 0, null, { timeout: 10000 })
      .catch(async error => { console.log('cleanup-evidence:', await page.evaluate(() => evidence)); throw error; });
    assert.equal(await page.locator('#stage canvas').count(), 0, `${format}: dispose retained canvas`);
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, [], 'playback loaded an external asset');
    console.log(JSON.stringify({ format, softwareVideoOverride: SOFTWARE_VIDEO, capabilities, coloredPixels: pixels, audioRms, replayAfterEnded: true, ...result, cleanup: await page.evaluate(() => ({ workers: evidence.workers, contexts: evidence.contexts })) }));
    await page.close();
  }
  const page = await browser.newPage(), networkErrors = [];
  page.on('pageerror', error => networkErrors.push(error.stack || error.message));
  await instrument(page);
  await page.goto(origin);
  if (!cancellationOnly) {
  // Prove the same nested HLS can load cross-origin without the debug proxy policy,
  // then verify the real I/O implementation blocks it when proxy-only is enabled.
  const allowed = await page.evaluate(async () => {
    const { createMediaEngine } = await import('/airplay-media.js');
    const media = createMediaEngine(document.querySelector('#stage'));
    try { await media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=remote.m3u8`, 'application/vnd.apple.mpegurl'); return media.duration; }
    finally { await media.dispose(); }
  });
  assert.ok(allowed > 7 && foreignRequests.length > 0, 'cross-origin HLS control fixture did not load');
  for (const resource of ['remote.m3u8', 'redirect']) {
    foreignRequests.length = 0;
    const blocked = await page.evaluate(async resource => {
      const { createMediaEngine } = await import('/airplay-media.js');
      const media = createMediaEngine(document.querySelector('#stage'), { proxyOnly: true, proxyOrigin: location.origin });
      let rejected = false;
      try { await media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=${resource}`,
        resource.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'); }
      catch { rejected = true; }
      const result = { rejected, error: Boolean(media.error) };
      await media.dispose(); return result;
    }, resource);
    assert.ok(blocked.rejected && blocked.error, 'proxy-only escape did not fail: '+resource);
    assert.deepEqual(foreignRequests, [], 'proxy-only media escaped the Android resource route: '+resource);
  }
  console.log(JSON.stringify({ proxyOnlyNestedHlsBlocked: true, proxyOnlyRedirectBlocked: true }));
  const hdrOnly = await page.evaluate(async () => {
    const { createMediaEngine } = await import('/airplay-media.js');
    const media = createMediaEngine(document.querySelector('#stage'));
    let rejected = false;
    try { await media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=hdr-only.m3u8`, 'application/vnd.apple.mpegurl'); }
    catch { rejected = true; }
    const result = { rejected, error: Boolean(media.error), name: media.error?.name };
    await media.dispose(); return result;
  });
  assert.ok(hdrOnly.rejected && hdrOnly.error, 'all-HDR master did not fail clearly');
  assert.notEqual(hdrOnly.name, 'TimeoutError', 'all-HDR master hung until the outer deadline');
  assert.ok(!requests.some(request => request.resource?.startsWith('forbidden-')),
    'HDR/Dolby/unknown rendition was requested despite an explicit SDR variant');
  console.log(JSON.stringify({ explicitSdrPreferred: true, noHdrRequests: true, hdrOnly }));
  }
  const failure = await page.evaluate(async () => {
    const { createMediaEngine } = await import('/airplay-media.js');
    const media = createMediaEngine(document.querySelector('#stage'), { resourceDeadline: 1000 });
    let errorEvents = 0; media.addEventListener('error', () => errorEvents++);
    let rejected = false;
    try { await media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=broken`); }
    catch { rejected = true; }
    const result = { rejected, errorEvents, error: Boolean(media.error) };
    await media.dispose(); return result;
  });
  assert.ok(failure.rejected || failure.errorEvents > 0);
  assert.equal(failure.error, true);
  const malformed = await page.evaluate(async () => {
    const { createMediaEngine } = await import('/airplay-media.js');
    const media = createMediaEngine(document.querySelector('#stage'));
    let rejected = false;
    try { await media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=malformed.m3u8`, 'application/vnd.apple.mpegurl'); }
    catch { rejected = true; }
    const result = { rejected, error: Boolean(media.error), name: media.error?.name };
    await media.dispose(); return result;
  });
  assert.ok(malformed.rejected && malformed.error, 'malformed HLS did not fail');
  assert.notEqual(malformed.name, 'TimeoutError', 'malformed HLS hung until the outer preparation deadline');
  await page.waitForFunction(() => evidence.workers === 0 && evidence.contexts === 0, null, { timeout: 10000 });
  for (const [resource, type] of [['hang', 'video/mp4'], ['hang', 'application/vnd.apple.mpegurl'],
    ['encrypted.m3u8', 'application/vnd.apple.mpegurl']]) {
    await page.evaluate(async ({ resource, type }) => {
      const { createMediaEngine } = await import('/airplay-media.js');
      window.pendingMedia = createMediaEngine(document.querySelector('#stage'));
      window.pendingLoad = pendingMedia.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=${resource}`, type)
        .then(() => 'resolved', () => 'rejected');
    }, { resource, type });
    for (let i = 0; !pending.size && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(pending.size > 0, 'cancellation case did not reach pending network stage: '+resource+' '+type);
    const canceled = await page.evaluate(async () => {
      await pendingMedia.dispose();
      return Promise.race([pendingLoad, new Promise(resolve => setTimeout(() => resolve('pending'), 5000))]);
    });
    assert.equal(canceled, 'rejected', 'disposing pending load did not reject it');
    for (let i = 0; pending.size && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pending.size, 0, 'disposing pending load did not cancel HTTP: '+resource+' '+type);
    await page.waitForFunction(() => evidence.workers === 0 && evidence.contexts === 0, null, { timeout: 10000 });
    console.log(JSON.stringify({ canceledResource: resource, type, httpClosed: true, workers: 0, contexts: 0 }));
  }
  for (const delay of [0, 20]) {
    const canceled = await page.evaluate(async delay => {
      const { createMediaEngine } = await import('/airplay-media.js');
      const media = createMediaEngine(document.querySelector('#stage'));
      const loading = media.load(`${location.origin}/airplay-resource?c=1234&s=fixture&r=hang`).then(() => 'resolved', () => 'rejected');
      await new Promise(resolve => setTimeout(resolve, delay)); await media.dispose();
      return Promise.race([loading, new Promise(resolve => setTimeout(() => resolve('pending'), 5000))]);
    }, delay);
    assert.equal(canceled, 'rejected', 'early dispose left a pending load');
    await page.waitForFunction(() => evidence.workers === 0 && evidence.contexts === 0, null, { timeout: 10000 })
      .catch(async error => { console.log('early-cancel-evidence:', delay, await page.evaluate(() => evidence)); throw error; });
    for (let i = 0; pending.size && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pending.size, 0, 'early dispose left a network request');
  }
  assert.deepEqual(networkErrors, [], 'network failure or cleanup caused an uncaught browser exception');
  assert.deepEqual(await page.evaluate(() => evidence.cspViolations), []);
  console.log(JSON.stringify({ cancellationOnly, networkFailure: failure, malformedHls: malformed, pendingLoadCanceled: ['MP4 headers', 'HLS master headers', 'HLS AES key', 'early 0/20ms'], requests: requests.length }));
} finally {
  await browser?.close();
  await closeServer(server);
  await closeServer(foreignServer);
  await rm(fixtures, { recursive: true, force: true });
}
