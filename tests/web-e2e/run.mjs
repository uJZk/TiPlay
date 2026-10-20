// SPDX-License-Identifier: GPL-3.0-only
import { History, listen, closeServer } from './resources.mjs';
import { pairingCodeLeaks } from './privacy.mjs';
// End-to-end production-page check against a real browser DataChannel peer and synthetic phone media.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIvf, startFakePhone } from './fake-phone.mjs';

// createRequire honours NODE_PATH, which a bare ESM import does not.
const { chromium } = createRequire(import.meta.url)('playwright-core');

const CODE = '2718';
const WIDTH = 800, HEIGHT = 480, FPS = 30;
const PLAY = fileURLToPath(new URL('../../site/play/', import.meta.url));
// The page must not assume where it is hosted. As published, it is the root of a project site, with the download pages
// beside it in download/.
const PAGE_PATH = '/nested/deeper/';
const DOWNLOAD_PATH = `${PAGE_PATH}download/`;
import { DEFAULT_HOST } from '../../site/play/link.js';
const CHROMIUM = process.env.CHROMIUM ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SOFTWARE_VIDEO = process.env.E2E_SOFTWARE_VIDEO === '1';
// Explicit desktop-test instrumentation only. Production still requests hardware and has no software fallback.
const SOFTWARE_VIDEO_OVERRIDE = `(() => {
  const Native = globalThis.VideoDecoder;
  if (!Native) return;
  globalThis.VideoDecoder = class extends Native {
    static isConfigSupported(config) { return Native.isConfigSupported({ ...config, hardwareAcceleration: 'no-preference' }); }
    configure(config) { super.configure({ ...config, hardwareAcceleration: 'no-preference' }); }
  };
})();`;
async function configureTestDecoder(context) {
  if (!SOFTWARE_VIDEO) return;
  await context.addInitScript(SOFTWARE_VIDEO_OVERRIDE);
  await context.route('**/decoder-worker.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${SOFTWARE_VIDEO_OVERRIDE}\n${await response.text()}` });
  });
}

// Init scripts that take one feature away, to drive the page down its fallback ladder.
const NO_STREAM_TRANSFER = `for (const type of [MessagePort, Worker]) {
  const post = type.prototype.postMessage;
  type.prototype.postMessage = function (message, transfer) {
    if ([].concat(transfer?.transfer ?? transfer ?? []).some(item => item instanceof ReadableStream)) throw new DOMException('refused', 'DataCloneError');
    return post.apply(this, arguments);
  };
}`;
const NO_OFFSCREEN_CANVAS = 'delete HTMLCanvasElement.prototype.transferControlToOffscreen;';
// Init scripts do not reach workers, so this one rewrites the worker module itself (imports still run first).
const noWorkerVideoDecoder = async context => {
  await context.route('**/decoder-worker.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `self.VideoDecoder = undefined;\n${await response.text()}` });
  });
};

function log(message) {
  console.log(`[e2e] ${message}`);
}

async function waitFor(label, predicate, timeout = 15000) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  log(`ok - ${message}`);
}

function ffmpeg(args) {
  return spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args]);
}

