// SPDX-License-Identifier: GPL-3.0-only
// The page must work from any path and offline once cached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DEFAULT_HOST, isCode, normalizeHost } from '../../site/play/link.js';

const play = new URL('../../site/play/', import.meta.url);
const read = name => readFileSync(new URL(name, play), 'utf8');

test('the initial clock reaches a video sink whose setup finishes after hello', async () => {
  const connect = /async function connectVideo\(\) \{([\s\S]*?)\n\}/.exec(read('app.js'))[1];
  let finishSetup;
  const codecsReady = new Promise(resolve => { finishSetup = resolve; });
  const events = [];
  const run = new Function('codecsReady', 'events', `
    let streamId = 0, sink = null, retryTimer, retryCountdownTimer, videoAbort, live, phase, lastViewport;
    const link = { code: '1234' }, session = 'session', PROTOCOL = 1;
    const videoPath = {};
    const browserAudio = { attach() {}, clock: value => events.push(['audio-clock', value]) };
    let mediaTiming;
    const mediaTimings = new Map([['carplay', { reset: () => events.push('timing-reset'), mode() {} }]]);
    const timingFor = mode => mediaTimings.get(mode);
    const airplayControls = { update() {} };
    const render = () => {}, reportAppearance = () => {}, scheduleViewport = () => {};
    const setInterval = () => 0, clearInterval = () => {};
    const stop = reason => { throw new Error(reason); };
    const createClockEstimator = () => ({ observe: serverMs => ({ offset: 10, rtt: 2, at: serverMs }), snapshot: () => null });
    const phoneFetch = async route => {
      events.push(route);
      return { ok: true, body: null, json: async () => ({ app: 'TiPlay', protocol: 1, clockMs: 100 }) };
    };
    const pending = (async () => { ${connect} })();
    return {
      pending,
      setup() { sink = {
        clock: value => events.push(['clock', value]),
        open: () => events.push('open'),
      }; },
    };
  `)(codecsReady, events);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['/hello'], 'hello finished while the decoder sink is still unavailable');
  run.setup();
  finishSetup('avc1');
  await run.pending;
  assert.deepEqual(events[1], ['clock', { offset: 10, rtt: 2, at: 100 }]);
  assert.deepEqual(events[2], ['audio-clock', { offset: 10, rtt: 2, at: 100 }], 'audio receives the same initial clock as video');
  assert.equal(events[3], 'timing-reset');
  assert.match(events[4], /^\/video\?/);
  assert.equal(events[5], 'open');
});

function retryPage(lastError) {
  const app = read('app.js');
  const extract = name => new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(app)[0];
  let now = 0, nextId = 0;
  const timers = new Map(), elements = new Map(), overlays = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { setAttribute() {} });
    return elements.get(id);
  };
  const setTimer = (callback, delay, repeat) => {
    const id = ++nextId; timers.set(id, { callback, at: now + delay, repeat }); return id;
  };
  const page = new Function('$', 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'renderReconnect', 'lastError', `
    let phase, retryAt, retryTimer, retryCountdownTimer, reconnects = 0, streamId = 0, videoAbort;
    let active = true, live = false, notice = null, status = null, unsupported = null, outbox = null, wakeLock = null, config = null;
    let heartbeatTimer, statsTimer, lastViewport, fitRequestedAt = 0;
    const browserLocation = { stop() {} };
    let problem = null;
    const browserNotice = { update(value) { if (value) problem = value; } };
    const codecName = value => value;
    const videoStats = {};
    const statsVisible = false, link = { code: '1234' }, stage = {};
    const airplayControls = { update() {}, videoActive: () => false };
    let trustVisible = true, trustClears = 0;
    const airplayTrust = { clear() { trustVisible = false; trustClears++; } };
    const browserAudio = { stop() {} }, sink = { stop() {} }, slots = { releaseAll() {} };
    const cancelViewport = () => {}, cancelMove = () => {}, renderStats = () => {};
    const t = (key, ...args) => args.length ? key + ':' + args.join(',') : key;
    const phoneFetch = () => new Promise(() => {});
    const createClockEstimator = () => ({ observe: () => null, snapshot: () => null });
    ${['statusText', 'render', 'scheduleRetry', 'stop', 'connectVideo'].map(extract).join('\n')}
    return { scheduleRetry, stop, connectVideo, reconnects: () => reconnects,
      present(value) {
        phase = 'waiting'; status = value.status ?? null; config = value.config ?? null;
        live = value.live ?? false; unsupported = value.unsupported ?? null;
        render(); return $('status').textContent;
      },
      problem: () => problem, inlineMessage: () => $('message').textContent,
      trustState: () => ({ visible: trustVisible, clears: trustClears }) };
  `)($, { now: () => now }, (callback, delay) => setTimer(callback, delay, 0), id => timers.delete(id),
    (callback, delay) => setTimer(callback, delay, delay), id => timers.delete(id), value => overlays.push(value.text), lastError);
  return {
    ...page, overlays, text: () => $('status').textContent,
    intervals: () => [...timers.values()].filter(timer => timer.repeat).length,
    advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
        timer.callback();
      }
      now = target;
    },
  };
}

