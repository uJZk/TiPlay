// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  WATCH_OPTIONS, CollectorError, addressSpaceFor, createCollector, createEventQueue, eventFactory,
  geolocationErrorData, normalizeEndpoint, parseConnection, positionData, uploadErrorData,
} from '../../site/play/nav-test/helpers.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const TOKEN = '0123456789abcdef0123456789abcdef';

test('probe links accept an IPv4 hotspot and the fragment token, and default to port 18080', () => {
  assert.equal(normalizeEndpoint('192.168.43.1'), '192.168.43.1:18080');
  assert.equal(normalizeEndpoint('localhost:18080'), 'localhost:18080');
  assert.deepEqual(parseConnection('?t=192.168.43.1%3A18080', `#c=${TOKEN}`), { host: '192.168.43.1:18080', token: TOKEN });
  assert.equal(parseConnection(`?t=192.168.43.1&c=${TOKEN}`, '').token, null, 'a query token is never used');
  for (const host of ['https://192.168.43.1', '192.168.43.256', '01.2.3.4', '10.0.0.1:0', '10.0.0.1:65536', 'phone.example', '10.0.0.1/path']) {
    assert.equal(normalizeEndpoint(host), null, host);
  }
});

test('position data preserves raw sensor timestamps, zero measurements and absent coordinate fields', () => {
  assert.deepEqual(positionData({ timestamp: 1740000000123.5, coords: { latitude: 0, longitude: 120.123456789, accuracy: 0, altitude: null, altitudeAccuracy: NaN, heading: undefined, speed: 0 } }), {
    timestamp: 1740000000123.5,
    coords: { latitude: 0, longitude: 120.123456789, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: 0 },
  });
  assert.equal(positionData({ timestamp: Infinity }).timestamp, null);
  assert.deepEqual(WATCH_OPTIONS, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

test('browser events have stable unique IDs and independent receive wall and monotonic timestamps', () => {
  const create = eventFactory({ clientId: 'browser', wallTime: () => 1740000000000, monotonicTime: () => 9.25 });
  assert.deepEqual(create('environment', { secureContext: true }), {
    id: 'browser:1', source: 'browser', type: 'environment', clientWallTimeMs: 1740000000000,
    clientMonotonicMs: 9.25, data: { secureContext: true },
  });
  assert.equal(create('position', positionData({ timestamp: 1, coords: {} })).id, 'browser:2');
});

test('geolocation errors retain codes 1, 2 and 3 without being classified as upload errors', () => {
  for (const [code, reason] of [[1, 'permission_denied'], [2, 'position_unavailable'], [3, 'timeout']]) {
    assert.deepEqual(geolocationErrorData({ code, message: 'actual browser text' }), {
      code, reason, message: 'actual browser text', name: 'GeolocationPositionError',
    });
  }
  assert.equal(uploadErrorData(new TypeError('Failed to fetch')).category, 'network_or_browser_policy');
  assert.equal(uploadErrorData(Object.assign(new Error('timeout'), { name: 'AbortError' })).category, 'request_timeout');
});

test('collector uses authenticated local-network requests without tokens in URLs or event bodies', async () => {
  const calls = [];
  const collector = createCollector({ host: '192.168.43.1:18080', token: TOKEN, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ acknowledged: ['b:1'] }) };
  } });
  const events = [{ id: 'b:1', source: 'browser', type: 'environment', clientWallTimeMs: 1, clientMonotonicMs: 2, data: {} }];
  await collector.send(events);
  assert.equal(calls[0].url, 'http://192.168.43.1:18080/events');
  assert.equal(calls[0].init.targetAddressSpace, 'local');
  assert.equal(calls[0].init.headers['X-Nav-Test-Token'], TOKEN);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(JSON.parse(calls[0].init.body), { events });
  assert.ok(!calls[0].url.includes(TOKEN) && !calls[0].init.body.includes(TOKEN));
  assert.equal(addressSpaceFor('localhost:18080'), 'loopback');
  assert.equal(addressSpaceFor('127.0.0.1:18080'), 'loopback');
  assert.equal(addressSpaceFor('100.64.0.1:18080'), 'local');
  assert.equal(addressSpaceFor('169.254.111.111:18080'), 'local');
  assert.equal(addressSpaceFor('8.8.8.8:18080'), undefined);
});

