// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const directory = new URL('../../site/play/vendor/libmedia/', import.meta.url);
const code = await readFile(new URL('upstream.js', directory), 'utf8');
const start = code.indexOf('((url, init) => {');
const end = code.indexOf('\n})', start);
assert.ok(start >= 0 && end > start, 'actual generated fetch adapter exists');
const expression = code.slice(start, end + 3);
function policy() {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url: String(url), init }); return Promise.resolve(new Response('ok')); };
  const adapter = runInNewContext(expression, { URL, Headers, DOMException, fetch,
    location: { href: 'https://receiver.example/play/' } });
  return { adapter, calls };
}

test('AVPlayer proxy policy guards nested resources before fetch and never transmits its marker', async () => {
  const { adapter, calls } = policy();
  const origin = 'http://192.168.1.12:8080';
  const signal = new AbortController().signal;
  await adapter(`${origin}/airplay-resource?c=token&r=segment`, { signal,
    headers: { 'X-TiPlay-Proxy-Origin': origin, Range: 'bytes=0-1023' } });
  assert.equal(calls.length, 1);
  const { init } = calls[0];
  assert.equal(init.headers.get('X-TiPlay-Proxy-Origin'), null);
  assert.equal(init.headers.get('Range'), 'bytes=0-1023');
  assert.equal(init.signal, signal);
  assert.equal(init.redirect, 'error');
  assert.equal(init.targetAddressSpace, 'local');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  for (const url of ['https://cdn.example/segment.ts', `${origin}/other-route`, 'http://192.168.1.13:8080/airplay-resource']) {
    assert.throws(() => adapter(url, { headers: { 'X-TiPlay-Proxy-Origin': origin } }), { name: 'SecurityError' });
  }
  assert.equal(calls.length, 1, 'denied destinations do not initiate requests');
});

test('AVPlayer media fetch preserves upstream Range, abort and normal redirect policy', async () => {
  const { adapter, calls } = policy();
  await adapter('https://cdn.example/movie.mp4', { headers: { Range: 'bytes=20-40' }, redirect: 'follow' });
  assert.equal(calls[0].init.targetAddressSpace, undefined);
  assert.equal(calls[0].init.redirect, 'follow');
  await adapter('http://127.0.0.1:8080/airplay-resource');
  assert.equal(calls[1].init.targetAddressSpace, 'loopback');
});

test('AVPlayer source cancellation reaches upstream fetch without leaking internal options', async () => {
  const { adapter, calls } = policy();
  const source = new AbortController();
  await adapter('https://cdn.example/playlist.m3u8', { __tiplaySourceSignal: source.signal });
  assert.equal(calls[0].init.signal, source.signal);
  assert.equal('__tiplaySourceSignal' in calls[0].init, false);
  const local = new AbortController();
  await adapter('https://cdn.example/segment.ts', { signal: local.signal, __tiplaySourceSignal: source.signal });
  assert.equal(calls[1].init.signal, local.signal, 'upstream per-reader cancellation is preserved');
});

test('AVPlayer worker RPC safely serializes missing and null rejection values', () => {
  const serializers = [...code.matchAll(/\(\{message:typeof ([\w$]+)\?\.message[^}]+\}\)/g)];
  assert.equal(serializers.length, 2, 'class and module worker RPC boundaries');
  for (const [expression, parameter] of serializers) {
    for (const value of [undefined, null, 'opaque rejection', 42]) {
      const result = runInNewContext(expression, { [parameter]: value });
      assert.equal(result.message, 'Media task failed.');
      assert.equal(result.name, 'Error');
    }
    const result = runInNewContext(expression, { [parameter]: new TypeError('Unsupported media') });
    assert.equal(result.message, 'Unsupported media');
    assert.equal(result.name, 'TypeError');
  }
});

