// SPDX-License-Identifier: GPL-3.0-only
// JVM compatibility-server checks. Production playback is verified by run.mjs and webrtc.mjs.
// RealPhone has no Android native WebRTC implementation; the production page must reject it.
import { History, listen, closeServer } from './resources.mjs';
import { RecordParser, RECORD, FLAG } from '../../site/play/link.js';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CODE = '2718', WIDTH = 1280, HEIGHT = 720, FPS = 30;
const CHROMIUM = process.env.CHROMIUM ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const JAVA = process.env.JAVA ?? 'java', FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const PAGE_DIR = process.env.PAGE_DIR ?? join(ROOT, 'site/play');
const SHARED_CLASSES = process.env.SHARED_CLASSES ?? join(ROOT, 'shared/build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes');

function log(message) {
  console.log(`[phone-e2e] ${message}`);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  log(`ok - ${message}`);
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The Kotlin standard library jar of the version the build uses, from the Gradle cache. */
function kotlinStdlib() {
  if (process.env.KOTLIN_STDLIB) return process.env.KOTLIN_STDLIB;
  const version = /^kotlin\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, 'gradle/libs.versions.toml'), 'utf8'))?.[1];
  const base = join(process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'), 'caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib', version ?? '');
  for (const hash of existsSync(base) ? readdirSync(base) : []) {
    const jar = join(base, hash, `kotlin-stdlib-${version}.jar`);
    if (existsSync(jar)) return jar;
  }
  throw new Error(`kotlin-stdlib ${version} not found under ${base}; set KOTLIN_STDLIB`);
}

/** A three-second 1280×720 H.264 clip (Annex-B, AUDs, an IDR every second), or null without ffmpeg/libx264. */
function encodeClip(dir) {
  const clip = join(dir, 'clip.h264');
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,
    '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', '1500k', '-pix_fmt', 'yuv420p',
    '-x264-params', `aud=1:keyint=${FPS}:min-keyint=${FPS}:scenecut=0`, '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', clip]);
  if (result.status !== 0) {
    log(`ffmpeg with libx264 unavailable (${result.error?.message ?? result.stderr.toString().trim()}); hand-made SPS/PPS and slices`);
    return null;
  }
  return clip;
}

/** Starts RealPhone.java and collects its JSON events. */
async function startPhone(clip) {
  for (const path of [SHARED_CLASSES, PAGE_DIR]) if (!existsSync(path)) throw new Error(`${path} is missing; build :shared first (see README.md)`);
  const args = ['-cp', `${SHARED_CLASSES}:${kotlinStdlib()}`, join(ROOT, 'tests/web-e2e/RealPhone.java'), '--port', '0',
    '--bind', '0.0.0.0', '--code', CODE, '--width', String(WIDTH), '--height', String(HEIGHT), '--fps', String(FPS)];
  if (clip) args.push('--clip', clip);
  const child = spawn(JAVA, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const events = new History(), stderr = new History();
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      events.push(JSON.parse(line));
    } catch (_) {
      stderr.push(line);
    }
  });
  createInterface({ input: child.stderr }).on('line', line => { if (!line.startsWith('Picked up JAVA_TOOL_OPTIONS')) stderr.push(line); });
  const exited = new Promise(resolve => {
    child.once('exit', code => resolve(code));
    child.once('error', error => { stderr.push(error.message); resolve(-1); });
  });
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!child.stdin.destroyed) child.stdin.end('quit\n');
    let timer;
    try {
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
    } finally { clearTimeout(timer); }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
  // Handle a closed stdin as a child failure rather than an unhandled stream error.
  child.stdin.on('error', error => stderr.push(error.message));
  let startupFinished = false;
  try {
    const listening = await Promise.race([
      waitFor('RealPhone to listen', () => {
        if (startupFinished) throw new Error('RealPhone startup ended');
        return events.find(event => event.event === 'listening');
      }, 60000),
      exited.then(code => { throw new Error(`RealPhone exited with ${code}: ${stderr.join('\n')}`); }),
    ]);
    return {
      port: listening.port, events, stderr,
      command: line => child.stdin.write(`${line}\n`),
      since: (mark, name) => events.slice(mark).filter(event => event.event === name),
      logs: mark => events.slice(mark).filter(event => event.event === 'log').map(event => event.message),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  } finally { startupFinished = true; }

}

async function checkProtocolOnly(origin) {
  for (const path of ['/', '/play', '/play/', '/play/app.js', '/play/sw.js', '/play/reconnect-wallpaper-blurred.png']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    check(response.status === 404 && !response.headers.has('location') &&
      await response.json().then(value => value.error === 'not-found'), `${path} no longer serves or redirects to a bundled page`);
  }
  const hello = await fetch(`${origin}/hello`);
  check(hello.headers.get('cache-control') === 'no-store' &&
    await hello.json().then(value => value.app === 'TiPlay' && value.protocol === 1 && Number.isFinite(value.clockMs)), '/hello keeps no-store and names TiPlay protocol 1');
  const foreignHost = await rawStatus(origin, 'GET /hello HTTP/1.1\r\nHost: tiplay.example\r\nConnection: close\r\n\r\n');
  check(foreignHost === 421, `a protocol request for Host tiplay.example answers ${foreignHost} (DNS-rebinding defence)`);
}

/** Sends a raw request and returns the response status. */
function rawStatus(origin, request) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    let text = '';
    const socket = connect(Number(port), hostname, () => socket.end(request));
    socket.setEncoding('latin1');
    socket.on('data', chunk => { text += chunk; });
    socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1])));
    socket.on('error', reject);
  });
}

