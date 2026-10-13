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
    let streamId = 0, sink = null, retryTimer, videoAbort, live, phase, lastViewport;
    const link = { code: '1234' }, session = 'session', PROTOCOL = 1;
    const videoPath = {};
    const browserAudio = { attach() {}, clock: value => events.push(['audio-clock', value]) };
    const mediaTiming = { reset: () => events.push('timing-reset') };
    const render = () => {}, reportAppearance = () => {}, scheduleViewport = () => {};
    const setInterval = () => 0, clearInterval = () => {};
    const stop = reason => { throw new Error(reason); };
    const sampleClock = serverMs => ({ offset: 10, rtt: 2, at: serverMs });
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

test('the service worker precaches every page file', () => {
  const assets = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(read('sw.js'))[1].replaceAll("'", '"'));
  const files = readdirSync(play).filter(name => name !== 'sw.js');
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
    if (url === 'https://github.com/uJZk/DiPlay') continue; // the GPL source link
    assert.match(url, /^[a-z][\w.-]*$/, url);
  }
  for (const name of ['app.js', 'decoder-worker.js', 'style.css']) {
    assert.doesNotMatch(read(name), /(?:import|from|url\()\s*['"(]?(?:https?:)?\/\//, name);
  }
});
