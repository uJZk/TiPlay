import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAirPlayControls } from '../../site/play/airplay-controls.js';
await import('../../site/play/airplay-photo.js');

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
test('video preparation uses the official buffering indicator without a second spinner or label', () => {
  const shell = readFileSync(new URL('../../site/play/videojs-player.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../site/play/airplay-controls.css', import.meta.url), 'utf8');
  assert.equal((shell.match(/<media-buffering-indicator\b/g) ?? []).length, 1);
  assert.match(styles, /\[data-preparing\][^\n]*\.media-buffering-indicator\s*\{\s*display:grid/);
  assert.doesNotMatch(styles, /airplay-preparation-spinner/);
});
class Element extends EventTarget {
  children = []; attributes = new Map(); dataset = {}; style = {}; hidden = false;
  append(...elements) { for (const element of elements) { element.parent = this; this.children.push(element); } }
  replaceChildren(...elements) { for (const element of this.children) element.parent = null; this.children = []; this.append(...elements); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(element => element !== this); this.parent = null; } }
}
function fixture(t, { moduleGate = null, photoDecode = async () => {} } = {}) {
  const previous = globalThis.document;
  globalThis.document = { createElement: name => Object.assign(new Element(), name === 'img' ? { decode: photoDecode } : {}) };
  const stage = new Element(), sent = [], requests = [], players = [];
  const controls = createAirPlayControls(stage, event => sent.push(event), 'en', {
    credentials: () => ({ code: 'resource-token', session: 'browser-owner' }), host: () => 'phone.test',
    fetchPhone(route, init) {
      const request = { ...deferred(), route, signal: init.signal };
      const aborted = () => request.reject(new DOMException('Request aborted', 'AbortError'));
      if (init.signal.aborted) aborted();
      else init.signal.addEventListener('abort', aborted, { once: true });
      requests.push(request); return request.promise;
    },
    async loadPlayer() {
      if (moduleGate) await moduleGate;
      return { createVideoPlayer(layer, options) {
        const media = Object.assign(new EventTarget(), { duration: 20, currentTime: 0, playbackRate: 1,
          paused: true, ended: false, seeking: false, readyState: 0, buffering: false, gestureRequired: false,
          buffered: { length: 0 }, seekable: { length: 0 }, audioTracks: [], textTracks: [],
          play() { this.paused = false; this.buffering = true; this.dispatchEvent(new Event('play')); return Promise.resolve(); },
          pause() { if (this.paused) return; this.paused = true; this.buffering = false; this.dispatchEvent(new Event('pause')); },
        });
        const gate = deferred(), surface = new Element(), stop = new Element();
        stop.addEventListener('click', options.stop); surface.append(stop); layer.append(surface);
        const player = { media, surface, stop, options, gate, disposed: false, failure: null,
          error() { return this.failure || media.error; },
          fail(message) { this.failure = { message }; media.pause(); },
          async source(...args) { this.sourceArguments = args; media.dispatchEvent(new Event('loadedmetadata')); await gate.promise; media.readyState = 2; },
          dispose() { this.disposed = true; stop.removeEventListener('click', options.stop); surface.remove(); },
        };
        players.push(player); return player;
      }, createAudioPlayer(layer, options) {
        const surface = new Element(), stop = new Element();
        stop.addEventListener('click', options.stop); surface.append(stop); layer.append(surface);
        const player = { surface, stop, options, snapshots: [], disposed: false,
          update(value) { this.snapshots.push(value); }, error: () => null, fail() {},
          dispose() { this.disposed = true; stop.removeEventListener('click', options.stop); surface.remove(); },
        };
        players.push(player); return player;
      }, createPhotoPlayer(layer, options) {
        const surface = new Element(), stop = new Element();
        stop.addEventListener('click', options.stop); surface.append(stop); layer.append(surface);
        const player = { surface, stop, options, disposed: false,
          dispose() { this.disposed = true; stop.removeEventListener('click', options.stop); surface.remove(); } };
        players.push(player); return player;
      } };
    },
  });
  t.after(() => { controls.dispose(); globalThis.document = previous; });
  const directive = (overrides = {}) => ({ id: 1, revision: 1, seekRevision: 1, trackRevision: 1,
    kind: 'video', resource: 'movie', proxyOnly: true, playing: true, target: 0, ...overrides });
  const layer = stage.children[0];
  const indicator = () => layer.getAttribute('data-preparing') !== null ? layer : undefined;
  const probeReady = async index => {
    await flush();
    assert.ok(requests[index], 'the player shell precedes its resource probe');
    requests[index].resolve(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } })); await flush();
  };
  return { controls, directive, layer, stage, get stop() { return players.at(-1)?.stop; }, sent, requests, players, indicator, probeReady };
}