/** A two-second test clip as IVF frames from ffmpeg's libvpx, or null when ffmpeg or libvpx is missing. */
function encodeIvf(encoder) {
  if (process.env.E2E_VP8 === 'browser' && encoder === 'libvpx') return null;
  const dir = mkdtempSync(join(tmpdir(), 'tiplay-e2e-'));
  try {
    const clip = join(dir, 'clip.ivf');
    const result = ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`, '-t', '2', '-c:v', encoder,
      '-deadline', 'realtime', '-cpu-used', '8', '-lag-in-frames', '0', '-auto-alt-ref', '0', '-g', String(FPS / 2), '-b:v', '1M', '-f', 'ivf', clip]);
    if (result.status !== 0) {
      log(`ffmpeg with ${encoder} unavailable (${result.error?.message ?? result.stderr.toString().trim()})`);
      return null;
    }
    return parseIvf(readFileSync(clip));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fallback: encode VP8 frames with VideoEncoder in the browser itself. */
async function encodeInBrowser(context, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/blank`);
  const frames = await page.evaluate(async ({ width, height, fps }) => {
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
    const chunks = [];
    const encoder = new VideoEncoder({
      output: chunk => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        let binary = '';
        for (const byte of data) binary += String.fromCharCode(byte);
        chunks.push({ key: chunk.type === 'key', data: btoa(binary) });
      },
      error: error => { throw error; },
    });
    encoder.configure({ codec: 'vp8', width, height, bitrate: 1_000_000, framerate: fps, latencyMode: 'realtime' });
    for (let i = 0; i < fps * 2; i++) {
      context.fillStyle = `hsl(${(i * 6) % 360} 60% 35%)`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#fff';
      context.font = '96px sans-serif';
      context.fillText(String(i), 40, 140);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps / 2) === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();
    return chunks;
  }, { width: WIDTH, height: HEIGHT, fps: FPS });
  await page.close();
  return frames.map(frame => ({ key: frame.key, data: new Uint8Array(Buffer.from(frame.data, 'base64')) }));
}


function startPageServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://page').pathname;
    if (path === '/blank') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>blank</title>');
    if (path === DOWNLOAD_PATH) {
      return res.writeHead(200, { 'Content-Type': 'text/html' })
        .end('<!doctype html><title>download</title><link rel="stylesheet" href="assets/site.css"><p id="download">TiPlay download</p>');
    }
    if (path === `${DOWNLOAD_PATH}assets/site.css`) return res.writeHead(200, { 'Content-Type': 'text/css' }).end('body { color: rgb(1, 2, 3); }');
    const name = path === PAGE_PATH ? 'index.html' : path.startsWith(PAGE_PATH) ? path.slice(PAGE_PATH.length) : null;
    if (!name || name.split('/').some(part => part === '..' || part === '.') || !existsSync(join(PLAY, name)) || !statSync(join(PLAY, name)).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(join(PLAY, name)));
  });
  return listen(server, '127.0.0.1');
}

const eventsOf = (phone, k, from = 0) => phone.events.slice(from).filter(entry => entry.event.k === k);
const stats = page => page.evaluate(() => window.tiplayStats);

/** Taps at (x, y) of the letterboxed picture and returns the touch events the phone received for it. */
async function tap(page, phone, x, y) {
  const rect = await page.evaluate(() => JSON.parse(JSON.stringify(document.getElementById('touch').getBoundingClientRect())));
  const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
  const left = rect.left + (rect.width - WIDTH * scale) / 2, top = rect.top + (rect.height - HEIGHT * scale) / 2;
  const mark = phone.events.length;
  await page.touchscreen.tap(left + x * WIDTH * scale, top + y * HEIGHT * scale);
  return waitFor('a touch down and up', () => {
    const touches = eventsOf(phone, 't', mark).map(entry => entry.event.p);
    return touches.length >= 2 && touches;
  });
}

function checkTap(touches, x, y, label) {
  const near = contact => Math.abs(contact[1] - x) < 0.01 && Math.abs(contact[2] - y) < 0.01;
  const [down, up] = [touches[0], touches.at(-1)];
  check(down.length === 1 && down[0][0] === 0 && down[0][3] === 1 && near(down[0]) && up.length === 1 && up[0][3] === 0 && near(up[0]),
    `${label}: a tap at ${x}/${y} arrives as touch down ${JSON.stringify(down[0])} then up ${JSON.stringify(up[0])}`);
}

/**
 * Sends garbage key frames until the decoder reports the explicit codec error.
 */
