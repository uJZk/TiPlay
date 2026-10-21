import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirPlayControls } from '../../site/play/airplay-controls.js';

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class Element extends EventTarget {
  children = []; attributes = new Map(); dataset = {}; hidden = false;
  append(...elements) { for (const element of elements) { element.parent = this; this.children.push(element); } }
  replaceChildren(...elements) { for (const element of this.children) element.parent = null; this.children = []; this.append(...elements); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(element => element !== this); this.parent = null; } }
}
function fixture(t, { moduleGate = null } = {}) {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  const stage = new Element(), sent = [], requests = [], players = [];
  const controls = createAirPlayControls(stage, event => sent.push(event), 'en', {
    credentials: () => ({ code: 'resource-token', session: 'browser-owner' }), host: () => 'phone.test',
    fetchPhone(route, init) {
      const request = { ...deferred(), route, signal: init.signal };
      requests.push(request); return request.promise;
    },
    async loadPlayer() {
      if (moduleGate) await moduleGate;
      return { createVideoPlayer() {
        const media = Object.assign(new EventTarget(), { duration: 20, currentTime: 0, playbackRate: 1,
          paused: true, ended: false, seeking: false, readyState: 0, buffering: false, gestureRequired: false,
          buffered: { length: 0 }, seekable: { length: 0 }, audioTracks: [], textTracks: [],
          play() { this.paused = false; this.buffering = true; this.dispatchEvent(new Event('play')); return Promise.resolve(); },
          pause() { if (this.paused) return; this.paused = true; this.buffering = false; this.dispatchEvent(new Event('pause')); },
        });
        const gate = deferred();
        const player = { media, surface: new Element(), gate, disposed: false, failure: null,
          error() { return this.failure || media.error; },
          fail(message) { this.failure = { message }; media.pause(); },
          async source() { media.dispatchEvent(new Event('loadedmetadata')); await gate.promise; media.readyState = 2; },
          dispose() { this.disposed = true; },
        };
        players.push(player); return player;
      } };
    },
  });
  t.after(() => { controls.dispose(); globalThis.document = previous; });
  const directive = (overrides = {}) => ({ id: 1, revision: 1, seekRevision: 1, trackRevision: 1,
    kind: 'video', resource: 'movie', proxyOnly: true, playing: true, target: 0, ...overrides });
  const layer = stage.children[0], stop = stage.children[1];
  const indicator = () => layer.children.find(element => element.className === 'airplay-preparation media-skin');
  const probeReady = async index => {
    requests[index].resolve(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } })); await flush();
  };
  return { controls, directive, layer, stop, sent, requests, players, indicator, probeReady };
}

test('cast loading is visible before probing and persists through source readiness until actual playing', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  assert.equal(h.layer.hidden, false);
  assert.equal(h.indicator().getAttribute('role'), 'status');
  assert.match(h.indicator().getAttribute('aria-label'), /buffering/);
  assert.equal(h.layer.getAttribute('aria-busy'), 'true');
  assert.equal(h.stop.hidden, false, 'the existing Stop action is usable before the first header arrives');
  assert.equal(h.players.length, 0, 'the initial indicator does not wait for resource headers or Video.js');
  await h.probeReady(0);
  const player = h.players[0];
  assert.equal(h.stop.hidden, true, 'the official player now owns the single Stop action');
  assert.ok(h.indicator(), 'metadata and first decoded samples are still preparing');
  player.gate.resolve(); await flush();
  assert.equal(player.media.paused, false);
  assert.ok(h.indicator(), 'source-ready is not actual playback');
  player.media.buffering = false; player.media.dispatchEvent(new Event('playing'));
  assert.equal(h.indicator(), undefined);
  assert.equal(h.layer.getAttribute('aria-busy'), null);
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).buffering, false);
});

test('Stop during the initial resource probe sends the current owner command and retirement cancels loading', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  assert.equal(h.stop.hidden, false); assert.ok(h.indicator());
  h.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 1, a: 'stop' });
  h.controls.update(null);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.stop.hidden, true); assert.equal(h.layer.hidden, true); assert.equal(h.indicator(), undefined);
  await h.probeReady(0);
  assert.equal(h.players.length, 0); assert.equal(h.indicator(), undefined);
});

test('a pause received during preparation keeps loading until ready and never starts playback', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  h.controls.update(h.directive({ revision: 2, playing: false }));
  assert.ok(h.indicator()); assert.equal(h.requests.length, 1);
  await h.probeReady(0);
  h.players[0].gate.resolve(); await flush();
  assert.equal(h.players[0].media.paused, true);
  assert.equal(h.indicator(), undefined);
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).revision, 2);
});

test('a gesture-blocked source hands loading to the existing Play prompt rather than spinning indefinitely', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await h.probeReady(0);
  const player = h.players[0];
  player.gate.resolve(); await flush(); assert.ok(h.indicator());
  player.media.gestureRequired = true; player.media.dispatchEvent(new Event('progress'));
  assert.equal(h.indicator(), undefined);
  assert.equal(player.media.paused, false, 'pending playback intent belongs to the gesture prompt');
});

test('a rejected play that returns to paused leaves the ready controls usable without an endless spinner', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await h.probeReady(0);
  const player = h.players[0];
  player.media.play = async function () {
    this.paused = false; this.dispatchEvent(new Event('play'));
    this.pause(); throw new DOMException('Audio resume was rejected', 'NotAllowedError');
  };
  player.gate.resolve(); await flush();
  assert.equal(h.indicator(), undefined); assert.equal(player.media.paused, true);
  assert.equal(player.failure, null, 'normal paused controls retain the retry action');
});

