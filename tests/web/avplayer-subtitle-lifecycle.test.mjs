// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const directory = new URL('../../site/play/vendor/libmedia/', import.meta.url);
const subtitleCode = await readFile(new URL('630.avplayer.js', directory), 'utf8');
const demuxCode = await readFile(new URL('upstream.js', directory), 'utf8');
// Extract the pinned generated methods, without requiring build-time npm packages in CI.
function method(source, name) {
  const match = new RegExp(`(?:async )?${name}\\([^)]*\\)\\{`).exec(source);
  assert.ok(match, `generated ${name} method exists`);
  const start = match.index, open = start + match[0].length - 1;
  let depth = 1, quote = null;
  for (let index = open + 1; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`generated ${name} body did not end`);
}
const methods = ['pull', '__tiplayPullPacket', '__tiplayBeforeSeek', 'pause', 'reset', 'start']
  .map(name => method(subtitleCode, name)).join('\n');
const connect = method(demuxCode, 'connectStreamTask');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

async function fixture(codecType = 3) {
  const calls = [], releases = [], memory = new Map();
  const cues = new Map([[64, 'old Chinese caption'], [128, 'HLS caption after seek']]);
  for (const pointer of cues.keys()) { memory.set(pointer + 8, 0n); memory.set(pointer + 48, 30000n); }
  let handler;
  const channel = {
    request(method) {
      const request = { method, ...deferred() };
      calls.push(`send:${method}`);
      // MessagePort delivers messages from one endpoint in send order.
      queueMicrotask(() => { calls.push(`receive:${method}`); void handler(request); });
      return request.promise;
    },
  };
  class IPC {
    constructor() {}
    on(_, callback) { handler = callback; }
    reply(request, value) { calls.push(`reply:${request.method}:${value}`); request.resolve(value); }
  }
  const Demux = runInNewContext(`(class {${connect}})`, { D: { Ay: IPC, S3: 'request' }, M: { Yz() {}, h2() {} }, $: 'fixture' });
  const task = { formatContext: { streams: [{ index: 0, codecpar: { codecType } }] },
    cacheAVPackets: new Map(), cacheRequests: new Map(), rightIPCPorts: new Map(), stats: 0, demuxEnded: false,
    loop: { start() {}, isStarted() { return true; }, resetInterval() {} } };
  const demux = new Demux(); demux.tasks = new Map([['task', task]]);
  demux.replyAVPacket = (actual, port, request, pointer) => { assert.equal(actual, task); port.reply(request, pointer); };
  await demux.connectStreamTask('task', 0, channel);
  const Renderer = runInNewContext(`(class {${methods}})`, {
    n: { f: { 17: offset => memory.get(offset) ?? 0n } },
    o: { M: { 17: (offset, value) => memory.set(offset, value) } }, p: { Mr: value => value }, v: { i0: {} },
    b: { Yz() {} }, k: 'fixture', g: { Qe(pointer) { releases.push(pointer); } },
  });
  const renderer = new Renderer();
  Object.assign(renderer, { ended: false, pulling: false, currentPort: 'task', queue: [],
    leftPorts: new Map([['task', channel]]),
    loop: { running: true, stop() { this.running = false; calls.push('pause'); },
      start() { this.running = true; calls.push('start'); }, isStarted() { return this.running; } },
    render: { clearAll() { calls.push('reset'); } },
    decoder: { flush() { calls.push('flush'); }, decode(pointer) { renderer.queue.push({ text: cues.get(pointer) }); return 0; } },
    avpacketPool: { release(pointer) { releases.push(pointer); } },
  });
  return { renderer, task, demux, channel, calls, releases };
}

function queueFirstSeekPacket(h, pointer = 128) {
  const begin = demuxCode.indexOf('(()=>{const __tiplaySeekTime=');
  const ending = 'return __tiplaySeekTime;})()';
  const end = demuxCode.indexOf(ending, begin);
  assert.ok(begin >= 0 && end > begin, 'actual seek packet handoff exists');
  const source = demuxCode.slice(begin, end + ending.length);
  const [, taskName, streamName] = /;if\(([\w$]+)\.cacheRequests\.has\(([\w$]+)\)\)/.exec(source);
  const packetName = /this\.replyAVPacket\([^;]+,([\w$]+)\);/.exec(source)[1];
  // The packet/control logic is generated code; only its WASM timestamp read is a seam.
  const executable = source.replace(/const __tiplaySeekTime=[\s\S]+?;if/, 'const __tiplaySeekTime=timestamp();if');
  const run = runInNewContext(`(function(){return ${executable};})`, {
    [taskName]: h.task, [streamName]: 0, [packetName]: pointer, timestamp: () => 1350n,
  });
  return run.call({ ...h.demux, doAttachedPicture() {} });
}