async function corruptUntil(phone, page, broken) {
  for (let attempt = 0; attempt < 5; attempt++) {
    phone.corruptNextFrame();
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      if (await broken(page)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('the page took no harm from five garbage frames');
}

/** The canvas backing store must follow the video area; at the default 300 × 150 the picture is blurred and stretched. */
async function checkCanvas(page, label) {
  const expected = await page.evaluate(() => {
    const rect = document.getElementById('stage').getBoundingClientRect();
    return `${Math.round(rect.width * devicePixelRatio)}x${Math.round(rect.height * devicePixelRatio)}`;
  });
  let canvas = null;
  await waitFor('the canvas size', async () => (canvas = (await stats(page)).page.video.canvas) === expected, 3000).catch(() => {});
  check(canvas === expected, `${label}: the canvas backing store is ${canvas} for a ${expected} video area`);
}

/** Opens the page in a fresh context and checks that it decodes on `expected` and maps a tap. */
async function checkPath(browser, url, phone, expected, prepare) {
  const context = await browser.newContext({ viewport: { width: 900, height: 640 }, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' });
  await configureTestDecoder(context);
  if (typeof prepare === 'string') await context.addInitScript(prepare);
  else if (prepare) await prepare(context);
  const page = await context.newPage();
  const mark = phone.events.length;
  await page.goto(url);
  await waitFor(`a dec event on ${expected}`, () => eventsOf(phone, 'dec', mark).length);
  await waitFor(`decoded frames on ${expected}`, async () => (await stats(page)).page.video.decodedFps > 0);
  const { link, video } = (await stats(page)).page;
  check(link.path === expected, `path ${link.path} (${link.fallback}) decodes at ${video.decodedFps} fps with renderer ${video.renderer}`);
  await checkCanvas(page, expected);
  await waitFor(`presentation statistics on ${expected}`, async () => {
    const video = (await stats(page)).page.video;
    return video.currentFps > 0 && video.presentationOffset90 >= 40 &&
      video.presentationOffset90 < 1000 && video.presentationOffsetHigh5 >= video.presentationOffset90;
  });
  check(true, `${expected}: current one-second draw rate and signed scheduled-presentation-to-draw offsets reach the main page`);
  checkTap(await tap(page, phone, 0.6, 0.3), 0.6, 0.3, expected);
  await context.close();
  return link;
}
async function main() {
  let pageServer, browser;
  const phoneServers = [];
  try {
    pageServer = await startPageServer();
    const origin = `http://127.0.0.1:${pageServer.address().port}`;
    // Both the page host and phone protocol server are local test servers.
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--no-proxy-server'] });
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1.5, hasTouch: true, locale: 'en-US' });
    await configureTestDecoder(context);
    if (SOFTWARE_VIDEO) log('EXPLICIT TEST MODE: native WebCodecs hardware hints are overridden to no-preference; this run does not prove hardware video decoding');
    let frames = encodeIvf('libvpx');
    if (frames) log(`encoded ${frames.length} VP8 frames with ffmpeg/libvpx`);
    else {
      frames = await encodeInBrowser(context, origin);
      log(`encoded ${frames.length} VP8 frames with the browser's VideoEncoder`);
    }
    if (!frames[0]?.key) throw new Error('the clip must start with a key frame');
    const peerContext = await browser.newContext({ serviceWorkers: 'block' });
    const rtcPage = await peerContext.newPage();
    await rtcPage.goto(`${origin}/blank`);
    const phone = await startFakePhone({ code: CODE, frames, width: WIDTH, height: HEIGHT, fps: FPS, rtcPage, moduleBase: PAGE_PATH });
    phoneServers.push(phone);
    const failures = new History();
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
    page.on('pageerror', error => failures.push(error.message));
    const pageUrl = `${origin}${PAGE_PATH}?t=127.0.0.1:${phone.port}#c=${CODE}`;
    await page.goto(pageUrl);
    check(await page.evaluate(async () => {
      const wallpaper = new Image();
      wallpaper.src = new URL('reconnect-wallpaper-blurred.png', location.href).href;
      await wallpaper.decode();
      return wallpaper.naturalWidth > 0;
    }), 'the browser loads and decodes the actual wallpaper asset');

    const hardwareSupported = await rtcPage.evaluate(async () => {
      try { return (await VideoDecoder.isConfigSupported({ codec: 'vp8', codedWidth: 800, codedHeight: 480,
        optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' })).supported; } catch (_) { return false; }
    });
    if (!SOFTWARE_VIDEO && !hardwareSupported) {
      await waitFor('an explicit unsupported-hardware configuration', async () => (await stats(page))?.page.video.codecSupported === false);
      const capability = await stats(page);
      check(capability.page.transport.state === 'connected' && capability.page.link.unsupported === 'vp8' && capability.page.video.decoded === 0,
        'an unavailable hardware-requested decoder produces an explicit unsupported state after real RTC delivery');
      check(/cannot decode/.test(await page.textContent('#browser-notice-message')), 'the page explains the unsupported video capability');
      check(!phone.requests.some(request => ['/video', '/audio'].includes(request.path)), 'capability failure opens no hidden legacy media transport');
      phone.assertHistories();
      log('hardware-capability case passed; full playback checks were not run (use a supported decoder or explicit E2E_SOFTWARE_VIDEO=1 test instrumentation)');
      return;
    }

    await waitFor('a dec event', () => eventsOf(phone, 'dec').length).catch(async error => {
      const peer = await rtcPage.evaluate(() => {
        const state = globalThis.__fakeRtc;
        return state && { connection: state.peer.connectionState, ice: state.peer.iceConnectionState,
          channels: Object.fromEntries(Object.entries(state.channels).map(([name, channel]) => [name, channel.readyState])),
          sequence: state.sequence, bytes: state.bytes };
      });
      throw new Error(`${error.message}; page=${JSON.stringify(await stats(page))}; peer=${JSON.stringify(peer)}; source=${JSON.stringify(phone.streamStats)}; bridge=${JSON.stringify(phone.bridgeErrors)}; requests=${JSON.stringify(phone.requests)}`);
    });
    check(eventsOf(phone, 'dec')[0].event.ep === 1, 'the fake phone heard "dec" for epoch 1');
    await waitFor('decoded frames', async () => (await stats(page)).page.video.decodedFps > 0);
    const first = await stats(page);
    check(first.page.transport?.transport === 'webrtc-datachannel-v1' && first.page.transport?.state === 'connected',
      'the complete production page receives compressed media over real reliable DataChannels');
    check(!phone.requests.some(request => ['/video', '/audio'].includes(request.path)), 'normal playback opens no legacy HTTP media stream');
    check(first.page.link.path === 'worker' && first.page.link.fallback === null, 'Chromium takes the Tesla path: worker, transferred stream, OffscreenCanvas');
    check(first.page.video.decodedFps > 0, `decodedFps ${first.page.video.decodedFps} with renderer ${first.page.video.renderer} (${first.page.video.acceleration})`);
    check(pairingCodeLeaks(first, CODE).length === 0, `tiplayStats contains no semantic pairing-code leak (${pairingCodeLeaks(first, CODE).join(', ') || 'none'})`);
    const signaling = phone.requests.filter(request => request.method === 'POST' && request.path.startsWith('/rtc/pair/'));
    check(signaling.length >= 2 && signaling.every(request => !request.secretInUrl &&
      request.signalingFields?.join(',') === (request.path.endsWith('/start') ? 's' : 'A,M1,id,offer,s')),
    'HTTP pairing carries only the permitted PAKE/session/SDP fields and no code');
    check(await page.evaluate(() => location.hash === ''), 'the link fragment was removed from the address');
    check(await page.evaluate(port => location.search === `?t=127.0.0.1:${port}`, phone.port), 'the address bar keeps ?t= so a bookmark reopens this phone');
    check(await page.evaluate(code => JSON.parse(localStorage.getItem('tiplay.link')).code === code, CODE), 'the link was stored');
    check(/VP8 · \d+ fps/.test(await page.textContent('#status')), `status line reads "${await page.textContent('#status')}"`);

    const rect = await page.evaluate(() => JSON.parse(JSON.stringify(document.getElementById('touch').getBoundingClientRect())));
    const viewport = await waitFor('a viewport event', () => eventsOf(phone, 'vp').at(-1)?.event);
    check(viewport.cw === Math.round(rect.width) && viewport.ch === Math.round(rect.height) && viewport.dpr === 1.5 &&
      viewport.w === Math.round(rect.width * 1.5 / 2) * 2 && viewport.h === Math.round(rect.height * 1.5 / 2) * 2,
    `viewport event ${JSON.stringify(viewport)} matches the video area`);
    await checkCanvas(page, 'worker');

    check(await page.locator('header, #fullscreen').count() === 0, 'CarPlay has no header or fullscreen button');
    check(rect.top === 0, 'the CarPlay picture starts at the top of the window');
    const streamsAtPortal = phone.videoCount;
    phone.requestPortal();
    await page.waitForSelector('#panel:not([hidden])');
    check(await page.textContent('#connect') === 'Return to CarPlay', 'TiPlay icon returns to the portal');
    await page.click('#stats-toggle');
    check(await page.getAttribute('#stats-toggle', 'aria-checked') === 'true', 'Debug is a persistent switch');
    await page.click('#connect');
    await page.waitForSelector('#stage:not([hidden])');
    await waitFor('Debug presentation samples', async () => (await stats(page)).page.video.presentationOffsetSamples > 5);
    const debugLayout = await page.evaluate(() => {
      const element = document.getElementById('stats'), rect = element.getBoundingClientRect();
      return { text: element.textContent, x: rect.x + rect.width / 2, y: rect.y,
        inert: getComputedStyle(element).pointerEvents === 'none' };
    });
    const debugLines = debugLayout.text.split('\n');
    check(debugLines[0].split(' · ').length === 4 && debugLines.length === 1 && !debugLayout.text.includes('源预期') && debugLayout.text.includes('ms') &&
      Math.abs(debugLayout.x - 500) < 1 && debugLayout.y <= 16 && debugLayout.inert,
      'Debug has four presentation statistics centered above CarPlay without recording times or intercepted touches');
    check(phone.videoCount === streamsAtPortal, 'returning to CarPlay keeps the same video connection');
    phone.requestPortal();
    await page.waitForSelector('#panel:not([hidden])');
    await page.click('#stats-toggle');
    await page.click('#connect');
    check(await page.locator('#stats').isHidden(), 'turning Debug off hides the overlay and keeps decoding');
    check(phone.videoCount === streamsAtPortal, 'Debug toggles do not replace the video session');
    await page.setViewportSize({ width: 1100, height: 700 });
    await waitFor('resized viewport', () => eventsOf(phone, 'vp').at(-1)?.event.cw === 1100);
    const resized = await page.locator('#stage').boundingBox();
    check(resized.x === 0 && resized.y === 0 && resized.width === 1100 && resized.height === 700,
      'the picture follows the entire resized window');

    checkTap(await tap(page, phone, 0.25, 0.75), 0.25, 0.75, 'worker');

    const st = await waitFor('decoded stats event', () => eventsOf(phone, 'st').map(entry => entry.event)
      .find(event => event.v['video.currentFps'] > 0 && event.v['link.path'] === 'worker'), 8000);
    check(JSON.stringify(st.v).length <= 2048 && st.v['video.currentFps'] > 0 && st.v['link.path'] === 'worker',
      `bounded stats event with ${Object.keys(st.v).length} fields, draw rate and path`);
    check(st.v.themeDark === false, 'periodic decoded stats preserve Boolean browser appearance');

    const decodedBefore = eventsOf(phone, 'dec').length, streamsBefore = phone.videoCount, viewportsBefore = eventsOf(phone, 'vp').length;
    check(await page.locator('#reconnect').isHidden(), 'the reconnect surface is hidden after the first decoded frame');
    await page.route('**/rtc/pair/**', route => route.abort());
    phone.dropVideo();
    await page.waitForSelector('#reconnect:not([hidden])');
    check(await page.textContent('#reconnect-settings') === 'Setting', 'the reconnect action is Setting');
    await page.click('#reconnect-settings');
    await page.waitForSelector('#panel:not([hidden])');
    check((await stats(page)).page.link.phase !== 'ready', 'Setting returns to the pairing portal without stopping the current reconnect');
    check(await page.locator('#reconnect').isHidden() && await page.locator('#disconnect').isVisible(),
      'the portal remains usable while the reconnect continues');
    check(await page.locator('#code').isDisabled() && await page.locator('#host').isDisabled(),
      'the portal preserves the active connection parameters');
    const streamsBeforeResume = phone.videoCount;
    check(await page.textContent('#connect') === 'Return to CarPlay', 'the portal can resume the active reconnect');
    await page.click('#connect');
    await page.waitForSelector('#reconnect:not([hidden])');
    check(phone.videoCount === streamsBeforeResume, 'resuming from the portal does not replace the reconnect session');
    check(await page.locator('#browser-settings, #bar, #fullscreen').count() === 0, 'no redundant modal, playback header or fullscreen control remains');
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await waitFor(`${colorScheme} local appearance while the encrypted channel reconnects`, async () =>
        (await stats(page)).page.themeDark === (colorScheme === 'dark'));
      check(true, `${colorScheme}: appearance updates locally while controls wait for a new authenticated channel`);
      for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 844 }, { width: 640, height: 240 }]) {
        await page.setViewportSize(viewport);
        const layout = await page.evaluate(() => {
          const overlay = document.getElementById('reconnect'), logo = document.getElementById('reconnect-logo');
          const r = overlay.getBoundingClientRect(), l = logo.getBoundingClientRect();
          return { width: r.width, height: r.height, x: r.x, y: r.y, cx: l.x + l.width / 2, cy: l.y + l.height / 2,
            inert: document.getElementById('stage').inert && document.getElementById('panel').inert,
            base: getComputedStyle(overlay).backgroundColor,
            wallpaper: document.getElementById('reconnect-wallpaper').src, blur: getComputedStyle(document.getElementById('reconnect-wallpaper')).filter,
            button: (() => { const r = document.getElementById('reconnect-settings').getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom }; })(),
            message: document.getElementById('reconnect-message').getBoundingClientRect().bottom };
        });
        check(layout.x === 0 && layout.y === 0 && layout.width === viewport.width && layout.height === viewport.height &&
          Math.abs(layout.cx - viewport.width / 2) < 1 && Math.abs(layout.cy - viewport.height / 2) < 1 && layout.inert &&
          layout.button.x <= 20 && layout.button.y > viewport.height / 2 &&
          layout.button.bottom < viewport.height && layout.message < viewport.height,
        `${colorScheme} ${viewport.width}×${viewport.height}: full viewport, centered logo, reachable action and blocked CarPlay input (${JSON.stringify(layout)})`);
        check(layout.base === 'rgb(25, 33, 46)', `${colorScheme}: shared low-luminance material`);
        check(layout.wallpaper.includes('reconnect-wallpaper-blurred.png') && layout.blur === 'none',
          `${colorScheme}: the same pre-rendered wallpaper without a runtime filter`);
      }
    }
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.unroute('**/rtc/pair/**');
    await waitFor('a new RTC media connection', () => phone.videoCount > streamsBefore);
    await waitFor('decoding after the reconnect', () => eventsOf(phone, 'dec').length > decodedBefore);
    check(await page.locator('#reconnect').isHidden(), 'the reconnect surface disappears after recovery decodes a frame');
    const statsAfterRecovery = eventsOf(phone, 'st').length;
    await waitFor('periodic appearance after recovery', () => eventsOf(phone, 'st').slice(statsAfterRecovery)
      .some(entry => entry.event.v['video.currentFps'] > 0 && entry.event.v.themeDark === false), 8000);
    check(true, 'periodic decoded stats keep Boolean appearance after reconnect');
    check(true, `the page renegotiated RTC after the drop (${phone.videoCount} sessions) and decoded again`);
    await waitFor('the viewport after the reconnect', () => eventsOf(phone, 'vp').length > viewportsBefore, 3000).catch(() => {});
    check(eventsOf(phone, 'vp').length > viewportsBefore, 'the page repeats its viewport on the new stream, for a phone that restarted');

    const keyRequests = eventsOf(phone, 'kf').length;
    await corruptUntil(phone, page, async () => (await stats(page)).page.video.decodeErrors > 0);
    const decodedAfterError = (await stats(page)).page.video.decoded;
    await waitFor('decoding after the decoder error', async () => (await stats(page)).page.video.decoded > decodedAfterError + 10);
    check(eventsOf(phone, 'kf').length > keyRequests, 'after a decoder error the page asked for a key frame and decodes again');

    phone.setFit(true);
    phone.requestPortal();
    await page.waitForSelector('#panel:not([hidden])');
    await page.waitForSelector('#fit:not([hidden])', { timeout: 5000 });
    check(await page.textContent('#fit') === 'Apply and reconnect', '"Apply and reconnect" appears when status.fit is true');
    await page.click('#fit');
    await waitFor('a fit event', () => eventsOf(phone, 'fit').length);
    check(true, 'the button sends {"k":"fit"}');
    await page.click('#connect');
    phone.setFit(false);

    const zh = await browser.newContext({ locale: 'zh-CN' });
    const zhPage = await zh.newPage();
    await zhPage.goto(`${origin}${PAGE_PATH}`);
    check(await zhPage.textContent('#connect') === '连接' && await zhPage.getAttribute('html', 'lang') === 'zh-CN', 'a zh-CN browser gets the Chinese page');
    await zh.close();

    // The default phone needs no ?t=, and a pairing link without it is for that phone, whatever was saved before.
    // A *.localhost page host is a secure context separate from the phone.
    const publicOrigin = `http://page.localhost:${pageServer.address().port}`;
    const short = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
    await short.route(/^http:\/\/100\./, route => route.abort());
    const shortPage = await short.newPage();
    const shortState = () => shortPage.evaluate(() => ({
      search: location.search, hash: location.hash, host: JSON.parse(localStorage.getItem('tiplay.link'))?.host,
    }));
    await shortPage.goto(`${publicOrigin}${PAGE_PATH}?t=${DEFAULT_HOST}#c=${CODE}`);
    let state = await shortState();
    check(state.search === '' && state.hash === '' && state.host === DEFAULT_HOST,
      `the default phone leaves just the page address in the address bar (${JSON.stringify(state)})`);
    await shortPage.goto(`${publicOrigin}${PAGE_PATH}?t=100.64.0.1`);
    state = await shortState();
    check(state.search === '?t=100.64.0.1' && state.host === '100.64.0.1:8080', `another phone keeps ?t= (${JSON.stringify(state)})`);
    await shortPage.goto(`${publicOrigin}${PAGE_PATH}#c=${CODE}`);
    state = await shortState();
    check(state.search === '' && state.hash === '' && state.host === DEFAULT_HOST,
      `a pairing link without ?t= is for the default phone, not the one saved before (${JSON.stringify(state)})`);
    await shortPage.goto(`${publicOrigin}${PAGE_PATH}`);
    state = await shortState();
    check(state.search === '' && state.host === DEFAULT_HOST && await shortPage.evaluate(() => window.isSecureContext),
      `the bare page address (a bookmark) keeps the saved phone (${JSON.stringify(state)})`);
    await short.close();

    // Each later rung takes over the display from the page before, as a new session.
    await checkPath(browser, pageUrl, phone, 'worker-chunks', NO_STREAM_TRANSFER);
    await checkPath(browser, pageUrl, phone, 'worker-frames', NO_OFFSCREEN_CANVAS);
    await checkPath(browser, pageUrl, phone, 'main', noWorkerVideoDecoder);
    check(/Another browser took over/.test(await page.textContent('#browser-notice-message')), 'the first page, replaced by the others, says so and stops');
    check(await page.isVisible('#browser-notice'), 'browser takeover is explained in the persistent notification');
    check(!/Another browser took over/.test(await page.textContent('#status')), 'the waiting status does not contain the error explanation');
    await page.click('[data-browser-close]');
    await page.click('#stats-toggle');
    check(!await page.isVisible('#browser-notice'), 'closing the notification survives the next page render');

    // The worker's scope is the site root, which also holds the download pages: it must leave them to the network.
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker activation timed out')), 15000))]));
    const download = await context.newPage();
    const fromWorker = new History();
    download.on('response', response => { if (response.fromServiceWorker()) fromWorker.push(response.url()); });
    const downloaded = await download.goto(`${origin}${DOWNLOAD_PATH}`);
    check(downloaded.ok() && await download.textContent('#download') === 'TiPlay download' &&
      await download.evaluate(() => getComputedStyle(document.body).color) === 'rgb(1, 2, 3)', 'the download page beside the page loads with its stylesheet');
    check(await download.evaluate(() => Boolean(navigator.serviceWorker.controller)) && !fromWorker.length,
      `the page's Service Worker controls the download page but answers none of its requests${fromWorker.length ? `: ${fromWorker.join(', ')}` : ''}`);

    // The cached page opens without the page server; the phone requests still reach the fake phone.
    await closeServer(pageServer);
    const decodedOnline = eventsOf(phone, 'dec').length;
    await page.reload();
    await waitFor('decoding from the cached page', () => eventsOf(phone, 'dec').length > decodedOnline);
    check(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'the page reloaded from the Service Worker cache and decoded again');
    check(await page.evaluate(async () => {
      await import('./videojs-player.js');
      const toolkit = await import('./vendor/mediabunny/mediabunny.min.js');
      return Boolean(customElements.get('video-player') && customElements.get('tiplay-media') && toolkit.Input && toolkit.VideoSampleSink);
    }), 'Video.js controls and the media toolkit load from the offline cache');
    const offline = await download.goto(`${origin}${DOWNLOAD_PATH}`).then(() => null, error => error.message.split('\n')[0]);
    check(offline !== null, `without the page server the download page stays offline (${offline}): the worker never caches it`);
    await download.close();
    // The pairing link opens offline too: the worker ignores the fragment that holds the code.
    const decodedCached = eventsOf(phone, 'dec').length;
    const linked = await context.newPage();
    const relinked = await linked.goto(pageUrl);
    await waitFor('decoding from the pairing link without the page server', () => eventsOf(phone, 'dec').length > decodedCached);
    check(relinked.fromServiceWorker() && await linked.evaluate(() => location.hash === ''),
      'without the page server the pairing link (#c=) opens the cached page, which decodes again');
    await linked.close();

    const unexpected = failures.filter(text => !/Failed to load resource|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|network error/i.test(text));
    check(!unexpected.length, `no unexpected page errors${unexpected.length ? `: ${unexpected.join(' | ')}` : ''}`);
    failures.assertComplete();
    fromWorker.assertComplete();
    for (const server of phoneServers) server.assertHistories();
    check(!phone.bridgeErrors.length, `the synthetic source bridge has no errors${phone.bridgeErrors.length ? `: ${phone.bridgeErrors.join(' | ')}` : ''}`);
    log('all checks passed');
  } finally {
    try { await browser?.close(); } finally {
      try { await Promise.all(phoneServers.map(server => server.close())); } finally { await closeServer(pageServer); }
    }
  }
}

main().catch(error => {
  console.error(`[e2e] FAILED: ${error.message}`);
  process.exitCode = 1;
});
