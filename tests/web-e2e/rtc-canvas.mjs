// SPDX-License-Identifier: GPL-3.0-only
// Real loopback RTP receive -> production track reader -> Canvas (no video element).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(resolve(root, 'index.html'), 'utf8'))[1];
const server = createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp }); response.end('<!doctype html><title>RTC Canvas check</title>'); return; }
  try {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw Error('Invalid path');
    const bytes = readFileSync(path);
    response.writeHead(200, { 'Content-Type': extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream', 'Content-Security-Policy': csp });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const localTrack = process.argv.includes('--local-track');
  const result = await page.evaluate(async localTrack => {
    const { createRtcMediaTransport, RTC_MAGIC, RTC_HEADER_BYTES, RTC_FRAGMENT_BYTES, RTC_TRANSPORT } = await import('/webrtc-transport.js');
    const { createRtcTrackReader, createRtcVideoPipeline, RTC_VIDEO_TRANSPORT } = await import('/rtc-video.js');
    const { createFramePresenter } = await import('/video.js');
    const { createFrameDelivery } = await import('/transport.js');
    const { encodeRecord, RECORD } = await import('/link.js');
    const until = async predicate => {
      const deadline = performance.now() + 12000;
      while (!predicate()) { if (performance.now() > deadline) throw Error('Timed out waiting for native video Canvas output.'); await new Promise(resolve => setTimeout(resolve, 20)); }
    };
    const results = [];
    const metadata = () => encodeRecord({ kind: RECORD.CONFIG, epoch: 1, payload: new TextEncoder().encode(JSON.stringify({
      mode: 'carplay', codec: 'avc1.42e01f', width: 160, height: 90, fps: 30, videoTransport: RTC_VIDEO_TRANSPORT,
    })) });
    for (const drawing of ['main', 'worker']) {
      const sender = new RTCPeerConnection({ iceServers: [] }), channels = {}, failures = [], messages = [];
      const source = document.createElement('canvas'); source.width = 160; source.height = 90;
      const brush = source.getContext('2d');
      let tick = 0;
      const paint = () => { brush.fillStyle = tick++ % 2 ? '#ff0000' : '#ee1000'; brush.fillRect(0, 0, 160, 90); };
      paint(); const producer = setInterval(paint, 33);
      const stream = source.captureStream(30); sender.addTrack(stream.getVideoTracks()[0], stream);
      sender.ondatachannel = ({ channel }) => {
        channels[channel.label] = channel;
        channel.onmessage = ({ data }) => {
          if (channel.label !== 'control') return;
          const request = JSON.parse(data);
          if (request.k === 'auth') {
            channel.send(JSON.stringify({ q: request.q, app: 'TiPlay', protocol: 1, transport: RTC_TRANSPORT,
              videoTransport: RTC_VIDEO_TRANSPORT, audio: true, clockMs: performance.now(), resourceToken: 'r'.repeat(43) }));
            const record = metadata();
            const bytes = new Uint8Array(RTC_HEADER_BYTES + record.byteLength), header = new DataView(bytes.buffer);
            [RTC_MAGIC, 7, 0, record.byteLength, 0, record.byteLength].forEach((value, index) => header.setUint32(index * 4, value, true));
            bytes.set(record, RTC_HEADER_BYTES); channels.video.send(bytes);
          }
        };
      };
      let worker, pipeline, presenter, trackReader, delivery, drawn = false, samples = 0;
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90; document.body.append(canvas);
      const media = createRtcMediaTransport({ videoTrack: true,
        credentials: () => ({ code: '1234', session: 'canvas-test' }), onError: error => failures.push(error.message),
        exchange: async offer => {
          await sender.setRemoteDescription({ type: 'offer', sdp: offer });
          await sender.setLocalDescription(await sender.createAnswer());
          await until(() => sender.iceGatheringState === 'complete');
          return { type: 'answer', sdp: sender.localDescription.sdp, epoch: 7, fragmentBytes: RTC_FRAGMENT_BYTES, transport: RTC_TRANSPORT };
        },
      });
      try {
        if (!localTrack) await media.connect();
        const videoBody = localTrack ? new ReadableStream({ start(controller) { controller.enqueue(metadata()); } }) : media.video;
        const incomingTrack = localTrack ? stream.getVideoTracks()[0] : media.videoTrack();
        if (drawing === 'worker') {
          worker = new Worker('/decoder-worker.js', { type: 'module' });
          let ready = false;
          delivery = createFrameDelivery(value => worker.postMessage({ type: 'rtc-frame', ...value, generation: 1 }, [value.frame]));
          worker.onmessage = ({ data }) => {
            messages.push(data);
            if (data.type === 'ready') ready = true;
            if (data.type === 'decoded') drawn = true;
            if (data.type === 'rtc-frame-ack') delivery.acknowledge(data.frameId);
          };
          worker.onerror = event => failures.push(event.message);
          await until(() => ready);
          const offscreen = canvas.transferControlToOffscreen();
          worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
          worker.postMessage({ type: 'stream', id: 3, stream: videoBody }, [videoBody]);
          trackReader = createRtcTrackReader({ present: frame => delivery.present(frame, null, 3, null), onError: error => failures.push(error.message) });
        } else {
          presenter = createFramePresenter(canvas, { onFirstPresent: config => { pipeline.presented(config); drawn = true; },
            onPresent: () => {
              const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
              if (gl) { const pixel = new Uint8Array(4); gl.readPixels(80, 45, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); if (pixel[0] > 100 && pixel[1] < 80) samples++; }
              else if (canvas.getContext('2d').getImageData(80, 45, 1, 1).data[0] > 100) samples++;
            } });
          pipeline = createRtcVideoPipeline({ post: message => messages.push(message), present: (frame, config) => presenter.present(frame, config, null) });
          pipeline.read(3, videoBody);
          trackReader = createRtcTrackReader({ present: frame => pipeline.trackFrame(frame), onError: error => failures.push(error.message) });
        }
        trackReader.read(incomingTrack).catch(error => failures.push(error.message));
        await until(() => drawn);
        if (drawing === 'main') await until(() => samples > 0);
        else await until(() => messages.some(value => value.type === 'stats' && value.stats.drawnFrames > 0));
        results.push({ drawing, drawn, pixelSamples: samples, failures, nativeConfig: messages.some(value => value.type === 'config' && value.config.videoTransport === RTC_VIDEO_TRANSPORT),
          videoElements: document.querySelectorAll('video').length, processor: typeof MediaStreamTrackProcessor,
          stats: drawing === 'worker' ? messages.filter(value => value.type === 'stats').at(-1)?.stats : presenter.stats() });
      } finally {
        trackReader?.close(); delivery?.stop(); pipeline?.stop(); presenter?.dispose();
        worker?.postMessage({ type: 'dispose' }); worker?.terminate(); media.close(); sender.close();
        clearInterval(producer); for (const track of stream.getTracks()) track.stop(); canvas.remove();
      }
    }
    return results;
  }, localTrack);
  for (const item of result) {
    assert.equal(item.drawn, true); assert.equal(item.nativeConfig, true); assert.equal(item.videoElements, 0); assert.deepEqual(item.failures, []);
    if (item.drawing === 'main') assert.ok(item.pixelSamples > 0);
    assert.ok(item.stats.drawnFrames > 0);
    console.log(`ok - ${localTrack ? 'local capture track' : 'real WebRTC'} -> Processor -> ${item.drawing} Canvas, ${item.stats.drawnFrames} frames, no video element`);
  }
  assert.deepEqual(errors, []);
  console.log(`all checks passed (${localTrack ? 'local track only, RTP not exercised' : 'desktop loopback'}; no claim of Android passthrough or hardware decoding)`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