test('collector distinguishes authentication, HTTP, malformed JSON and opaque network failures', async () => {
  async function category(fetchImpl) {
    try { await createCollector({ host: 'localhost', token: TOKEN, fetchImpl }).request('/status'); }
    catch (error) { return uploadErrorData(error); }
    assert.fail('request must fail');
  }
  assert.equal((await category(async () => ({ ok: false, status: 401 }))).category, 'authentication');
  assert.deepEqual((await category(async () => ({ ok: false, status: 503 }))).status, 503);
  assert.equal((await category(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }))).category, 'response_format');
  assert.equal((await category(async () => { throw new TypeError('Failed to fetch'); })).category, 'network_or_browser_policy');
});

test('a collector timeout covers response body reads as well as initial connection', async () => {
  const collector = createCollector({ host: 'localhost', token: TOKEN, timeoutMs: 5, fetchImpl: async (_, init) => ({
    ok: true,
    json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted body'), { name: 'AbortError' })), { once: true })),
  }) });
  await assert.rejects(collector.request('/status'), error => error.category === 'request_timeout');
});

test('phone log download uses the same header authentication and returns a Blob', async () => {
  const blob = new Blob(['{"source":"android"}\n']);
  let request;
  const collector = createCollector({ host: '127.0.0.1', token: TOKEN, fetchImpl: async (url, init) => {
    request = { url, init };
    return { ok: true, blob: async () => blob, headers: { get: () => 'attachment; filename="test.ndjson"' } };
  } });
  const result = await collector.request('/log', { download: true });
  assert.equal(request.url, 'http://127.0.0.1:18080/log');
  assert.equal(request.init.targetAddressSpace, 'loopback');
  assert.equal(request.init.headers['X-Nav-Test-Token'], TOKEN);
  assert.equal(result.blob, blob);
});

function queueFixture(options = {}) {
  const posts = [], timers = new Map(), errors = [], acknowledgements = [];
  let timerId = 0;
  const queue = createEventQueue({
    send: events => new Promise((resolve, reject) => posts.push({ events, resolve, reject })),
    schedule: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    cancel: id => timers.delete(id), onError: error => errors.push(error),
    onAck: events => acknowledgements.push(events), ...options,
  });
  return {
    queue, posts, timers, errors, acknowledgements,
    async ack(index, ids = posts[index].events.map(event => event.id)) {
      posts[index].resolve({ acknowledged: ids });
      await settle();
    },
    async retry() {
      const [id, { callback }] = timers.entries().next().value;
      timers.delete(id);
      callback();
      await settle();
    },
  };
}
const event = id => ({ id, source: 'browser', type: 'position', clientWallTimeMs: 1, clientMonotonicMs: 2, data: {} });

test('the queue retains initial environment and start events before being enabled', async () => {
  const f = queueFixture();
  f.queue.push({ ...event('b:1'), type: 'environment' });
  f.queue.push({ ...event('b:2'), type: 'start' });
  f.queue.push({ ...event('b:3'), type: 'geolocation_error' });
  await settle();
  assert.equal(f.posts.length, 0);
  f.queue.enable();
  await settle();
  assert.deepEqual(f.posts[0].events.map(entry => entry.type), ['environment', 'start', 'geolocation_error']);
  await f.ack(0);
  assert.equal(f.queue.stats().pending, 0);
});

