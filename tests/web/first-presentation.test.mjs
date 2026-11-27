// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abortable, createControlOutbox } from '../../site/play/link.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const source = (epoch = 7, generation = 1, id = 1) => ({ id, generation, epoch });
const pageSource = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
const extract = name => new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`).exec(pageSource)[0];

function fixture(options = {}) {
  const posts = [], errors = [];
  const outbox = createControlOutbox({
    maxInFlight: 8, onError: error => errors.push(error), ...options,
    send(q, events, prepareEvents) {
      return new Promise((resolve, reject) => posts.push({ q, events: structuredClone(events), prepareEvents, resolve, reject }));
    },
  });
  const pending = () => posts.filter(post => !post.done);
  const resolve = async post => { post.done = true; post.resolve({ q: post.q }); await settle(); };
  const reject = async post => { post.done = true; post.reject(new Error('lost control reply')); await settle(); };
  const drain = async () => { while (pending().length) await resolve(pending()[0]); };
  return { outbox, posts, errors, pending, resolve, reject, drain,
    proofs: () => posts.flatMap(post => post.events).filter(event => event.k === 'dec') };
}

test('a current first presentation is acknowledged once and cannot bypass its source through telemetry', async () => {
  const f = fixture();
  try {
    assert.equal(f.outbox.push({ k: 'dec', ep: 7 }, 'latest'), false);
    assert.equal(f.outbox.presented(source()), false);
    assert.equal(f.outbox.setPresentationSource(source()), true);
    assert.equal(f.outbox.presented(source()), true);
    assert.equal(f.outbox.presented(source()), false);
    await settle();
    assert.deepEqual(f.proofs(), [{ k: 'dec', ep: 7 }]);
    await f.drain();
    assert.equal(f.outbox.stats().presentationRetained, 0);
    f.outbox.setPresentationSource(source());
    assert.equal(f.outbox.presented(source()), false, 'an identical config does not demand another proof');
    f.outbox.heartbeat(); await settle(); await f.drain();
    assert.deepEqual(f.proofs(), [{ k: 'dec', ep: 7 }]);
  } finally { f.outbox.close(); }
});

test('the unique proof survives input overflow while all eight requests are blocked', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 8; i++) f.outbox.heartbeat();
    await settle();
    assert.equal(f.posts.length, 8);
    f.outbox.setPresentationSource(source());
    assert.equal(f.outbox.presented(source()), true);
    for (let i = 0; i < 64; i++) assert.equal(f.outbox.push({ k: 'key', n: 'home' }), true);
    assert.equal(f.outbox.push({ k: 'key', n: 'home' }), false);
    assert.equal(f.outbox.stats().overflows, 1);
    assert.equal(f.outbox.stats().presentationRetained, 1);
    assert.equal(f.outbox.stats().pending, 1);
    await f.drain();
    assert.deepEqual(f.proofs(), [{ k: 'dec', ep: 7 }]);
    assert.equal(f.outbox.stats().presentationRetained, 0);
    f.outbox.heartbeat(); await settle(); await f.drain();
    assert.equal(f.proofs().length, 1);
  } finally { f.outbox.close(); }
});

test('a failed proof waits for heartbeat and retains its one slot until acknowledged', async () => {
  const f = fixture();
  try {
    f.outbox.setPresentationSource(source()); f.outbox.presented(source()); await settle();
    await f.reject(f.posts[0]);
    assert.equal(f.posts.length, 1, 'a failure cannot create an unbounded immediate retry loop');
    assert.equal(f.outbox.stats().presentationRetained, 1);
    f.outbox.heartbeat(); await settle();
    assert.deepEqual(f.proofs(), [{ k: 'dec', ep: 7 }, { k: 'dec', ep: 7 }]);
    await f.drain();
    assert.equal(f.outbox.stats().presentationRetained, 0);
  } finally { f.outbox.close(); }
});

test('an old acknowledgement cannot release a newer proof and an old failure cannot revive one', async () => {
  const f = fixture({ maxInFlight: 2 });
  try {
    f.outbox.setPresentationSource(source()); f.outbox.presented(source()); await settle();
    f.outbox.setPresentationSource(source(8)); f.outbox.presented(source(8)); await settle();
    await f.resolve(f.posts[0]);
    assert.equal(f.outbox.stats().presentationRetained, 1, 'old ACK cannot acknowledge epoch eight');
    await f.reject(f.posts[1]);
    f.outbox.setPresentationSource(source(9, 2)); f.outbox.presented(source(9, 2)); await settle();
    f.outbox.heartbeat(); await settle(); await f.drain();
    assert.deepEqual(f.proofs().map(event => event.ep), [7, 8, 9], 'the superseded failed proof is not retried');
    assert.equal(f.outbox.presented(source(8)), false);
    assert.equal(f.outbox.presented(source(9, 1)), false);
    assert.equal(f.outbox.presented(source(9, 2, 2)), false);
  } finally { f.outbox.close(); }
});

test('retiring and reusing the same source values does not reuse an old proof token', async () => {
  const f = fixture({ maxInFlight: 1 });
  try {
    f.outbox.setPresentationSource(source()); f.outbox.presented(source());
    // The old send has been scheduled, but its microtask has not reached the transport.
    f.outbox.setPresentationSource(null);
    f.outbox.setPresentationSource(source()); f.outbox.presented(source());
    await settle();
    assert.deepEqual(f.posts[0].events, [], 'same numbers after retirement do not make the old entry current');
    await f.resolve(f.posts[0]);
    assert.deepEqual(f.posts[1].events, [{ k: 'dec', ep: 7 }]);
    assert.equal(f.outbox.stats().presentationRetained, 1);
    await f.drain();
  } finally { f.outbox.close(); }
});

test('a proof awaiting a replacement peer is filtered again immediately before actual control send', async () => {
  const sent = [];
  const page = new Function('sent', `
    const active = true, session = 'owner', locationEvents = events => events;
    const controlWaiters = new Set(); let rtcMedia = null, controlClock = null;
    ${extract('postControl')}
    return { postControl, waiting: () => controlWaiters.size,
      ready() { rtcMedia = { isConnected: () => true, control(q, events) { sent.push({ q, events }); return Promise.resolve({ q }); } };
        for (const waiter of controlWaiters) waiter.resolve(); controlWaiters.clear(); } };
  `)(sent);
  const outbox = createControlOutbox({ maxInFlight: 2,
    send: (q, events, prepare) => page.postControl(q, events, 'owner', prepare) });
  try {
    outbox.setPresentationSource(source()); outbox.presented(source()); await settle();
    assert.equal(page.waiting(), 1);
    outbox.setPresentationSource(null);
    outbox.setPresentationSource(source(8, 2, 2)); outbox.presented(source(8, 2, 2)); await settle();
    page.ready(); await settle();
    assert.deepEqual(sent.map(batch => batch.events), [[], [{ k: 'dec', ep: 8 }]]);
    assert.equal(outbox.stats().presentationRetained, 0);
  } finally { outbox.close(); }
});

test('idle, invalid source and close retire queued proofs without reaching a later transport', async () => {
  const f = fixture({ maxInFlight: 1 });
  try {
    f.outbox.heartbeat(); await settle();
    f.outbox.setPresentationSource(source()); f.outbox.presented(source());
    f.outbox.setPresentationSource(null);
    assert.equal(f.outbox.presented(source()), false);
    f.outbox.setPresentationSource(source()); f.outbox.presented(source());
    assert.equal(f.outbox.setPresentationSource({ ...source(), generation: 0 }), false);
    assert.equal(f.outbox.stats().presentationRetained, 0);
    await f.drain();
    assert.deepEqual(f.proofs(), []);
    f.outbox.setPresentationSource(source()); f.outbox.presented(source());
    f.outbox.close(); await settle();
    assert.deepEqual(f.proofs(), []);
    assert.equal(f.outbox.stats().presentationRetained, 0);
    assert.equal(f.outbox.presented(source()), false);
    assert.equal(f.outbox.setPresentationSource(source()), false);
  } finally { f.outbox.close(); }
});

test('the presentation slot does not consume touch capacity or any protected diagnostic slot', async () => {
  const f = fixture({ maxInFlight: 1 });
  try {
    f.outbox.heartbeat(); await settle();
    const touches = Array.from({ length: 64 }, (_, i) => ({ k: 't', p: [[0, i / 64, .5, i % 2]] }));
    for (const event of touches) assert.equal(f.outbox.push(event), true);
    const faults = Array.from({ length: 4 }, (_, i) => ({ k: 'st', v: {
      'transport.generation': 3, 'audio.nativeAudio.rtcGeneration': i + 1, 'audio.nativeAudio.state': 'failed',
    } }));
    for (const event of faults) assert.equal(f.outbox.push(event, 'audio-fault'), true);
    const first = { k: 'st', v: { first: 1 } }, terminal = { k: 'st', v: { terminal: 1 } };
    assert.equal(f.outbox.push(first, 'fault'), true);
    assert.equal(f.outbox.push(terminal, 'terminal'), true);
    f.outbox.setPresentationSource(source()); assert.equal(f.outbox.presented(source()), true);
    assert.equal(f.outbox.stats().pending, 71);
    await f.resolve(f.posts[0]);
    const batch = f.posts[1].events;
    assert.equal(batch.filter(event => event.k === 'dec').length, 1);
    assert.ok(batch.some(event => event.v?.first === 1));
    assert.ok(batch.some(event => event.v?.terminal === 1));
    assert.deepEqual(batch.filter(event => event.k === 't'), touches);
    assert.equal(batch.filter(event => event.v?.['audio.nativeAudio.state'] === 'failed').length, 1);
    assert.equal(f.outbox.stats().audioFaultRetained, 4);
    await f.drain();
    assert.equal(f.posts.flatMap(post => post.events).filter(event => event.v?.['audio.nativeAudio.state'] === 'failed').length, 4);
    assert.equal(f.outbox.stats().audioFaultRetained, 0);
    assert.equal(f.proofs().length, 1);
  } finally { f.outbox.close(); }
});

test('actual page message handling binds proof to the accepted config and rejects old decoder owners', async () => {
  const f = fixture();
  const page = new Function('outbox', `
    const active = true, streamId = 4, currentVideoGeneration = 2;
    let config = null, live = false, videoStats = {}, videoError, unsupported, mediaTiming;
    const sink = { delay() {} }, timingFor = () => ({ plans() {}, started() {} });
    const updateReceiverNotice = () => {}, render = () => {};
    ${extract('onVideoMessage')}
    return onVideoMessage;
  `)(f.outbox);
  try {
    page({ type: 'config', id: 4, videoGeneration: 2, config: { epoch: 7, mode: 'carplay' } });
    page({ type: 'decoded', id: 3, videoGeneration: 2, epoch: 7 });
    page({ type: 'decoded', id: 4, videoGeneration: 1, epoch: 7 });
    page({ type: 'decoded', id: 4, videoGeneration: 2, epoch: 6 });
    assert.equal(f.outbox.stats().presentationRetained, 0);
    page({ type: 'decoded', id: 4, videoGeneration: 2, epoch: 7 });
    page({ type: 'idle', id: 4, videoGeneration: 2 });
    await settle(); await f.drain();
    assert.deepEqual(f.proofs(), [], 'idle retired the scheduled proof before its send');
    page({ type: 'config', id: 4, videoGeneration: 2, config: { epoch: 8, mode: 'airplay-mirror' } });
    page({ type: 'decoded', id: 4, epoch: 8 }); // Older metadata without the optional generation uses the current one.
    await settle(); await f.drain();
    assert.deepEqual(f.proofs(), [{ k: 'dec', ep: 8 }]);
  } finally { f.outbox.close(); }
});

function synchronousOpenPage({ failOpen = false } = {}) {
  const wire = [], events = [];
  const page = new Function('createControlOutbox', 'abortable', 'wire', 'events', 'failOpen', `
    let streamId = 0, currentVideoGeneration = 1, outbox = null, rtcMedia, retryTimer, retryCountdownTimer,
      videoAbort, videoError, videoRestart, lastError, resourceToken, controlClock, rtcProgress, heartbeatTimer,
      live = false, phase, lastViewport, mediaTiming, config = null, videoStats = {}, unsupported;
    const active = true, session = 'owner', videoPath = { rtcTrack: false }, slots = { contacts: () => [] };
    const controlWaiters = new Set(), codecsReady = Promise.resolve();
    const faultDiagnostics = { reset() {} }, resetReceiverPresentation = () => {};
    const mediaTimings = new Map(), timingFor = () => ({ plans() {}, started() {} });
    const render = () => {}, reportAppearance = () => {}, scheduleViewport = () => {}, updateReceiverNotice = () => {};
    const browserAudio = { clock() {}, attach() {} }, createClockEstimator = () => ({ observe: () => null });
    const phoneFetch = () => { throw Error('unexpected HTTP request'); }, authenticateRtcOffer = () => {};
    const setInterval = () => 0, clearInterval = () => {}, applyStatus = () => {}, controlFailed = () => {};
    let retries = 0, attempt = 0;
    const reportDiagnostics = () => {}, backoffDelay = () => 1, scheduleRetry = () => { retries++; };
    const stop = reason => { throw Error('unexpected stop: ' + reason); };
    const postControl = (q, values, owner, prepare) => {
      const events = prepare(); wire.push(...events); return Promise.resolve({ q });
    };
    const createRtcMediaTransport = () => ({ connect: async () => { events.push('authenticated'); },
      resourceToken: () => 'synthetic', clockSample: () => ({}), video: null, hello: () => ({}), close() {}, openAudio() {} });
    ${extract('onVideoMessage')}
    const sink = { stop() {}, clock() {}, delay() {}, failVideo() {}, open(id) {
      events.push('open');
      onVideoMessage({ type: 'config', id, videoGeneration: 1, config: { epoch: 7, mode: 'carplay' } });
      onVideoMessage({ type: 'decoded', id, videoGeneration: 1, epoch: 7 });
      if (failOpen) throw Error('synchronous open failed');
    } };
    ${extract('connectVideo')}
    return { run: connectVideo, outbox: () => outbox, retries: () => retries };
  `)(options => { events.push('outbox'); return createControlOutbox(options); }, abortable, wire, events, failOpen);
  return { ...page, wire, events };
}

test('authenticated outbox exists before synchronous sink config and first presentation', async () => {
  const page = synchronousOpenPage();
  try {
    await page.run(); await settle();
    assert.deepEqual(page.events, ['authenticated', 'outbox', 'open']);
    assert.deepEqual(page.wire.filter(event => event.k === 'dec'), [{ k: 'dec', ep: 7 }]);
  } finally { page.outbox()?.close(); }
});

test('a synchronous sink-open failure retires its scheduled proof before a retry transport can receive it', async () => {
  const page = synchronousOpenPage({ failOpen: true });
  try {
    await page.run(); await settle();
    assert.equal(page.retries(), 1);
    assert.deepEqual(page.wire.filter(event => event.k === 'dec'), []);
    assert.equal(page.outbox().stats().presentationRetained, 0);
  } finally { page.outbox()?.close(); }
});