test('waiting messages follow receiver phase and actual video source rather than session availability', () => {
  const page = retryPage(null);
  assert.equal(page.present({ status: { state: 'idle' } }), 'waitingSource');
  assert.equal(page.present({ status: { state: 'connecting' } }), 'waitingSource');
  for (const [state, key] of Object.entries({
    preparing: 'carPlayPreparing', blocked: 'carPlayBlocked', disabled: 'carPlayDisabled',
    failed: 'carPlayFailed', recovering: 'carPlayRecovering', stopping: 'carPlayStopping',
    connecting: 'phoneConnecting', ready: 'waitingPhone', waiting: 'waitingPhone',
  })) {
    assert.equal(page.present({ status: { state: 'idle', receivers: { carplay: { state } } } }), key);
  }
  assert.equal(page.present({ status: { videoSource: 'carplay' } }), 'waitingFrame');
  assert.equal(page.present({ status: { videoSource: 'airplay' } }), 'waitingVideo');
  assert.equal(page.present({ config: { mode: 'carplay' } }), 'waitingFrame');
  assert.equal(page.present({ config: { mode: 'airplay-mirror' } }), 'waitingVideo');
  assert.equal(page.present({ status: { airplay: { kind: 'audio' } } }), 'airPlayAudio');
  assert.equal(page.present({ status: { airplay: { kind: 'photo', resource: 'photo' } } }), 'airPlayPhoto');
  assert.equal(page.present({ status: { airplay: { kind: 'video', resource: 'movie', ready: false } } }), 'waitingVideo');
  assert.equal(page.present({ status: { airplay: { kind: 'video', resource: 'movie', ready: true, playing: false } } }), 'airPlayPaused');
  assert.equal(page.present({ status: { airplay: { kind: 'video', resource: 'movie', ready: true, playing: true } } }), 'airPlayPlaying');
  assert.equal(page.present({ live: true, config: { codec: 'avc1' }, status: { state: 'idle' } }), 'streaming:avc1,0');
});

test('codec and protocol errors use persistent notices while pairing errors stay beside Connect', () => {
  const page = retryPage(null);
  assert.equal(page.present({ unsupported: 'hvc1' }), 'pictureUnavailable');
  assert.equal(page.problem().text, 'unsupportedHevc:hvc1');
  assert.equal(page.inlineMessage(), '');
  page.stop('protocol');
  assert.equal(page.problem().text, 'protocol');
  assert.equal(page.text(), 'stopped');
  page.stop('badCode');
  assert.equal(page.inlineMessage(), 'badCode');
  assert.equal(page.problem().text, 'protocol', 'pairing feedback must not replace the notification');
  for (const key of ['invalidCode', 'invalidHost']) {
    page.stop(key);
    assert.equal(page.inlineMessage(), key);
  }
});

test('retry messages count down every second without receiving a phone heartbeat', () => {
  for (const [error, key] of [[null, 'lost'], [{ status: 503 }, 'unreachable'], [{ status: 429 }, 'throttled']]) {
    const page = retryPage(error);
    page.scheduleRetry(3000);
    assert.equal(page.text(), `${key}:3`);
    page.advance(1000); assert.equal(page.text(), `${key}:2`);
    page.advance(1000); assert.equal(page.text(), `${key}:1`);
    assert.deepEqual(page.overlays, [`${key}:3`, `${key}:2`, `${key}:1`], 'both waiting overlay and settings status receive the actual countdown');
    page.advance(1000);
    assert.equal(page.text(), 'connecting'); assert.equal(page.reconnects(), 1);
    assert.equal(page.intervals(), 0, 'the connection attempt clears the countdown timer');
  }
});

test('replacing a retry schedule cancels the previous countdown and reconnect attempt', () => {
  const page = retryPage(null);
  page.scheduleRetry(3000); page.advance(500);
  page.scheduleRetry(4000);
  assert.equal(page.intervals(), 1);
  const notifications = page.overlays.length;
  page.advance(500);
  assert.equal(page.overlays.length, notifications, 'the old one-second timer must be cancelled');
  page.advance(500); assert.equal(page.text(), 'lost:3');
  page.advance(1500); assert.equal(page.reconnects(), 0, 'the original reconnect deadline must be cancelled');
  page.advance(1500); assert.equal(page.reconnects(), 1); assert.equal(page.intervals(), 0);
});

test('stopping or manually connecting clears the retry countdown immediately', () => {
  for (const action of ['stop', 'connectVideo']) {
    const page = retryPage(null);
    page.scheduleRetry(3000); page.advance(1000);
    page[action]();
    assert.equal(page.intervals(), 0);
    const notifications = page.overlays.length;
    page.advance(3000);
    assert.equal(page.overlays.length, notifications, action);
    assert.equal(page.reconnects(), 0, 'cancelled retry cannot start another connection');
  }
});