test('a lost response retries identical IDs before later events with exactly one batch in flight', async () => {
  const f = queueFixture({ batchSize: 1 });
  f.queue.push(event('b:1'));
  f.queue.enable();
  await settle();
  f.queue.push(event('b:2'));
  assert.equal(f.posts.length, 1);
  f.posts[0].reject(new TypeError('response lost after server stored the event'));
  await settle();
  assert.equal(f.queue.stats().pending, 2);
  assert.equal([...f.timers.values()][0].ms, 500);
  f.queue.push(event('b:3'));
  await settle();
  assert.equal(f.posts.length, 1, 'new events do not bypass retry delay');
  await f.retry();
  assert.deepEqual(f.posts[1].events, f.posts[0].events);
  await f.ack(1);
  assert.deepEqual(f.posts[2].events, [event('b:2')]);
  await f.ack(2);
  assert.deepEqual(f.posts[3].events, [event('b:3')]);
  await f.ack(3);
  assert.deepEqual(f.queue.stats(), { pending: 0, inFlight: false, uploaded: 3, failures: 1, retryScheduled: false });
});

test('partial acknowledgements remove only accepted batch IDs and block reentrant sends until retry', async () => {
  let f;
  f = queueFixture({ onAck: () => f.queue.push(event('b:3')) });
  f.queue.push(event('b:1'));
  f.queue.push(event('b:2'));
  f.queue.enable();
  await settle();
  await f.ack(0, ['b:1', 'unknown']);
  assert.deepEqual(f.queue.snapshot().map(entry => entry.id), ['b:2', 'b:3']);
  assert.equal(f.posts.length, 1, 'onAck cannot race partial-ack retry scheduling');
  await f.retry();
  assert.deepEqual(f.posts[1].events.map(entry => entry.id), ['b:2', 'b:3']);
});

test('malformed acknowledgements preserve evidence, and retries back off to eight seconds', async () => {
  const f = queueFixture();
  f.queue.push(event('b:1'));
  f.queue.enable();
  await settle();
  for (const delay of [500, 1000, 2000, 4000, 8000, 8000]) {
    f.posts.at(-1).resolve({ acknowledged: 'b:1' });
    await settle();
    assert.equal([...f.timers.values()][0].ms, delay);
    assert.equal(f.queue.stats().pending, 1);
    await f.retry();
  }
  await f.ack(f.posts.length - 1);
  assert.equal(f.queue.stats().pending, 0);
  assert.ok(f.errors.every(error => error instanceof CollectorError));
});

test('queue bounds include in-flight events, reject overflow without losing old events and deduplicate IDs', async () => {
  const f = queueFixture({ maxEvents: 2 });
  f.queue.push(event('b:1'));
  f.queue.enable();
  await settle();
  assert.equal(f.queue.push(event('b:2')), true);
  assert.equal(f.queue.push(event('b:2')), true);
  assert.equal(f.queue.push(event('b:3')), false);
  assert.deepEqual(f.queue.snapshot().map(entry => entry.id), ['b:1', 'b:2']);
  await f.ack(0);
  assert.equal(f.queue.push(event('b:3')), true);
  assert.deepEqual(f.posts[1].events.map(entry => entry.id), ['b:2']);
});