test('cast preparation uses the player loading state until actual playing', async t => {
  const h = fixture(t);
  h.controls.update(h.directive());
  assert.equal(h.layer.hidden, false);
  assert.ok(h.indicator());
  assert.equal(h.layer.getAttribute('aria-busy'), 'true');
  assert.equal(h.players.length, 0, 'the player module has not loaded yet');
  assert.equal(h.layer.children.length, 0, 'no separate spinner or loading text is injected');
  assert.equal(h.stage.children.length, 1, 'no standalone Stop button remains');
  await flush();
  assert.equal(h.players.length, 1, 'the official player shell is present before resource headers arrive');
  assert.equal(h.layer.children.length, 1, 'only the Video.js player owns the loading surface');
  assert.equal(h.stop.hidden, false);
  await h.probeReady(0);
  const player = h.players[0];
  assert.equal(player.options.proxyOnly, true, 'Debug resource policy reaches the AVPlayer adapter');
  assert.equal(player.options.proxyOrigin, 'http://phone.test');
  assert.equal(h.players.length, 1, 'preparation keeps the same player shell');
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
  h.controls.update(h.directive()); await flush();
  assert.equal(h.stop.hidden, false); assert.ok(h.indicator());
  h.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 1, a: 'stop' });
  h.controls.update(null);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.players[0].disposed, true); assert.equal(h.layer.hidden, true); assert.equal(h.indicator(), undefined);
  await h.probeReady(0);
  assert.equal(h.players.length, 1); assert.equal(h.players[0].disposed, true); assert.equal(h.indicator(), undefined);
});

test('a pause received during preparation keeps loading until ready and never starts playback', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush();
  h.controls.update(h.directive({ revision: 2, playing: false })); await flush();
  assert.ok(h.indicator()); assert.equal(h.requests.length, 1);
  await h.probeReady(0);
  h.players[0].gate.resolve(); await flush();
  assert.equal(h.players[0].media.paused, true);
  assert.equal(h.indicator(), undefined);
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).revision, 2);
});

test('a gesture-blocked source hands loading to the existing Play prompt rather than spinning indefinitely', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush(); await h.probeReady(0);
  const player = h.players[0];
  player.gate.resolve(); await flush(); assert.ok(h.indicator());
  player.media.gestureRequired = true; player.media.dispatchEvent(new Event('progress'));
  assert.equal(h.indicator(), undefined);
  assert.equal(player.media.paused, false, 'pending playback intent belongs to the gesture prompt');
});

test('a rejected play that returns to paused leaves the ready controls usable without an endless spinner', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush(); await h.probeReady(0);
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
  h.controls.update(h.directive({ proxyOnly: false })); await flush();
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
  h.controls.update(h.directive()); await flush();
  h.controls.update(h.directive({ resource: 'replacement', revision: 2 })); await flush();
  const replacementIndicator = h.indicator();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].reject(new Error('Old request failed')); await flush();
  assert.equal(h.indicator(), replacementIndicator);
  assert.equal(h.sent.some(event => event.k === 'ap-state' && event.failed), false);
  await h.probeReady(1); h.players[1].gate.resolve(); await flush();
  h.players[1].media.dispatchEvent(new Event('playing'));
  assert.equal(h.indicator(), undefined);
});

test('a current probe failure replaces loading with the existing error message and Stop action', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush();
  h.requests[0].reject(new Error('Media headers timed out')); await flush();
  assert.equal(h.indicator(), undefined);
  assert.equal(h.layer.getAttribute('aria-busy'), null);
  assert.equal(h.players[0].failure.message, 'Unable to play video. Try again from your iPhone.');
  assert.equal(h.stop.hidden, false);
  h.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 1, a: 'stop' });
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).failed, true);
  h.controls.update(null); assert.equal(h.layer.hidden, true); assert.equal(h.layer.children.length, 0);
});