test('disconnect immediately clears an AirPlay approval before a delayed status poll arrives', () => {
  const page = retryPage(null);
  assert.deepEqual(page.trustState(), { visible: true, clears: 0 });
  page.scheduleRetry(3000);
  page.stop();
  assert.deepEqual(page.trustState(), { visible: false, clears: 1 });
  page.advance(5000);
  assert.deepEqual(page.trustState(), { visible: false, clears: 1 });
});

test('blank and whitespace address fields connect to the default phone', () => {
  const submit = /\$\('link-form'\)\.addEventListener\('submit', event => \{([\s\S]*?)\n\}\);/.exec(read('app.js'))[1];
  for (const value of ['', '   ', '169.254.111.112:9000', 'invalid']) {
    const fields = { code: { value: '1234', focus() {} }, host: { value, focus() {} } };
    const run = new Function('$', 'DEFAULT_HOST', 'normalizeHost', 'isCode', `
      let link, stopped, started = false;
      const active = false, event = { preventDefault() {} };
      const stop = value => { stopped = value; }, saveLink = () => {}, showLink = () => {};
      const start = () => { started = true; };
      function submit() { ${submit} }
      submit();
      return { link, stopped, started };
    `);
    const result = run(id => fields[id], DEFAULT_HOST, normalizeHost, isCode);
    if (value === 'invalid') {
      assert.equal(result.stopped, 'invalidHost');
      assert.equal(result.started, false);
    } else {
      assert.equal(result.link.host, value.trim() || DEFAULT_HOST);
      assert.equal(result.started, true);
    }
  }
});

test('disconnect is a separate full-width row immediately below connect', () => {
  const html = read('index.html');
  assert.match(html, /<button id="connect"[^>]*>[\s\S]*?<\/button>\s*<button id="disconnect" type="button"[^>]* hidden><\/button>/);
  assert.equal([...html.matchAll(/id="disconnect"/g)].length, 1);
  assert.match(read('style.css'), /#connect,#disconnect\{display:block;width:100%;/);
  assert.match(read('style.css'), /#disconnect\{margin-top:8px\}/);
});

test('the service worker precaches every playback file', () => {
  const assets = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(read('sw.js'))[1].replaceAll("'", '"'));
  const files = readdirSync(play, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name !== 'sw.js').map(entry => (entry.parentPath.slice(new URL(play).pathname.replace(/\/$/, '').length) + '/' + entry.name).replaceAll('\\', '/').replace(/^\/+/, ''));
  assert.deepEqual([...assets].filter(name => name !== './').sort(), files.sort());
});

test('the service worker answers only its own files, so the download pages in its scope reach the network', () => {
  const handlers = {};
  const worker = { location: new URL('https://example.test/DiPlay/sw.js'), addEventListener: (type, handler) => { handlers[type] = handler; } };
  const cache = { match: async () => new Response('cached') };
  new Function('self', 'caches', 'fetch', read('sw.js'))(worker, { open: async () => cache }, async () => new Response('network'));
  const answers = (url, method = 'GET') => {
    let answered = false;
    handlers.fetch({ request: { method, url }, respondWith: () => { answered = true; } });
    return answered;
  };
  for (const url of ['https://example.test/DiPlay/', 'https://example.test/DiPlay/?t=100.64.0.1', 'https://example.test/DiPlay/index.html',
    'https://example.test/DiPlay/app.js?v=2', 'https://example.test/DiPlay/decoder-worker.js', 'https://example.test/DiPlay/icon.svg',
    // The pairing link: a navigation's request URL keeps its fragment.
    'https://example.test/DiPlay/#c=1234', 'https://example.test/DiPlay/?t=100.64.0.1#c=1234']) {
    assert.ok(answers(url), url);
  }
  for (const url of ['https://example.test/DiPlay/download/', 'https://example.test/DiPlay/download/zh-Hans/',
    'https://example.test/DiPlay/download/assets/site.css', 'https://example.test/DiPlay/download/index.html',
    'https://example.test/DiPlay/download/#install', 'https://example.test/DiPlay/play/', 'https://example.test/DiPlay/play/#c=1234',
    'https://example.test/DiPlay/play/sw.js', 'https://example.test/DiPlay/sw.js',
    'https://example.test/DiPlay/app.js/', 'https://example.test/app.js', 'https://other.test/DiPlay/app.js',
    'http://100.109.220.253:8080/hello', 'http://100.109.220.253:8080/play/app.js']) {
    assert.ok(!answers(url), url);
  }
  assert.ok(!answers('https://example.test/DiPlay/', 'POST'));
});

test('the page loads only relative, same-origin resources', () => {
  const html = read('index.html');
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (url === 'https://github.com/uJZk/TiPlay') continue; // the GPL source link
    assert.match(url, /^[a-z][\w./-]*$/, url);
  }
  for (const name of ['app.js', 'decoder-worker.js', 'style.css']) {
    assert.doesNotMatch(read(name), /(?:import|from|url\()\s*['"(]?(?:https?:)?\/\//, name);
  }
});
