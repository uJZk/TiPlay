#!/usr/bin/env node
// Node 22+, adb, and an open TiPlay tab in an Android Chromium browser are required.
// Example: node scripts/measure_browser_resize.mjs updated --serial DEVICE
// Updated modes temporarily serve this checkout's app.js; the installed APK must already match it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), mode = args[0] || 'inspect';
if (mode === '--help') {
  console.log(`Usage: node scripts/measure_browser_resize.mjs MODE [--serial DEVICE] [--port 19222]
  [--adb PATH] [--timeout-ms 30000] [--output DIRECTORY]
Modes: inspect (read only), baseline, updated, updated-burst.
Updated modes reload the tab with this checkout's app.js; all resize modes require an active iPhone.
Output contains sizes and native timings only. Default: agent_docs/resize-iteration/.
ADB device selection: --serial, ANDROID_SERIAL, then the single connected device.`);
  process.exit(0);
}
const options = new Map();
for (let i = 1; i < args.length; i += 2) {
  if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error('Options need --name value pairs');
  options.set(args[i].slice(2), args[i + 1]);
}
if (!['inspect', 'baseline', 'updated', 'updated-burst'].includes(mode)) {
  throw new Error('Mode must be inspect, baseline, updated, or updated-burst');
}
const known = ['serial', 'port', 'output', 'timeout-ms', 'adb'];
for (const key of options.keys()) if (!known.includes(key)) throw new Error(`Unknown option: ${key}`);
const port = Number(options.get('port') || 19222);
const timeout = Number(options.get('timeout-ms') || 30000);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) {
  throw new Error('Use a valid port and timeout-ms between 1000 and 120000');
}
const executable = options.get('adb') || 'adb';
const command = (...parameters) => {
  try {
    return execFileSync(executable, parameters,
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('ADB operation failed; check --adb, device selection, and authorization');
  }
};
let serial;
const adb = (...parameters) => command('-s', serial, ...parameters);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = resolve(options.get('output') || join(root, 'agent_docs', 'resize-iteration'));
let ws, logcat, lines, socketFailure, logFailure, forwardCreated = false;
let metricsChanged = false, fetchEnabled = false, bypassEnabled = false;
let sequence = 0;
const pending = new Map(), events = [];
let interceptFailure = null;
let pageLoaded = false;

function failPending(error) {
  socketFailure = error;
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
function send(method, params = {}) {
  if (socketFailure || ws?.readyState !== WebSocket.OPEN) return Promise.reject(socketFailure || new Error('CDP socket is closed'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}
async function evaluate(expression) {
  const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error('Browser evaluation failed');
  return value.result.value;
}
const state = () => evaluate(`(() => {
  const stage = document.querySelector('#stage'), stream = document.querySelector('#stream-status');
  const rect = stage?.getBoundingClientRect();
  return { stageHidden: stage?.hidden ?? true, documentHidden: document.hidden,
    playing: Boolean(stage && !stage.hidden && stream?.hidden),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    stage: rect ? { width: rect.width, height: rect.height } : null };
})()`);
async function until(check, label) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (interceptFailure) throw interceptFailure;
    if (logFailure) throw logFailure;
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Convert only recognized timing messages to structured data. Private log payloads are never retained.
function timing(line) {
  const match = line.match(/^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[VDIWEF]\s+[^:]+:\s*(.*)$/);
  if (!match) return null;
  const timeMs = Math.round(Number(match[1]) * 1000), message = match[2];
  let detail;
  if ((detail = message.match(/^Browser link: viewport (\d+)x(\d+)/))) {
    return { timeMs, kind: 'viewport', width: Number(detail[1]), height: Number(detail[2]) };
  }
  if (/; rebuilding stack at \d+x\d+$/.test(message)) {
    return { timeMs, kind: 'rebuild' };
  }
  if ((detail = message.match(/^browser display reconnect retaining wireless transport at (\d+)x(\d+)$/))) {
    return { timeMs, kind: 'displayReconnect', width: Number(detail[1]), height: Number(detail[2]) };
  }
  if (message === 'browser display reconnect replacement first frame') {
    return { timeMs, kind: 'displayFrame' };
  }
  if (message.startsWith('browser display reconnect iAP2 StartSession queued')) {
    return { timeMs, kind: 'displayRequestQueued' };
  }
  if (message.startsWith('browser display reconnect iAP2 StartSession failed')) {
    return { timeMs, kind: 'displayRequestFailed' };
  }
  if (/^browser display reconnect bootstrap (started|ready|StartSession sent|failed)$/.test(message)) {
    return { timeMs, kind: 'displayBootstrap', step: message.slice('browser display reconnect bootstrap '.length) };
  }
  if ((detail = message.match(/teardown resource=AirPlay[^ ]*(?: [^ ]+)* completed=(true|false) elapsedMs=(\d+)$/i))) {
    return { timeMs, kind: 'airplayDetach', completed: detail[1] === 'true', elapsedMs: Number(detail[2]) };
  }
  if ((detail = message.match(/restart teardownWaitCompleted=(true|false) elapsedMs=(\d+)$/))) {
    return { timeMs, kind: 'teardown', completed: detail[1] === 'true', elapsedMs: Number(detail[2]) };
  }
  if ((detail = message.match(/^Web video: stream started size=(\d+)x(\d+) fps=(\d+)$/))) {
    return { timeMs, kind: 'stream', width: Number(detail[1]), height: Number(detail[2]), fps: Number(detail[3]) };
  }
  return null;
}
function summarize(records, width, height) {
  const first = records.find(e => e.kind === 'viewport');
  const rebuild = first && records.find(e => e.kind === 'rebuild' && e.timeMs >= first.timeMs);
  const displayReconnect = first && records.find(e => e.kind === 'displayReconnect' && e.timeMs >= first.timeMs);
  const detach = rebuild && records.find(e => e.kind === 'airplayDetach' && e.timeMs >= rebuild.timeMs);
  const finalViewport = records.findLast(e => e.kind === 'viewport' && e.width === width && e.height === height);
  const stream = finalViewport && records.find(e => e.kind === 'stream' && e.width === width && e.height === height && e.timeMs >= finalViewport.timeMs);
  const frame = stream && records.find(e => e.kind === 'displayFrame' && e.timeMs >= stream.timeMs);
  return { viewportToReconnectAttemptMs: first && (displayReconnect || rebuild) ? (displayReconnect || rebuild).timeMs - first.timeMs : null,
    viewportToRebuildMs: first && rebuild ? rebuild.timeMs - first.timeMs : null,
    rebuildToAirplayDetachMs: rebuild && detach ? detach.timeMs - rebuild.timeMs : null,
    finalViewportToNativeStreamMs: finalViewport && stream ? stream.timeMs - finalViewport.timeMs : null,
    finalViewportToReplacementFrameMs: finalViewport && frame ? frame.timeMs - finalViewport.timeMs : null,
    rebuilds: records.filter(e => e.kind === 'rebuild').length,
    displayReconnects: records.filter(e => e.kind === 'displayReconnect').length };
}

try {
  serial = options.get('serial') || process.env.ANDROID_SERIAL || command('get-serialno').trim();
  if (!serial || serial === 'unknown') throw new Error('Select one connected device with --serial or ANDROID_SERIAL');
  const forwards = adb('forward', '--list').trim().split('\n');
  const existing = forwards.find(line => line.split(/\s+/)[1] === `tcp:${port}`);
  if (existing && existing.trim() !== `${serial} tcp:${port} localabstract:chrome_devtools_remote`) {
    throw new Error('CDP port is already forwarded elsewhere; choose --port');
  }
  if (!existing) { adb('forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote'); forwardCreated = true; }
  let selectedPage;
  await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Cannot list Chrome tabs');
    const pages = (await response.json()).filter(page => page.type === 'page' && page.title === 'TiPlay');
    if (pages.length > 1) throw new Error('Open exactly one TiPlay tab in Android Chrome');
    selectedPage = pages[0];
    return Boolean(selectedPage);
  }, 'one TiPlay tab in Android Chrome');
  ws = new WebSocket(selectedPage.webSocketDebuggerUrl);
  ws.addEventListener('error', () => failPending(new Error('CDP socket failed')));
  ws.addEventListener('close', () => failPending(new Error('CDP socket closed')));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error('CDP command rejected'));
      else entry.resolve(message.result);
    } else if (message.method === 'Page.loadEventFired') {
      pageLoaded = true;
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId } = message.params;
      send('Fetch.fulfillRequest', { requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }],
        body: readFileSync(join(root, 'site', 'play', 'app.js')).toString('base64') })
        .catch(() => { interceptFailure = new Error('Updated app.js interception failed'); });
    }
  });
  if (mode === 'inspect') {
    console.log(JSON.stringify(await state()));
  } else {
    await send('Page.bringToFront');
    await until(async () => !(await state()).documentHidden, 'visible Chrome tab');
    logcat = spawn(executable, ['-s', serial, 'logcat', '-v', 'epoch', '-T', '1',
      'TiPlayBrowserLink:I', 'CarPlayHost:I', 'xcertplay-usb:I', '*:S'], { stdio: ['ignore', 'pipe', 'pipe'] });
    logcat.on('error', () => { logFailure = new Error('Cannot start scoped logcat'); });
    logcat.on('exit', () => { logFailure = new Error('Scoped logcat exited'); });
    logcat.stderr.on('data', () => {});
    lines = createInterface({ input: logcat.stdout });
    lines.on('line', line => { const event = timing(line); if (event) events.push(event); });
    // Let logcat consume its single historical entry before recording a trial.
    await wait(300);
    if (mode.startsWith('updated')) {
      await send('Page.enable');
      await send('Network.enable');
      bypassEnabled = true;
      await send('Network.setBypassServiceWorker', { bypass: true });
      fetchEnabled = true;
      await send('Fetch.enable', { patterns: [{ urlPattern: '*app.js*', requestStage: 'Request' }] });
      pageLoaded = false;
      await send('Page.reload', { ignoreCache: true });
      await until(async () => pageLoaded && await evaluate(`Boolean(document.querySelector('#connect'))`), 'TiPlay page');
    }
    if ((await state()).stageHidden) await evaluate(`document.querySelector('#connect')?.click()`);
    await until(async () => { const current = await state(); return current.playing && !current.documentHidden; }, 'visible playback');
    const results = [];
    mkdirSync(output, { recursive: true });
    for (const height of mode === 'updated-burst' ? [620] : [560, 660, 560]) {
      const index = events.length, started = performance.now();
      metricsChanged = true;
      if (mode === 'updated-burst') {
        for (const transient of [520, 580, 540, 600]) {
          await send('Emulation.setDeviceMetricsOverride', { width: 400, height: transient, deviceScaleFactor: 3, mobile: true });
          await wait(70);
        }
      }
      await send('Emulation.setDeviceMetricsOverride', { width: 400, height, deviceScaleFactor: 3, mobile: true });
      try {
        await until(async () => events.slice(index).some(e => e.kind === 'stream' && e.width === 1200 && e.height === height * 3)
          && (await state()).playing, 'resized native stream and playback');
      } catch (error) {
        const records = events.slice(index);
        const timings = summarize(records, 1200, height * 3);
        results.push({ height, elapsedMs: Math.round(performance.now() - started),
          completed: false, state: await state(), timings, events: records });
        writeFileSync(join(output, `${mode}-results.json`), JSON.stringify(results, null, 2) + '\n');
        console.log(JSON.stringify({ height, completed: false, ...timings }));
        throw error;
      }
      await wait(300);
      const records = events.slice(index);
      const result = { height, elapsedMs: Math.round(performance.now() - started),
        state: await state(), timings: summarize(records, 1200, height * 3), events: records };
      results.push(result);
      writeFileSync(join(output, `${mode}-results.json`), JSON.stringify(results, null, 2) + '\n');
      console.log(JSON.stringify({ height, ...result.timings }));
    }
  }
} catch (error) {
  // Do not expose device identifiers, page addresses, saved pairing data, or raw adb stderr.
  console.error(error instanceof Error && !('stderr' in error) ? error.message : 'ADB operation failed');
  process.exitCode = 1;
} finally {
  const cleanup = [];
  for (const [enabled, method, params] of [
    [metricsChanged, 'Emulation.clearDeviceMetricsOverride', {}],
    [fetchEnabled, 'Fetch.disable', {}],
    [bypassEnabled, 'Network.setBypassServiceWorker', { bypass: false }],
  ]) {
    if (enabled) { try { await send(method, params); } catch { cleanup.push(method); } }
  }
  lines?.close(); logcat?.kill();
  failPending(new Error('Measurement finished'));
  ws?.close();
  if (forwardCreated) { try { adb('forward', '--remove', `tcp:${port}`); } catch { cleanup.push('ADB forwarding'); } }
  if (cleanup.length) { console.error(`Cleanup failed: ${cleanup.join(', ')}. Reopen the Chrome tab to clear CDP overrides.`); process.exitCode = 1; }
}
