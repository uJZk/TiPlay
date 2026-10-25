#!/usr/bin/env node
// Node 22+. Attach to an existing Chromium; never reload or change playback.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/measure_carplay_cpu.mjs --endpoint http://127.0.0.1:9222 [--seconds 30] [--target TARGET_ID] [--output /tmp/carplay-cpu]');
  process.exit(0);
}
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--endpoint', '--seconds', '--target', '--output'].includes(args[i]) || !args[i + 1]) throw Error('Invalid option; use --help');
  options.set(args[i], args[i + 1]);
}
const endpoint = options.get('--endpoint');
const seconds = Number(options.get('--seconds') || 30);
if (!endpoint || !Number.isFinite(seconds) || seconds < 1 || seconds > 300) throw Error('Supply --endpoint and seconds in [1, 300]');
const output = resolve(options.get('--output') || '/tmp/carplay-cpu');
const get = async path => {
  const response = await fetch(new URL(path, endpoint), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`CDP discovery failed: ${response.status}`);
  return response.json();
};
const [version, targets] = await Promise.all([get('/json/version'), get('/json/list')]);
const pages = targets.filter(t => t.type === 'page' && (options.has('--target')
  ? t.id === options.get('--target') : /TiPlay/i.test(t.title) || /\/play(?:\/|$)/.test(new URL(t.url).pathname)));
if (pages.length !== 1) throw Error('Select exactly one TiPlay page with --target TARGET_ID');
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((yes, no) => { socket.onopen = yes; socket.onerror = no; });
let next = 0;
const pending = new Map(), sessions = new Map(), preparations = new Set(), warnings = [];
function send(method, params = {}, sessionId) {
  return new Promise((yes, no) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); no(Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { yes, no, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.error) call.no(Error(message.error.message)); else call.yes(message.result);
  } else if (message.method === 'Target.attachedToTarget') {
    const { sessionId, targetInfo } = message.params;
    if (targetInfo.type !== 'worker') return;
    const task = prepare(sessionId, targetInfo).catch(error => warnings.push(`Worker unavailable: ${error.message}`));
    preparations.add(task); task.finally(() => preparations.delete(task));
  }
};
socket.onclose = () => {
  for (const call of pending.values()) { clearTimeout(call.timer); call.no(Error('CDP disconnected')); }
  pending.clear();
};
async function prepare(sessionId, info) {
  const entry = { sessionId, type: info.type, script: scriptName(info.url), started: false };
  sessions.set(sessionId, entry);
  await send('Profiler.enable', {}, sessionId);
  await send('Profiler.setSamplingInterval', { interval: 1000 }, sessionId);
  await send('Profiler.start', {}, sessionId);
  entry.started = true;
}
function scriptName(url) {
  try { return new URL(url).pathname.split('/').pop() || '(page)'; } catch { return '(native)'; }
}
function summarize(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const buckets = new Map();
  const durationUs = profile.endTime - profile.startTime;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const node = nodes.get(profile.samples[i]);
    const fn = node?.callFrame;
    const name = fn?.url ? scriptName(fn.url) : fn?.functionName || '(unknown)';
    buckets.set(name, (buckets.get(name) || 0) + (profile.timeDeltas?.[i] || 0));
  }
  return { durationMs: durationUs / 1000, components: [...buckets].map(([component, us]) => ({ component,
    sampledMs: us / 1000, sampledWallPercent: durationUs > 0 ? us / durationUs * 100 : null,
  })).sort((a, b) => b.sampledMs - a.sampledMs) };
}
let main;
try {
  main = (await send('Target.attachToTarget', { targetId: pages[0].id, flatten: true })).sessionId;
  await prepare(main, { type: 'page', url: pages[0].url });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, main);
  await Promise.all([...preparations]);
  await send('Performance.enable', {}, main);
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics', {}, main)).metrics.map(m => [m.name, m.value]));
  // Deliberately retain only media counters, never status/phone/pairing payloads.
  const mediaStats = async () => {
    const result = await send('Runtime.evaluate', { expression: 'JSON.stringify({audio: window.tiplayStats?.page?.audio, video: window.tiplayStats?.page?.video})', returnByValue: true }, main);
    return result.exceptionDetails ? null : JSON.parse(result.result.value || 'null');
  };
  const before = { metrics: await metrics(), media: await mediaStats() };
  console.log(`Sampling ${seconds}s; keep CarPlay playing in the selected tab.`);
  await new Promise(done => setTimeout(done, seconds * 1000));
  const after = { metrics: await metrics(), media: await mediaStats() };
  if (before.media?.video?.mode !== 'carplay' || after.media?.video?.mode !== 'carplay')
    warnings.push('Active CarPlay was not established at both boundaries; this is not a verified CarPlay load measurement.');
  if (!(after.media?.audio?.timedPackets > before.media?.audio?.timedPackets))
    warnings.push('No increase in timed audio packets; sustained audio playback was not established.');
  await Promise.all([...preparations]);
  await mkdir(output, { recursive: true });
  const threads = [];
  for (const [sessionId, entry] of sessions) {
    if (!entry.started) continue;
    try {
      const { profile } = await send('Profiler.stop', {}, sessionId);
      entry.started = false;
      const filename = `thread-${threads.length}.cpuprofile`;
      // Profiles contain source locations; no source code or runtime argument values.
      await writeFile(join(output, filename), JSON.stringify(profile));
      threads.push({ type: entry.type, script: entry.script, profile: filename, ...summarize(profile) });
    } catch (error) { warnings.push(`Stopped/disappeared thread: ${entry.script}: ${error.message}`); }
  }
  const elapsed = after.metrics.Timestamp - before.metrics.Timestamp;
  const taskSeconds = after.metrics.TaskDuration - before.metrics.TaskDuration;
  const report = { browser: version.Browser, requestedSeconds: seconds,
    mainThreadTaskPercent: elapsed > 0 ? taskSeconds / elapsed * 100 : null,
    before: before.media, after: after.media, threads, warnings,
    limitations: ['Sampled wall time is not OS CPU utilization; idle, GC and native frames remain separate.',
      'AudioWorklet, native codec, WebRTC internal threads, GPU and compositor CPU are unmeasured.',
      'Profiler overhead is included. Worker profiles can cover different intervals. Compare repeated runs.',
      'CPU correlation and underrun counters do not establish an audible crackle cause.'], };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const [sessionId, entry] of sessions) {
    if (entry.started) await send('Profiler.stop', {}, sessionId).catch(() => {});
  }
  if (main) await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, main).catch(() => {});
  socket.close();
}