test('actual drain releases a pending subtitle pull as retry, leaving the first new cue for after reset', async () => {
  const h = await fixture();
  const oldPull = h.renderer.pull();
  await tick(); assert.equal(h.task.cacheRequests.size, 1);
  const drain = h.renderer.__tiplayBeforeSeek();
  await Promise.all([oldPull, drain]);
  assert.equal(h.task.cacheRequests.size, 0);
  assert.equal(h.renderer.pulling, false); assert.equal(h.renderer.ended, false, 'AGAIN is not subtitle EOF');
  assert.ok(h.calls.indexOf('receive:pull') < h.calls.indexOf('receive:__tiplaySubtitleDrain'));
  assert.ok(h.calls.indexOf('reply:pull:-1048575') < h.calls.indexOf('reset'));
  assert.deepEqual(h.releases, [], 'retry allocates or releases no AVPacket');
  assert.equal(queueFirstSeekPacket(h), 1350n);
  assert.deepEqual(Array.from(h.task.cacheAVPackets.get(0)), [128], 'new first packet was not delivered to the old pull');
  h.renderer.reset(); h.renderer.start(); // The upstream post-seek boundary remains intact.
  await h.renderer.pull();
  assert.deepEqual(h.renderer.queue.map(cue => cue.text), ['HLS caption after seek']);
  assert.deepEqual(h.releases, [128]);
});

test('a late EOF poisons reset/start without drain; the actual handshake settles it before the new generation', async () => {
  const legacy = await fixture(); legacy.task.demuxEnded = true;
  const late = legacy.renderer.pull();
  legacy.renderer.reset(); legacy.renderer.start();
  await late;
  assert.equal(legacy.renderer.ended, true, 'the old ordering reproduces the real stale-EOF failure');

  const h = await fixture(); h.task.demuxEnded = true;
  const old = h.renderer.pull();
  await h.renderer.__tiplayBeforeSeek(); await old;
  h.task.demuxEnded = false;
  queueFirstSeekPacket(h);
  h.renderer.reset(); h.renderer.start();
  await h.renderer.pull();
  assert.equal(h.renderer.ended, false);
  assert.deepEqual(h.renderer.queue.map(cue => cue.text), ['HLS caption after seek']);
  assert.deepEqual(h.releases, [128]);
});

test('an old in-flight packet is consumed before drain reset and cannot overwrite the fresh cue', async () => {
  const legacy = await fixture(); legacy.task.cacheAVPackets.get(0).push(64);
  const late = legacy.renderer.pull(); legacy.renderer.reset(); legacy.renderer.start(); await late;
  assert.deepEqual(legacy.renderer.queue.map(cue => cue.text), ['old Chinese caption'], 'late old packet crosses an unguarded reset');

  const h = await fixture(); h.task.cacheAVPackets.get(0).push(64);
  const old = h.renderer.pull();
  await h.renderer.__tiplayBeforeSeek(); await old;
  assert.deepEqual(h.renderer.queue, [], 'all old packets settled before the reset');
  queueFirstSeekPacket(h);
  h.renderer.reset(); h.renderer.start(); await h.renderer.pull();
  assert.deepEqual(h.renderer.queue.map(cue => cue.text), ['HLS caption after seek']);
  assert.deepEqual(h.releases, [64, 128], 'both real packet paths release exactly once');
});

test('subtitle-only drain does not cancel pending audio or video packet requests', async () => {
  for (const codecType of [0, 1]) {
    const h = await fixture(codecType);
    const pending = h.channel.request('pull'); await tick();
    const request = h.task.cacheRequests.get(0);
    assert.ok(request);
    assert.equal(await h.channel.request('__tiplaySubtitleDrain'), -1048575);
    assert.equal(h.task.cacheRequests.get(0), request, 'audio/video keep their original seek handoff');
    queueFirstSeekPacket(h);
    assert.equal(await pending, 128);
    assert.equal(h.task.cacheRequests.size, 0);
    assert.equal(h.task.cacheAVPackets.get(0).length, 0);
  }
});
