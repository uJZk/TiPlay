import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewportFor } from '../../site/play/link.js';

const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const schedule = extract('scheduleViewport');
const cancel = extract('cancelViewport');

function page(probe = () => new Promise(() => {}), audioProbe = () => Promise.resolve(0x3fffc)) {
  let next = 0;
  const frames = new Map(), sent = [];
  const requestAnimationFrame = run => {
    const id = ++next;
    frames.set(id, run);
    return id;
  };
  const cancelAnimationFrame = id => frames.delete(id);
  const rect = { width: 1280, height: 720 };
  const stage = { hidden: false, getBoundingClientRect: () => rect };
  const outbox = { push: (event, mode) => sent.push({ event, mode }) };
  const p = new Function('stage', 'outbox', 'window', 'viewportFor', 'requestAnimationFrame', 'cancelAnimationFrame', 'probeMirrorCapabilities', 'probeMirrorAudioFormats', `
    let viewportFrame = null, lastViewport = '';
    ${schedule}
    ${cancel}
    return { scheduleViewport, cancelViewport,
      disconnect: () => { outbox = null; },
      reconnect: box => { outbox = box; lastViewport = ''; }
    };
  `)(stage, outbox, { devicePixelRatio: 1 }, viewportFor, requestAnimationFrame, cancelAnimationFrame, probe, audioProbe);
  return { ...p, rect, stage, sent, frames, frame() {
    for (const [id, run] of [...frames]) {
      frames.delete(id);
      run();
    }
  } };
}

test('viewport resize notifications share the next frame and report its latest size', () => {
  const p = page();
  p.scheduleViewport();
  p.rect.width = 1100;
  p.scheduleViewport();
  assert.equal(p.frames.size, 1);
  assert.equal(p.sent.length, 0);
  p.frame();
  assert.deepEqual(p.sent, [{ event: { k: 'vp', ...viewportFor(1100, 720, 1) }, mode: 'latest' }]);
  p.scheduleViewport();
  p.frame();
  assert.equal(p.sent.length, 1, 'duplicate size does not request another reconnect');
});

test('continuous resizes report on every frame without waiting for quiet', () => {
  const p = page();
  for (const width of [1200, 1100, 1000]) {
    p.rect.width = width;
    p.scheduleViewport();
    p.scheduleViewport();
    p.frame();
    assert.equal(p.sent.at(-1).event.w, width);
  }
  assert.equal(p.sent.length, 3);
});

test('a pending resize cannot report after returning to the portal or disconnecting', () => {
  for (const stop of [p => { p.stage.hidden = true; }, p => p.disconnect()]) {
    const p = page();
    p.scheduleViewport();
    stop(p);
    p.frame();
    assert.equal(p.sent.length, 0);
  }
});

test('cancelled old-session frames cannot send to a newly connected session', () => {
  const p = page(), fresh = [];
  p.scheduleViewport();
  // stop() cancels before a subsequent start() installs another outbox.
  assert.match(extract('stop'), /cancelViewport\(\)/);
  assert.match(extract('start'), /cancelViewport\(\)/);
  assert.match(extract('showPortal'), /cancelViewport\(\)/);
  p.cancelViewport();
  p.disconnect();
  p.reconnect({ push: event => fresh.push(event) });
  p.frame();
  assert.equal(fresh.length, 0);
  p.rect.width = 1000;
  p.scheduleViewport();
  p.frame();
  assert.deepEqual(fresh, [{ k: 'vp', ...viewportFor(1000, 720, 1) }]);
});

test('invalid dimensions do not prevent a valid next-frame report', () => {
  const p = page();
  p.rect.width = 200;
  p.scheduleViewport();
  p.frame();
  assert.equal(p.sent.length, 0);
  p.rect.width = 1100;
  p.scheduleViewport();
  p.frame();
  assert.equal(p.sent.length, 1);
});

test('capability probe reports only the latest viewport and cannot cross browser sessions', async () => {
  const pending = [], caps = { h264: true, hevc: false, maxWidth: 1280, maxHeight: 720 };
  const p = page((width, height) => new Promise(resolve => pending.push({ width, height, resolve })));
  p.scheduleViewport(); p.frame();
  p.rect.width = 1000; p.scheduleViewport(); p.frame();
  pending[0].resolve(caps); await Promise.resolve(); await Promise.resolve();
  assert.equal(p.sent.length, 2, 'a completed probe for the old viewport cannot replace the latest size');
  pending[1].resolve(caps); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(p.sent.at(-1), { event: { k: 'vp', ...viewportFor(1000, 720, 1), caps: { ...caps, audioFormats: 0x3fffc } }, mode: 'latest' });
  p.rect.width = 1200; p.scheduleViewport(); p.frame();
  const fresh = []; p.disconnect(); p.reconnect({ push: event => fresh.push(event) });
  pending[2].resolve(caps); await Promise.resolve(); await Promise.resolve();
  assert.equal(fresh.length, 0, 'results from the retired paired session are discarded');
});

test('paired viewport reports measured audio formats after both decoder probes complete', async () => {
  const caps = { h264: true, hevc: false, maxWidth: 1280, maxHeight: 720 };
  let complete;
  const p = page(async () => caps, () => new Promise(resolve => { complete = resolve; }));
  p.scheduleViewport(); p.frame();
  await Promise.resolve();
  assert.equal(p.sent.length, 1, 'size remains immediate while audio capabilities are pending');
  complete(0x3000000 | 0x3fffc); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(p.sent.at(-1), { event: { k: 'vp', ...viewportFor(1280, 720, 1),
    caps: { ...caps, audioFormats: 0x303fffc } }, mode: 'latest' });
});
