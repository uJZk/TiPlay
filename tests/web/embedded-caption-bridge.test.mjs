import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../../scripts/avplayer/embedded-captions.js', import.meta.url), 'utf8'))
  .replace("import { createEmbeddedCaptionParser } from '../captions/parser.js';", 'const createEmbeddedCaptionParser = null;');
const { createEmbeddedCaptionBridge } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function fixture(factory) {
  let channel, emit;
  const rendered = [], pushed = [], parsed = [], events = [];
  const render = { reset() { rendered.length = 0; }, destroy() { this.destroyed = true; },
    __tiplaySetEmbedded(value) { rendered.splice(0, rendered.length, ...value); },
    __tiplayPushEmbedded(value) { pushed.push(value); }, __tiplayTickEmbedded() {}, start() { this.running = true; },
    stop() { this.running = false; rendered.length = 0; }, pause() { this.running = false; } };
  const player = { taskId: 'video', selectedVideoStream: { index: 1 }, currentTime: 0n,
    getStatus: () => 6, fire: value => events.push(value), __tiplaySetNativeSubtitleEnable(value) { this.nativeEnabled = value; },
    __tiplayCreateEmbeddedSubtitleRender: factory || (() => render) };
  const bridge = createEmbeddedCaptionBridge(player, {
    Channel: class { constructor(name) { this.name = name; channel = this; } close() { this.closed = true; } },
    parserFactory({ onUpdate }) { emit = onUpdate; return { reset() {}, pushTriples(value) { parsed.push(value); for (const t of value) onUpdate({ service: t.type ? 'SERVICE1' : 'CC1', text: String.fromCharCode(t.a), time: t.time }); } }; },
  });
  const options = bridge.options(); bridge.loaded();
  const send = (value = {}) => channel.onmessage({ data: { kind: 'packet', token: options.__tiplayCaptionToken,
    task: 'video', stream: 1, epoch: 0, pts: 1, dts: 1, triples: [{ type: 0, a: 65, b: 0 }], ...value } });
  return { bridge, player, render, rendered, pushed, parsed, events, send, emit: value => emit(value), channel };
}
test('filters owner/stream, reorders PTS, discovers services only from decoded text', async () => {
  const f = fixture();
  f.send({ task: 'audio' }); f.send({ stream: 2 }); f.send({ token: 'retired' });
  assert.equal(f.bridge.list().length, 0);
  f.send({ pts: 2, dts: 0 }); assert.equal(f.parsed.length, 0);
  f.send({ pts: 1, dts: 1, triples: [{ type: 0, a: 66, b: 0 }] });
  assert.equal(f.parsed[0][0].time, 1);
  f.send({ pts: 3, dts: 2, triples: [] }); assert.equal(f.parsed[1][0].time, 2);
  assert.deepEqual(f.bridge.list(), [{ id: 'cea608-1', label: 'CC1', language: '' }]);
  assert.equal(await f.bridge.select('cea608-1'), true);
  assert.equal(f.player.nativeEnabled, false); assert.equal(f.render.running, true);
  f.bridge.native(); assert.equal(f.render.running, false); assert.equal(f.rendered.length, 0);
  f.bridge.destroy(); assert.equal(f.channel.closed, true);
});
test('seek barriers reject queued old epochs, preserve metadata and recover rejected seeks', async () => {
  const f = fixture(); f.send(); await f.bridge.select('cea608-1');
  f.bridge.seek(); assert.equal(f.render.running, false); f.send(); assert.equal(f.pushed.length, 0);
  const ticket = f.bridge.seek(); f.send({ epoch: 1 }); assert.equal(f.pushed.length, 0);
  f.send({ epoch: 2 }); assert.equal(f.pushed.length, 1);
  assert.equal(f.bridge.list().length, 1); f.bridge.finishSeek(ticket); assert.equal(f.render.running, true);
  const rejected = f.bridge.seek(); f.bridge.finishSeek(rejected, true); f.send({ epoch: 2, pts: 2, dts: 2 });
  assert.equal(f.pushed.length, 2);
  f.bridge.destroy();
  const fresh = fixture(); fresh.bridge.seek(); fresh.send(); assert.equal(fresh.parsed.length, 0);
  fresh.send({ epoch: 1 }); assert.equal(fresh.parsed.length, 1); fresh.bridge.destroy();
});
test('rapid selection shares factory without destroying live renderer; off/destroy cancel late work', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const f = fixture(() => pending); f.send(); f.emit({ service: 'SERVICE1', text: '708', time: 1 });
  const first = f.bridge.select('cea608-1'), second = f.bridge.select('cea708-1');
  resolve(f.render); assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(f.render.destroyed, undefined); assert.equal(f.rendered[0].text, '708');
  f.bridge.enable(false); assert.equal(f.render.running, false); f.bridge.destroy();
  let finish; const g = fixture(() => new Promise(r => { finish = r; })); g.send();
  const selection = g.bridge.select('cea608-1'); await Promise.resolve(); g.bridge.destroy(); finish(g.render);
  assert.equal(await selection, false); assert.equal(g.render.destroyed, true);
});
test('bounded malformed data and caption exceptions never fail video or expose text', () => {
  const f = fixture(); f.send({ triples: new Array(4097).fill({ type: 0, a: 65, b: 0 }) });
  f.send({ triples: [{ type: 0, a: 999, b: 0 }] }); assert.equal(f.parsed.length, 0);
  f.send({ pts: 1000, dts: 0 });
  for (let i = 1; i <= 129; i++) f.send({ pts: 1000 + i, dts: i });
  assert.equal(f.parsed.length, 0);
  f.send({ pts: 200, dts: 200 }); assert.equal(f.parsed.length, 1);
  assert.deepEqual(f.bridge.diagnostics(), { services: 1, failure: 'caption-buffer-overflow' });
  f.bridge.destroy(); f.send(); assert.equal(f.parsed.length, 1);
});
test('old seek completion cannot unpause replacement source or newer seek', async () => {
  const f = fixture(); f.send(); await f.bridge.select('cea608-1'); const old = f.bridge.seek();
  f.bridge.stop(); const options = f.bridge.options(); f.bridge.loaded();
  f.send({ token: options.__tiplayCaptionToken }); await f.bridge.select('cea608-1');
  const replacement = f.bridge.seek(); f.bridge.finishSeek(old, true);
  assert.equal(f.render.running, false);
  f.bridge.finishSeek(replacement, true); assert.equal(f.render.running, true); f.bridge.destroy();
});
test('aggregate text budget bounds many services; no-op video choice preserves tracks', async () => {
  const f = fixture(); f.send(); await f.bridge.select('cea608-1'); f.bridge.videoSelected();
  assert.equal(f.bridge.list().length, 1);
  for(let i=0;i<34;i++)f.emit({ service: `SERVICE${i%8+1}`, text:'x'.repeat(8192), time:100+i });
  assert.equal(f.bridge.diagnostics().failure, 'caption-buffer-overflow');
  assert.equal(f.rendered.length, 0);
  f.player.selectedVideoStream={index:3};f.bridge.videoSelected();assert.equal(f.bridge.list().length,0);f.bridge.destroy();
});