test('output permission hides and restores an early-error Stop action without retrying the failed resource', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush();
  h.requests[0].reject(new Error('Resource unavailable')); await flush();
  assert.equal(h.stop.hidden, false); assert.equal(h.layer.hidden, false);
  h.controls.update(h.directive({ outputAllowed: false, playing: false, revision: 2 })); await flush();
  assert.equal(h.layer.hidden, true);
  h.controls.update(h.directive({ outputAllowed: true, revision: 3 })); await flush();
  assert.equal(h.stop.hidden, false); assert.equal(h.layer.hidden, false);
  assert.equal(h.requests.length, 1, 'permission updates preserve the current failure rather than restarting loading');
  h.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 1, a: 'stop' });
  h.controls.update(h.directive({ resource: null, revision: 4 })); await flush();
  assert.equal(h.layer.hidden, true);
});

test('a source preparation failure retires its indicator and uses the player error surface', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush(); await h.probeReady(0);
  h.players[0].gate.reject(new DOMException('Unsupported video', 'NotSupportedError')); await flush();
  assert.equal(h.indicator(), undefined);
  assert.equal(h.players[0].failure.message, 'Unable to play video. Try again from your iPhone.');
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).failed, true);
});

test('a player import failure replaces loading with the current error surface', async t => {
  const gate = deferred(), h = fixture(t, { moduleGate: gate.promise });
  h.controls.update(h.directive()); await flush();
  assert.equal(h.requests.length, 0);
  gate.reject(new TypeError('Player module unavailable')); await flush();
  assert.equal(h.indicator(), undefined); assert.equal(h.players.length, 0);
  assert.equal(h.layer.children.find(element => element.className === 'airplay-error').textContent, 'Unable to play video. Try again from your iPhone.');
  assert.equal(h.sent.filter(event => event.k === 'ap-state').at(-1).failed, true);
});

for (const retire of ['stop', 'dispose']) test(`${retire} during player import cannot resurrect a player or loading indicator`, async t => {
  const gate = deferred(), h = fixture(t, { moduleGate: gate.promise });
  h.controls.update(h.directive()); await flush(); assert.ok(h.indicator());
  assert.equal(h.requests.length, 0);
  if (retire === 'stop') h.controls.update(null); else h.controls.dispose();
  gate.resolve(); await flush();
  assert.equal(h.players.length, 0); assert.equal(h.indicator(), undefined);
  assert.equal(h.layer.hidden, true);
  assert.equal(h.sent.some(event => event.k === 'ap-state'), false);
});

test('output permission hides preparation without restarting or prematurely playing it', async t => {
  const h = fixture(t);
  h.controls.update(h.directive({ outputAllowed: false, playing: false })); await flush();
  assert.equal(h.layer.hidden, true); assert.ok(h.indicator());
  await h.probeReady(0); h.players[0].gate.resolve(); await flush();
  assert.equal(h.players[0].media.paused, true); assert.equal(h.layer.hidden, true);
  assert.equal(h.indicator(), undefined, 'prepared, intentionally paused output is not buffering');
  h.controls.update(h.directive({ outputAllowed: true, playing: true, revision: 2 })); await flush();
  assert.equal(h.layer.hidden, false); assert.equal(h.requests.length, 1);
  assert.equal(h.players[0].media.paused, false);
  h.players[0].media.dispatchEvent(new Event('playing'));
  assert.equal(h.indicator(), undefined);
});

test('output revocation pauses current playback independently of the directive revision', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await h.probeReady(0);
  const player = h.players[0]; player.gate.resolve(); await flush();
  assert.equal(player.media.paused, false);
  h.controls.update(h.directive({ outputAllowed: false }));
  assert.equal(player.media.paused, true); assert.equal(h.layer.hidden, true);
  assert.equal(h.controls.videoActive(), false);
  h.controls.update(h.directive({ outputAllowed: true }));
  assert.equal(player.media.paused, false); assert.equal(h.layer.hidden, false);
  assert.equal(h.players.length, 1, 'permission changes retain the current resource and seek');
});