const vttCode = await readFile(new URL('790.avplayer.js', directory), 'utf8');
const readerCode = await readFile(new URL('735.avplayer.js', directory), 'utf8');
const readerMethods = [code, readerCode].map(source => source.match(/async readLine\(\)\{[\s\S]+?(?=async peekLine\()/)?.[0]);
const chunkMethod = vttCode.match(/async readChunk\([^)]*\)\{[\s\S]+?(?=async readCue\()/)?.[0];
assert.ok(chunkMethod && readerMethods.every(Boolean), 'actual upstream line/chunk methods exist');
const Chunk = runInNewContext(`(class {${chunkMethod}})`);
function readerFor(method, text, errorCode = -1048576) {
  const Reader = runInNewContext(`(class {${method}})`);
  const reader = new Reader(), bytes = new TextEncoder().encode(text);
  const failure = new Error('IO boundary');
  Object.assign(reader, { buffer: bytes, pointer: 0, endPointer: bytes.length, error: 0,
    getPos() { return BigInt(this.pointer); },
    remainingLength() { return this.endPointer - this.pointer; },
    async readString(length) {
      const text = new TextDecoder().decode(this.buffer.subarray(this.pointer, this.pointer + length));
      this.pointer += length; return text;
    },
    async flush() { this.error = errorCode; throw failure; },
    async peekUint8() { if (this.pointer >= this.endPointer) await this.flush(); return this.buffer[this.pointer]; },
  });
  return { reader, failure };
}

test('actual WebVTT readers retain final cues with no LF, one LF or a blank separator', async () => {
  const cue = '00:00.000 --> 00:30.000\n<b>HLS caption</b>';
  for (const method of readerMethods) {
    for (const ending of ['', '\n', '\n\n']) {
      const { reader } = readerFor(method, cue + ending);
      const chunk = await new Chunk().readChunk({ ioReader: reader });
      assert.equal(chunk.chunk, cue);
      assert.equal(chunk.pos, 0n);
    }
  }
});

test('WebVTT EOF recovery preserves empty EOF, network failures and cancellation', async () => {
  for (const method of readerMethods) {
    for (const [text, code] of [['', -1048576], ['00:00.000 --> 00:30.000\npartial', -1048573],
      ['00:00.000 --> 00:30.000\npartial', -1048572]]) {
      const { reader, failure } = readerFor(method, text, code);
      await assert.rejects(new Chunk().readChunk({ ioReader: reader }), error => error === failure);
    }
  }
});

test('seek satisfies an already pending subtitle pull through the existing packet handoff', () => {
  const start = code.indexOf('(()=>{const __tiplaySeekTime=');
  const ending = 'return __tiplaySeekTime;})()';
  const end = code.indexOf(ending, start);
  assert.ok(start >= 0 && end > start);
  const source = code.slice(start, end + ending.length);
  const identifiers = /;if\(([\w$]+)\.cacheRequests\.has\(([\w$]+)\)\)/.exec(source);
  assert.ok(identifiers);
  const [, taskName, streamName] = identifiers;
  const packetName = /this\.replyAVPacket\([^;]+,([\w$]+)\);/.exec(source)?.[1];
  assert.ok(packetName);
  // Keep the actual dispatch code; stub only the WASM timestamp read.
  const executable = source.replace(/const __tiplaySeekTime=[\s\S]+?;if/, 'const __tiplaySeekTime=timestamp();if');
  for (const pending of [true, false]) {
    const request = {}, port = {}, stream = 9, packet = 64;
    let released = false, replies = 0, starts = 0;
    const task = { stats: 0, cacheRequests: new Map(pending ? [[stream, request]] : []),
      rightIPCPorts: new Map([[stream, port]]), cacheAVPackets: new Map([[stream, []]]), loop: { start() { starts++; } } };
    const run = runInNewContext(`(function(){return ${executable};})`, {
      [taskName]: task, [streamName]: stream, [packetName]: packet, timestamp: () => released ? -1n : 7n,
    });
    const result = run.call({ doAttachedPicture() {}, replyAVPacket(actualTask, actualPort, actualRequest, actualPacket) {
      assert.equal(actualTask, task); assert.equal(actualPort, port); assert.equal(actualRequest, request);
      assert.equal(actualPacket, packet); replies++; released = true;
    } });
    assert.equal(result, 7n, 'timestamp is captured before the handoff may release the packet');
    assert.equal(replies, pending ? 1 : 0);
    assert.equal(task.cacheRequests.size, 0);
    assert.deepEqual(task.cacheAVPackets.get(stream), pending ? [] : [packet]);
    assert.equal(starts, 1);
  }
});

const subtitleCode = await readFile(new URL('630.avplayer.js', directory), 'utf8');
const subtitlePull = subtitleCode.match(/async __tiplayPullPacket\(\)\{if\(this\.pulling[\s\S]+?(?=getDemuxerPort\()/)?.[0];
const subtitlePullWrapper = subtitleCode.match(/pull\(\)\{if\(this\.pulling\)return this\.__tiplayPullDone;[\s\S]+?(?=async __tiplayBeforeSeek\()/)?.[0];
assert.ok(subtitlePull && subtitlePullWrapper, 'actual SubtitleRender pull implementation exists');
test('subtitle worker packets deserialize through the existing helper and release exactly once', async () => {
  for (const pooled of [true, false]) for (const mode of ['object','pointer','eof','request-error','decode-error','deserialize-error']) {
    const memory = new Map([[72,0n],[112,30000n]]), pointer = 64, failure = new Error(mode);
    let allocations = 0, releases = 0, deserializations = 0, decodes = 0;
    const read = offset => { assert.equal(typeof offset, 'number', 'CType reads require a local pointer'); return memory.get(offset) ?? 0n; };
    const write = (offset, value) => { assert.equal(typeof offset, 'number'); memory.set(offset, value); };
    const allocate = () => { allocations++; return pointer; };
    const release = actual => { assert.equal(actual, pointer); releases++; };
    const serialized = { pts:0n, duration:30000n, timeBase:{num:1,den:1000}, data:new Uint8Array([65]), sideData:[] };
    const Pull = runInNewContext(`(class {${subtitlePull}${subtitlePullWrapper}})`, {
      n:{f:{17:read}}, o:{M:{17:write}}, p:{Mr:value=>value}, v:{i0:{}}, b:{Yz(){}}, k:'fixture',
      g:{_5:allocate,Qe:release},
      __tiplayUnserializePacket(packet, actual) {
        assert.equal(packet, serialized); assert.equal(actual,pointer); deserializations++;
        if(mode==='deserialize-error')throw failure;
        memory.set(pointer+8,packet.pts); memory.set(pointer+48,packet.duration); return actual;
      },
    });
    const renderer = new Pull();
    Object.assign(renderer, { pulling:false, ended:false, currentPort:'subtitle', loop:{},
      leftPorts:new Map([['subtitle',{request:async()=>{
        if(mode==='request-error')throw failure;
        return mode==='eof' ? -1048576 : mode==='pointer' ? pointer : serialized;
      }}]]),
      avpacketPool:pooled?{alloc:allocate,release}:undefined,
      decoder:{flush(){},decode(actual){assert.equal(actual,pointer);decodes++;if(mode==='decode-error')throw failure;return 0;}},
    });
    if(mode.endsWith('error'))await assert.rejects(renderer.pull(),error=>error===failure);
    else await renderer.pull();
    assert.equal(renderer.pulling,false,'finally clears the in-flight state');
    const ownsPacket=!['eof','request-error'].includes(mode);
    assert.equal(releases,ownsPacket?1:0,`${mode}: exactly one release`);
    assert.equal(allocations,ownsPacket && mode!=='pointer'?1:0);
    assert.equal(deserializations,ownsPacket && mode!=='pointer'?1:0);
    assert.equal(decodes,ownsPacket && mode!=='deserialize-error'?1:0);
  }
});

const hlsCode = await readFile(new URL('272.avplayer.js', directory), 'utf8');
const sdrStart = hlsCode.indexOf('((playlist)=>{');
const sdrEnd = hlsCode.indexOf('\n})', sdrStart);
assert.ok(sdrStart >= 0 && sdrEnd > sdrStart);
const selectSdr = runInNewContext(hlsCode.slice(sdrStart,sdrEnd+3), { DOMException });
test('HLS selection rejects declared HDR/Dolby and prefers explicit SDR before opening a variant', () => {
  const sdr = {videoRange:'SDR',codecs:'avc1.42000c'}, unknown = {codecs:'hvc1.1.6.L120'};
  const hdr = [{videoRange:'PQ'},{videoRange:'HLG'},{videoRange:'SDR',codecs:'dvhe.05.06,mp4a.40.2'},
    {videoRange:'SDR',codecs:'DVA1.00.00'}, {codecs:'dvh1.08.06'}];
  const playlist = {variants:[...hdr,unknown,sdr]};
  assert.equal(selectSdr(playlist),playlist);
  assert.deepEqual(playlist.variants,[sdr]);
  const unlabelled = {variants:[unknown]};
  selectSdr(unlabelled); assert.deepEqual(unlabelled.variants,[unknown]);
  assert.throws(()=>selectSdr({variants:hdr}),error=>error.name==='NotSupportedError' && error.__tiplaySdrRequired===true);
});

test('AVPlayer shipped assets match the recorded build and unmodified WASM source pins', async () => {
  const manifest = JSON.parse(await readFile(new URL('artifacts.json', directory), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../../scripts/avplayer/wasm.lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.commit, lock.commit);
  for (const artifact of manifest.artifacts) {
    const data = await readFile(new URL(artifact.path, directory));
    const hash = createHash('sha256').update(data).digest('hex');
    assert.equal(data.length, artifact.bytes, artifact.path);
    assert.equal(hash, artifact.sha256, artifact.path);
    if (artifact.path.endsWith('.wasm')) {
      assert.equal(hash, lock.assets.find(asset => asset.path === artifact.path)?.sha256, artifact.path);
      assert.ok(WebAssembly.validate(data), artifact.path);
    }
  }
  assert.equal(manifest.sameOriginWorkletPatches, 1);
  assert.equal(manifest.hlsClassificationPatches, 3);
  assert.equal(manifest.cancellationPatches, 6);
  assert.equal(manifest.pipelineCleanupPatches, 1);
  assert.equal(manifest.contextEventGuardPatches, 1);
  assert.equal(manifest.rpcErrorSerializerPatches, 2);
  assert.equal(manifest.subtitleEofPatches, 3);
  assert.equal(manifest.pendingSeekReplyPatches, 1);
  assert.equal(manifest.subtitlePacketBridgePatches, 1);
  assert.equal(manifest.subtitlePacketReleasePatches, 4);
  assert.equal(manifest.subtitleDrainPatches, 3);
  assert.equal(manifest.subtitleSeekPatches, 3);
  assert.equal(manifest.sdrVariantPolicyPatches, 3);
});