test('direct-to-proxy fallback keeps the same loading surface across both header probes', async t => {
  const h = fixture(t);
  h.controls.update(h.directive({ proxyOnly: false }));
  const indicator = h.indicator();
  h.requests[0].reject(new TypeError('Direct resource unavailable')); await flush();
  assert.equal(h.requests.length, 2); assert.equal(h.indicator(), indicator);
  assert.equal(h.sent.some(event => event.k === 'ap-state' && event.failed), false);
  await h.probeReady(1); h.players[0].gate.resolve(); await flush();
  h.players[0].media.dispatchEvent(new Event('playing'));
  assert.equal(h.indicator(), undefined);
});

test('an old probe failure cannot remove the replacement indicator or publish failure for its owner', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  h.controls.update(h.directive({ resource: 'replacement', revision: 2 }));
  const replacementIndicator = h.indicator();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].reject(new Error('Old request failed')); await flush();
  assert.equal(h.indicator(), replacementIndicator);
  assert.equal(h.sent.some(event => event.k === 'ap-state' && event.failed), false);
  await h.probeReady(1); h.players[0].gate.resolve(); await flush();
  h.players[0].media.dispatchEvent(new Event('playing'));
  assert.equal(h.indicator(), undefined);
});

test('a current probe failure replaces loading with the existing error message and Stop action', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  h.requests[0].reject(new Error('Media headers timed out')); await flush();
  assert.equal(h.indicator(), undefined);
  assert.equal(h.layer.getAttribute('aria-busy'), null);
  const message = h.layer.children.find(element => element.className === 'airplay-error');
  assert.equal(message.role, 'alert'); assert.equal(message.textContent, 'Unable to play video');
  assert.equal(h.stop.hidden, false);
  h.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 1, a: 'stop' });
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).failed, true);
  h.controls.update(null); assert.equal(h.layer.hidden, true); assert.equal(h.layer.children.length, 0);
});

test('output permission hides and restores an early-error Stop action without retrying the failed resource', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  h.requests[0].reject(new Error('Resource unavailable')); await flush();
  assert.equal(h.stop.hidden, false); assert.equal(h.layer.hidden, false);
  h.controls.update(h.directive({ outputAllowed: false, playing: false, revision: 2 }));
  assert.equal(h.stop.hidden, true); assert.equal(h.layer.hidden, true);
  h.controls.update(h.directive({ outputAllowed: true, revision: 3 }));
  assert.equal(h.stop.hidden, false); assert.equal(h.layer.hidden, false);
  assert.equal(h.requests.length, 1, 'permission updates preserve the current failure rather than restarting loading');
  h.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 1, a: 'stop' });
  h.controls.update(h.directive({ resource: null, revision: 4 }));
  assert.equal(h.stop.hidden, true); assert.equal(h.layer.hidden, true);
});

test('a source preparation failure retires its indicator and uses the player error surface', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await h.probeReady(0);
  h.players[0].gate.reject(new DOMException('Unsupported video', 'NotSupportedError')); await flush();
  assert.equal(h.indicator(), undefined);
  assert.equal(h.players[0].failure.message, 'Unable to play video');
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).failed, true);
});

test('a player import failure replaces loading with the current error surface', async t => {
  const gate = deferred(), h = fixture(t, { moduleGate: gate.promise });
  h.controls.update(h.directive()); await h.probeReady(0);
  gate.reject(new TypeError('Player module unavailable')); await flush();
  assert.equal(h.indicator(), undefined); assert.equal(h.players.length, 0);
  assert.equal(h.layer.children.find(element => element.className === 'airplay-error').textContent, 'Unable to play video');
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).failed, true);
});

for (const retire of ['stop', 'dispose']) test(`${retire} during player import cannot resurrect a player or loading indicator`, async t => {
  const gate = deferred(), h = fixture(t, { moduleGate: gate.promise });
  h.controls.update(h.directive()); await h.probeReady(0); assert.ok(h.indicator());
  if (retire === 'stop') h.controls.update(null); else h.controls.dispose();
  gate.resolve(); await flush();
  assert.equal(h.players.length, 0); assert.equal(h.indicator(), undefined);
  assert.equal(h.layer.hidden, true);
  assert.equal(h.sent.some(event => event.k === 'ap-state'), false);
});

test('output permission hides preparation without restarting or prematurely playing it', async t => {
  const h = fixture(t);
  h.controls.update(h.directive({ outputAllowed: false, playing: false }));
  assert.equal(h.layer.hidden, true); assert.ok(h.indicator());
  await h.probeReady(0); h.players[0].gate.resolve(); await flush();
  assert.equal(h.players[0].media.paused, true); assert.equal(h.layer.hidden, true);
  assert.equal(h.indicator(), undefined, 'prepared, intentionally paused output is not buffering');
  h.controls.update(h.directive({ outputAllowed: true, playing: true, revision: 2 }));
  assert.equal(h.layer.hidden, false); assert.equal(h.requests.length, 1);
  assert.equal(h.players[0].media.paused, false);
  h.players[0].media.dispatchEvent(new Event('playing'));
  assert.equal(h.indicator(), undefined);
});