test('returning only the video picture keeps permitted URL audio running and reports its actual state', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await h.probeReady(0);
  const player = h.players[0]; player.gate.resolve(); await flush();
  player.media.currentTime = 6;
  h.controls.update(h.directive({ revision: 2, videoShown: false }));
  assert.equal(h.layer.hidden, true); assert.equal(h.controls.videoActive(), false);
  assert.equal(player.media.paused, false, 'picture ownership is independent of URL audio permission');
  player.media.dispatchEvent(new Event('playing'));
  const report = h.sent.filter(event => event.k === 'ap-state').at(-1);
  assert.equal(report.playing, true); assert.equal(report.position, 6);
  h.controls.update(h.directive({ revision: 3, videoShown: true }));
  assert.equal(h.layer.hidden, false); assert.equal(h.controls.videoActive(), true);
  assert.equal(player.media.currentTime, 6); assert.equal(h.players.length, 1);
  h.controls.dispose(); assert.equal(h.controls.videoActive(), false);
});

test('sender mute applies before playback and remains independent of returning the picture', async t => {
  const h = fixture(t);
  h.controls.update(h.directive({ muted: true })); await h.probeReady(0);
  const player = h.players[0]; player.gate.resolve(); await flush();
  assert.equal(player.media.muted, true);
  h.controls.update(h.directive({ revision: 2, videoShown: false, muted: true }));
  assert.equal(player.media.muted, true); assert.equal(player.media.paused, false);
  h.controls.update(h.directive({ revision: 3, videoShown: false, muted: false }));
  assert.equal(player.media.muted, false); assert.equal(h.layer.hidden, true);
});

test('a controls-adapter cleanup failure cannot retain a cast surface or revive a disposed owner', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await h.probeReady(0);
  const player = h.players[0]; player.gate.resolve(); await flush();
  let mediaRetired = 0;
  player.media.dispose = () => { mediaRetired++; };
  player.dispose = () => { throw new Error('Controls adapter already disconnected'); };
  assert.doesNotThrow(() => h.controls.update(null));
  assert.equal(mediaRetired, 1); assert.equal(h.layer.children.length, 0);
  assert.equal(h.layer.hidden, true); assert.equal(h.controls.videoActive(), false);
  h.controls.dispose();
  h.controls.update(h.directive({ id: 2 })); h.controls.setCarPlayRunning(false); await flush();
  assert.equal(h.players.length, 1); assert.equal(h.controls.videoActive(), false);
});

test('a direct resource fallback applies proxy-only policy to the actual AVPlayer source', async t => {
  const h = fixture(t);
  h.controls.update(h.directive({ proxyOnly: false })); await flush();
  h.requests[0].reject(new TypeError('Direct source unavailable')); await flush();
  await h.probeReady(1);
  assert.equal(h.players[0].sourceArguments[2].proxyOnly, true);
  h.players[0].gate.resolve(); await flush();
});

test('a current photo decode failure reports its owner so Android can return the borrowed picture', async t => {
  const h = fixture(t, { photoDecode: async () => { throw new Error('Image decoder rejected the content'); } });
  h.controls.update({ id: 40, kind: 'photo', resource: 'photo', outputAllowed: true }); await flush();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAwAAAABJRU5ErkJggg==', 'base64');
  h.requests[0].resolve(new Response(bytes, { headers: { 'Content-Type': 'image/png' } })); await flush();
  assert.deepEqual(h.sent.filter(event => event.k === 'ap-state'), [{ k: 'ap-state', id: 40, failed: true }]);
  h.controls.update(null); assert.equal(h.layer.hidden, true); assert.equal(h.players[0].disposed, true);
});

test('a replaced photo decode failure cannot fail or clear its replacement', async t => {
  const decode = deferred(), h = fixture(t, { photoDecode: () => decode.promise });
  h.controls.update({ id: 40, kind: 'photo', resource: 'photo', outputAllowed: true }); await flush();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAwAAAABJRU5ErkJggg==', 'base64');
  h.requests[0].resolve(new Response(bytes, { headers: { 'Content-Type': 'image/png' } })); await flush();
  h.controls.update(h.directive({ id: 41 })); await flush();
  decode.reject(new Error('Old image decoder completed late')); await flush();
  assert.equal(h.sent.some(event => event.k === 'ap-state' && event.failed), false);
  assert.equal(h.layer.hidden, false); assert.equal(h.players.at(-1).disposed, false);
});