function startPageHost() {
  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png' };
  const server = createServer((req, res) => {
    const name = new URL(req.url, 'http://page').pathname.slice(1) || 'index.html';
    const file = resolve(PAGE_DIR, name);
    if (!file.startsWith(resolve(PAGE_DIR) + sep) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[name.split('.').pop()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  });
  return listen(server, '0.0.0.0');
}

async function readLegacyRecords(origin, session) {
  const response = await fetch(`${origin}/video?c=${CODE}&s=${session}&codecs=avc1&timing=1`, { signal: AbortSignal.timeout(10000) });
  check(response.status === 200, 'the explicit compatibility API accepts authenticated compressed-video subscription');
  const reader = response.body.getReader(), parser = new RecordParser(), records = [];
  try {
    while (records.filter(record => record.kind === RECORD.FRAME).length < 8) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('compatibility stream ended before the expected records');
      records.push(...parser.push(chunk.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return records;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'tiplay-phone-e2e-'));
  let phone, browser, pageHost;
  try {
    phone = await startPhone(encodeClip(dir));
    const origin = `http://127.0.0.1:${phone.port}`, session = 'legacy_e2e_session_01';
    await checkProtocolOnly(origin);
    const hello = await fetch(`${origin}/hello`).then(response => response.json());
    check(hello.transport === 'http-records-v1', 'the JVM fixture explicitly identifies its compatibility transport');
    const control = (q, events) => fetch(`${origin}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: CODE, s: session, q, e: events }), signal: AbortSignal.timeout(5000) });
    const denied = await fetch(`${origin}/video?c=0000&s=${session}`);
    check(denied.status === 401, 'the compatibility API rejects an incorrect pairing code');
    const first = await readLegacyRecords(origin, session);
    const configuration = first.find(record => record.kind === RECORD.CONFIG);
    const info = JSON.parse(new TextDecoder().decode(configuration.payload));
    check(info.codec.startsWith('avc1.') && info.width === WIDTH && info.height === HEIGHT, 'real shared code preserves H.264 configuration and dimensions');
    const key = first.find(record => record.kind === RECORD.FRAME);
    const nalTypes = bytes => {
      const result = [];
      for (let offset = 0; offset + 4 < bytes.length; offset++) if (bytes[offset] === 0 && bytes[offset + 1] === 0 && bytes[offset + 2] === 0 && bytes[offset + 3] === 1) {
        result.push(bytes[offset + 4] & 31); offset += 3;
      }
      return result;
    };
    const types = nalTypes(key.payload);
    check(Boolean(key.flags & FLAG.KEY) && types[0] === 7 && types[1] === 8 && types.slice(2).every(type => type === 5),
      'the first compatibility AU contains unchanged Annex-B SPS, PPS and IDR slices');
    check(first.some(record => record.kind === RECORD.TIMING), 'source presentation reference remains a separate timing record');
    const mark = phone.events.length;
    await control(1, [{ k: 'vp', w: 1280, h: 720, cw: 1280, ch: 720, dpr: 1 }, { k: 't', p: [[0, 0.25, 0.75, 1]] }]);
    await control(2, [{ k: 't', p: [[0, 0.25, 0.75, 0]] }, { k: 'dec', ep: configuration.epoch }, { k: 'kf' }]);
    await waitFor('compatibility callbacks', () => phone.since(mark, 'touch').length >= 2);
    check(phone.since(mark, 'viewport').length > 0 && phone.since(mark, 'touch').length >= 2, 'explicit legacy controls preserve viewport and down/up ordering');
    const unavailable = await fetch(`${origin}/rtc`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: CODE, s: session, offer: 'v=0\r\n' }) });
    check(unavailable.status === 503 && (await unavailable.json()).error === 'rtc-unavailable', 'the JVM server reports absent Android native RTC instead of faking an answer');
    const restart = phone.events.length; phone.command('restart');
    await waitFor('next source session', () => phone.since(restart, 'restarted').length);
    const next = await readLegacyRecords(origin, session);
    check(next.find(record => record.kind === RECORD.CONFIG).epoch > configuration.epoch, 'a new source owner retires the previous compressed-media epoch');
    const ended = await fetch(`${origin}/bye`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: CODE, s: session }) });
    check(ended.status === 204, 'explicit compatibility-owner departure releases the session');

    pageHost = await startPageHost();
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--no-proxy-server'] });
    const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
    const page = await context.newPage(), requests = new History(), errors = new History();
    page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${pageHost.address().port}/?t=127.0.0.1:${phone.port}#c=${CODE}`);
    await waitFor('explicit protocol mismatch notice', async () => /does not match this page/.test(await page.textContent('#browser-notice-message')));
    check(!requests.some(request => ['/video', '/audio', '/rtc'].includes(new URL(request.url).pathname)), 'the production page rejects a server without RTC and opens no compatibility media stream');
    check(await page.evaluate(() => location.hash === ''), 'pairing credentials are removed from the address bar even on a protocol mismatch');
    check(!errors.length, `protocol mismatch has no unhandled page error${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    requests.assertComplete(); errors.assertComplete();
    await context.close();
    const output = JSON.stringify(phone.events);
    check(!output.includes(CODE) && !output.includes(session), 'shared server diagnostics omit pairing code and browser owner token');
    phone.events.assertComplete(); phone.stderr.assertComplete();
    log('all checks passed (compatibility server and production rejection only; Android native RTC is outside this JVM harness)');
  } finally {
    try { await browser?.close(); } finally {
      try { await phone?.close(); } finally {
        try { await closeServer(pageHost); } finally { rmSync(dir, { recursive: true, force: true }); }
      }
    }
  }
}
main().catch(error => { console.error(`[phone-e2e] FAILED: ${error.message}`); process.exitCode = 1; });
