import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserLocation, loadDatum, saveDatum, locationEvents } from '../../site/play/geolocation.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
function harness({ secure = true } = {}) {
  let time = 0, callback, error, watches = 0, clears = 0;
  const events = [], issues = [];
  const saved = storage();
  const location = createBrowserLocation({ storage: saved, secure, onIssue: issue => issues.push(issue), now: () => time,
    wall: () => 1_800_000_000_000 + time, push: event => events.push(event),
    navigator: { userAgent: 'test-browser', geolocation: {
      watchPosition(ok, fail, options) { callback = ok; error = fail; watches++; assert.equal(options.maximumAge, 0); return watches; },
      clearWatch() { clears++; },
    } },
  });
  return { location, events, issues, saved,
    time: value => { time = value; }, watches: () => watches, clears: () => clears,
    fix: (timestamp = 10, overrides = {}) => callback({ timestamp, coords: { latitude: 39.9, longitude: 116.4,
      accuracy: 10, altitude: null, heading: null, speed: null, ...overrides } }),
    error: code => error({ code }), callback: () => callback };
}

test('datum persistence is local to this browser version and stores no positions', () => {
  const saved = storage();
  saveDatum(saved, 'one', 'WGS84');
  assert.equal(loadDatum(saved, 'one'), 'WGS84');
  assert.equal(loadDatum(saved, 'two'), null);
  assert.doesNotMatch([...saved.values.values()][0], /lat|lon/);
  saveDatum(saved, 'one', 'unknown');
  assert.equal(loadDatum(saved, 'one'), 'WGS84');
  assert.equal(loadDatum({ getItem() { throw Error(); } }, 'one'), null);
});

test('the browser starts its own permission flow only when CarPlay requests location and disabling releases the watch', () => {
  const h = harness();
  h.location.update({ enabled: true, active: false });
  assert.equal(h.watches(), 0);
  h.location.update({ enabled: true, active: true });
  assert.equal(h.watches(), 1);
  const late = h.callback();
  h.location.update({ enabled: false, active: true });
  assert.equal(h.clears(), 1);
  late({ timestamp: 10, coords: { latitude: 39.9, longitude: 116.4, accuracy: 10 } });
  assert.equal(h.events.length, 0);
});

test('duplicates and imprecise coordinates are filtered, confirmed datum travels on later fixes', () => {
  const h = harness();
  h.location.update({ enabled: true, active: true });
  h.fix(); h.fix(); h.fix(11, { accuracy: 1000 });
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].datum, null);
  h.location.update({ enabled: true, active: true, datum: 'GCJ02' });
  h.fix(12);
  assert.equal(h.events[1].datum, 'GCJ02');
  assert.equal(h.events[1].altitude, null);
  assert.equal(h.events[1].timestamp, 12, 'non-Unix timestamps remain source metadata');
});

test('queued and retried fixes expire using monotonic age without depending on source epoch', () => {
  const h = harness(); h.location.update({ enabled: true, active: true });
  h.time(100); h.fix(1000000);
  assert.equal(locationEvents(h.events, 150)[0].age, 50);
  assert.equal(locationEvents(h.events, 4000).length, 0);
  assert.deepEqual(locationEvents([{ k: 'key', n: 'home' }], 4000), [{ k: 'key', n: 'home' }]);
});

test('permission denial stops collection, while insecure contexts never start a watch', () => {
  const h = harness(); h.location.update({ enabled: true, active: true }); h.error(1);
  assert.equal(h.clears(), 1);
  assert.equal(h.issues[0], 'permission');
  h.location.update({ enabled: true, active: true });
  assert.equal(h.watches(), 1, 'denial does not trigger another permission request on a heartbeat');
  const insecure = harness({ secure: false });
  insecure.location.update({ enabled: true, active: true });
  assert.equal(insecure.watches(), 0);
  assert.deepEqual(insecure.issues, ['insecure']);
});

test('collection stays off until both the setting and the CarPlay request are active', () => {
  const h = harness();
  h.location.update({ enabled: false, active: true });
  h.location.update({ enabled: true, active: false });
  assert.equal(h.watches(), 0);
  h.location.update({ enabled: true, active: true });
  assert.equal(h.watches(), 1);
  h.location.stop();
  assert.equal(h.clears(), 1);
});