test('audio snapshots update one shared player and its controls retain the playback owner', async t => {
  const h = fixture(t);
  const audio = { id: 41, kind: 'audio', title: 'First song', artist: 'Test artist', duration: 180,
    position: 12, playing: true, ready: true, controls: ['play', 'pause', 'stop'] };
  h.controls.update(audio); await flush();
  assert.equal(h.stage.children.length, 1, 'audio has no separate floating button');
  assert.equal(h.players.length, 1); assert.equal(h.layer.hidden, false);
  const player = h.players[0];
  assert.equal(player.snapshots.at(-1).title, 'First song');
  assert.equal(player.snapshots.at(-1).canPause, true);
  h.controls.update({ ...audio, title: 'Second song', position: 20 }); await flush();
  assert.equal(h.players.length, 1, 'track metadata does not replace the transport or control shell');
  assert.equal(player.snapshots.at(-1).title, 'Second song');
  assert.equal(player.snapshots.at(-1).position, 20);
  player.options.onPause(); player.options.onPlay(); player.stop.dispatchEvent(new Event('click'));
  assert.deepEqual(h.sent, [{ k: 'ap', id: 41, a: 'pause' }, { k: 'ap', id: 41, a: 'play' }, { k: 'ap', id: 41, a: 'stop' }]);
  assert.equal(h.requests.length, 0, 'realtime playback is not opened as a second URL source');
});

test('CarPlay retires the audio interface while retaining current metadata for its later return', async t => {
  const h = fixture(t);
  const audio = { id: 41, kind: 'audio', title: 'First song', duration: 180, position: 12,
    playing: true, controls: ['play', 'pause', 'stop'] };
  h.controls.update(audio); await flush();
  const old = h.players[0];
  h.controls.setCarPlayRunning(true);
  assert.equal(old.disposed, true); assert.equal(h.layer.hidden, true);
  assert.equal(h.controls.videoActive(), false, 'the music screen cannot obscure CarPlay recovery');
  old.options.onPause(); old.options.stop();
  h.controls.update({ ...audio, title: 'Changed during CarPlay', position: 40 }); await flush();
  assert.equal(h.players.length, 1, 'background audio cannot rebuild a hidden player');
  assert.deepEqual(h.sent, [], 'UI retirement must not pause or stop the independent audio transport');
  h.controls.setCarPlayRunning(false); await flush();
  assert.equal(h.players.length, 2); assert.equal(h.layer.hidden, false);
  assert.equal(h.players[1].snapshots.at(-1).title, 'Changed during CarPlay');
  assert.equal(h.players[1].snapshots.at(-1).position, 40);
  assert.equal(h.controls.videoActive(), true);
  old.options.onPlay(); old.options.stop();
  assert.deepEqual(h.sent, [], 'a returning screen with the same item ID still needs fresh control ownership');
});

test('CarPlay arriving during the player import cannot briefly resurrect the audio interface', async t => {
  const gate = deferred(), h = fixture(t, { moduleGate: gate.promise });
  h.controls.update({ id: 41, kind: 'audio', title: 'Hidden song' }); await flush();
  h.controls.setCarPlayRunning(true);
  gate.resolve(); await flush();
  assert.equal(h.players.length, 0); assert.equal(h.layer.hidden, true);
  assert.deepEqual(h.sent, []);
  h.controls.setCarPlayRunning(false); await flush();
  assert.equal(h.players.length, 1); assert.equal(h.layer.hidden, false);
  assert.equal(h.players[0].snapshots.at(-1).title, 'Hidden song');
});

test('a retired video control callback cannot stop the replacement playback', async t => {
  const h = fixture(t);
  h.controls.update(h.directive()); await flush();
  const old = h.players[0];
  h.controls.update(h.directive({ id: 2, resource: 'replacement' })); await flush();
  assert.equal(old.disposed, true);
  old.options.stop();
  assert.deepEqual(h.sent.filter(event => event.k === 'ap'), []);
  h.players[1].options.stop();
  assert.deepEqual(h.sent.filter(event => event.k === 'ap'), [{ k: 'ap', id: 2, a: 'stop' }]);
});