function pageFixture({ geoError = null, fetchFailure = null } = {}) {
  const elements = new Map(), timers = new Map(), requests = [], downloads = [], cleared = [];
  let timerId = 0, geoCallbacks;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', disabled: false, classList: { toggle() {} }, handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; }, click() { this.handlers.click?.(); }, remove() {},
    });
    return elements.get(id);
  };
  const document = {
    getElementById: element, visibilityState: 'visible', addEventListener() {},
    createElement: () => ({ click() {}, remove() {} }), body: { append() {} },
  };
  const navigator = {
    userAgent: 'Tesla test fixture', platform: 'Linux', language: 'zh-CN', onLine: true,
    permissions: { query: async () => ({ state: 'prompt', onchange: null }) },
    geolocation: {
      watchPosition(success, error, options) {
        geoCallbacks = { success, error, options };
        if (geoError) error(geoError);
        return 7;
      },
      clearWatch(id) { cleared.push(id); },
    },
  };
  const context = vm.createContext({
    document, navigator, location: { origin: 'https://ujzk.github.io', pathname: '/TiPlay/nav-test/', search: '?t=192.168.43.1:18080', hash: `#c=${TOKEN}` },
    screen: { width: 1280, height: 720 }, performance: { now: () => 100, timeOrigin: 1740000000000 },
    crypto: { getRandomValues: values => { values.fill(42); return values; } }, URLSearchParams, AbortController,
    Blob, Date, URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:export'; }, revokeObjectURL() {} },
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (fetchFailure) throw fetchFailure;
      return { ok: true, json: async () => url.endsWith('/events')
        ? { acknowledged: JSON.parse(init.body).events.map(entry => entry.id) }
        : { running: true, sessionId: 'phone-session', androidFixes: 0, browserFixes: 0, lastAndroidFix: null } };
    },
  });
  context.window = { isSecureContext: true, devicePixelRatio: 1, addEventListener() {} };
  const helperSource = readFileSync(new URL('../../site/play/nav-test/helpers.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const appSource = readFileSync(new URL('../../site/play/nav-test/app.js', import.meta.url), 'utf8').replace(/import \{[\s\S]*?\} from '\.\/helpers\.js';/, '');
  vm.runInContext(helperSource + '\n' + appSource, context);
  return {
    context, element, requests, downloads, cleared, geo: () => geoCallbacks,
    read: expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context))),
  };
}

test('Start initiates phone fetch and high-accuracy geolocation independently while retaining early errors', async () => {
  const f = pageFixture({ geoError: { code: 1, message: 'User denied Geolocation' }, fetchFailure: new TypeError('Failed to fetch') });
  f.element('start').click();
  assert.equal(f.requests[0].url, 'http://192.168.43.1:18080/status', 'local-network request begins in the click before awaiting anything');
  assert.deepEqual(JSON.parse(JSON.stringify(f.geo().options)), WATCH_OPTIONS);
  await settle();
  const events = f.read('evidence');
  assert.deepEqual(events.slice(0, 4).map(entry => entry.type), ['connection_config', 'environment', 'start', 'geolocation_error']);
  assert.ok(events.some(entry => entry.type === 'connection_error'));
  assert.ok(events.some(entry => entry.type === 'upload_error'));
  assert.equal(f.element('geo-errors').textContent, 1);
  assert.match(f.element('geo-status').textContent, /定位权限被拒绝/);
  assert.equal(f.cleared.length, 0, 'a geolocation error keeps the watch');
  assert.ok(f.read('queue.snapshot()').some(entry => entry.type === 'environment'));
  f.element('export').click();
  const exported = JSON.parse(await f.downloads[0].text());
  assert.ok(exported.events.some(entry => entry.type === 'geolocation_error'));
  assert.ok(exported.pendingEvents.length > 0);
  assert.ok(!JSON.stringify(exported).includes(TOKEN), 'local evidence does not contain the session token');
});

test('real browser fixes preserve nullable fields and Stop clears only the browser watch and records a stop', async () => {
  const f = pageFixture();
  f.element('start').click();
  await settle();
  f.geo().success({ timestamp: 1740000000000, coords: { latitude: 1, longitude: 2, accuracy: 3, altitude: null, speed: 0 } });
  await settle();
  const position = f.read("evidence.find(entry => entry.type === 'position')");
  assert.equal(position.data.timestamp, 1740000000000);
  assert.equal(position.data.coords.altitude, null);
  assert.equal(position.data.coords.speed, 0);
  assert.equal(position.data.receivedMonotonicMs, 100);
  f.element('stop').click();
  await settle();
  assert.deepEqual(f.cleared, [7]);
  assert.equal(f.read('monitoring'), false);
  assert.ok(f.read('evidence').some(entry => entry.type === 'stop'));
  assert.ok(f.requests.every(request => /\/(status|events)$/.test(request.url)), 'no browser request stops the Android collector');
});