const audioNavigation = [
  ['onPrevious', 'previous', 'canPrevious'], ['onNext', 'next', 'canNext'],
  ['onSkipBack', 'skip-back', 'canSkipBack'], ['onSkipForward', 'skip-forward', 'canSkipForward'],
];

test('audio navigation follows receiver capabilities without inventing a live seek target', async t => {
  const h = fixture(t);
  const audio = { id: 41, kind: 'audio', duration: 180, position: 90, playing: true,
    seekable: false, controls: ['play', 'pause', 'stop', 'previous', 'next', 'skip-back', 'skip-forward'] };
  h.controls.update(audio); await flush();
  const player = h.players[0];
  for (const [callback, action, capability] of audioNavigation) {
    assert.equal(player.snapshots.at(-1)[capability], true);
    player.options[callback]();
    assert.deepEqual(h.sent.at(-1), { k: 'ap', id: 41, a: action });
  }
  assert.equal(player.snapshots.at(-1).position, 90, 'only receiver progress can move the music timeline');
  assert.equal(h.sent.some(event => Object.hasOwn(event, 'v') || event.a === 'seek'), false);
  h.controls.update({ ...audio, remotePending: true }); await flush();
  const pendingCount = h.sent.length;
  for (const [callback, , capability] of audioNavigation) {
    assert.equal(player.snapshots.at(-1)[capability], false);
    player.options[callback]();
  }
  assert.equal(h.sent.length, pendingCount, 'saved callbacks cannot enqueue a second remote navigation command');
  assert.equal(player.snapshots.at(-1).position, 90, 'pending commands do not optimistically move progress');
  h.controls.update({ ...audio, remotePending: false }); await flush();
  for (const [, , capability] of audioNavigation) assert.equal(player.snapshots.at(-1)[capability], true);
  player.options.onSkipForward();
  assert.deepEqual(h.sent.at(-1), { k: 'ap', id: 41, a: 'skip-forward' });
  assert.equal(player.snapshots.at(-1).position, 90, 'sending a fresh skip still waits for sender progress');
  h.controls.update({ ...audio, position: 100 }); await flush();
  assert.equal(player.snapshots.at(-1).position, 100, 'confirmed receiver progress advances the display');
  h.controls.update({ ...audio, controls: ['play', 'pause', 'stop'] }); await flush();
  assert.equal(h.players.length, 1, 'capability changes update the current shell');
  const count = h.sent.length;
  for (const [callback, , capability] of audioNavigation) {
    assert.equal(player.snapshots.at(-1)[capability], false);
    player.options[callback]();
  }
  assert.equal(h.sent.length, count, 'saved callbacks cannot use revoked navigation capabilities');
});

test('unavailable audio navigation stays inert and retired callbacks cannot control a successor', async t => {
  const h = fixture(t);
  const audio = { id: 41, kind: 'audio', duration: 180, position: 90, playing: true };
  h.controls.update(audio); await flush();
  const old = h.players[0];
  for (const [callback, , capability] of audioNavigation) {
    assert.equal(old.snapshots.at(-1)[capability], false);
    old.options[callback]();
  }
  assert.deepEqual(h.sent, [], 'even direct callback invocation needs a current receiver capability');
  const controls = ['play', 'pause', 'stop', ...audioNavigation.map(([, action]) => action)];
  h.controls.update({ ...audio, controls }); await flush();
  h.controls.setCarPlayRunning(true);
  for (const [callback] of audioNavigation) old.options[callback]();
  assert.deepEqual(h.sent, [], 'CarPlay UI retirement never sends navigation commands');
  h.controls.update({ ...audio, id: 42, controls }); await flush();
  h.controls.setCarPlayRunning(false); await flush();
  const current = h.players[1];
  for (const [callback] of audioNavigation) old.options[callback]();
  assert.deepEqual(h.sent, [], 'old callbacks cannot navigate the new playback ID');
  current.options.onNext();
  assert.deepEqual(h.sent, [{ k: 'ap', id: 42, a: 'next' }]);
});
