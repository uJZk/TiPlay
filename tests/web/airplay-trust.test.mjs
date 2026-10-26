import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirPlayTrustNotification } from '../../site/play/airplay-trust.js';

function fixture() {
  let now = 0;
  const nodes = Object.fromEntries(['heading', 'name', 'details', 'allow', 'once', 'reject'].map(key => [key, {
    textContent: '', listener: null, addEventListener(_type, fn) { this.listener = fn; }, click() { this.listener(); },
  }]));
  const root = { hidden: true, querySelector(selector) { return nodes[selector.match(/data-trust-(\w+)/)[1]]; } };
  const timers = new Map(), sent = [];
  let nextTimer = 0;
  const notification = createAirPlayTrustNotification(root, event => sent.push(event), 'en', {
    now: () => now,
    setTimer(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, deadline: now + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  function tick(time) {
    now = time;
    for (const [id, timer] of timers) if (timer.deadline <= now) { timers.delete(id); timer.fn(); }
  }
  return { nodes, root, notification, sent, tick };
}

test('a five-second prompt disappears without granting or sending automatic consent', () => {
  const f = fixture();
  f.notification.update({ id: 'first', name: '<script>untrusted</script>', remainingMillis: 5000 });
  assert.equal(f.root.hidden, false);
  assert.equal(f.nodes.name.textContent, 'From “<script>untrusted</script>”.');
  f.tick(4999); assert.equal(f.root.hidden, false);
  f.tick(5000); assert.equal(f.root.hidden, true);
  f.nodes.once.click();
  assert.deepEqual(f.sent, []);
  f.notification.update({ id: 'first', name: 'Retry', remainingMillis: 5000 });
  assert.equal(f.root.hidden, true, 'an expired ID cannot reopen on a delayed poll');
});

test('polls cannot extend the original deadline and forged durations are bounded', () => {
  const f = fixture();
  f.notification.update({ id: 'first', remainingMillis: 999999 });
  f.tick(4000);
  f.notification.update({ id: 'first', remainingMillis: 5000 });
  f.tick(5000);
  assert.equal(f.root.hidden, true);
  assert.deepEqual(f.sent, []);
});

test('only a click on the live prompt sends an explicit Allow or Reject over control', () => {
  const f = fixture();
  f.notification.update({ id: 'first', remainingMillis: 5000 });
  f.nodes.once.click(); f.nodes.once.click();
  assert.deepEqual(f.sent, [{ k: 'ap-trust', id: 'first', allow: true, remember: false }]);
  assert.equal(f.root.hidden, true);
  f.notification.update({ id: 'second', remainingMillis: 5000 });
  f.nodes.reject.click();
  assert.deepEqual(f.sent[1], { k: 'ap-trust', id: 'second', allow: false, remember: false });
  f.notification.update({ id: 'second', remainingMillis: 3000 });
  assert.equal(f.root.hidden, true);
});

test('server cancellation and disconnect invalidate old UI actions', () => {
  const f = fixture();
  f.notification.update({ id: 'first', remainingMillis: 5000 });
  f.notification.update(null);
  f.nodes.once.click(); assert.deepEqual(f.sent, []);
  f.notification.update({ id: 'second', remainingMillis: 5000 });
  f.notification.clear();
  f.nodes.once.click(); assert.deepEqual(f.sent, []);
  assert.equal(f.root.hidden, true);
});

test('invalid status input never displays consent', () => {
  const f = fixture();
  for (const invalid of [null, {}, { id: 12, remainingMillis: 5000 }, { id: 'bad', remainingMillis: Infinity },
    { id: 'bad', remainingMillis: 0 }, { id: 'x'.repeat(65), remainingMillis: 5000 }]) {
    f.notification.update(invalid); assert.equal(f.root.hidden, true);
  }
});

test('all senders get all three choices without identity warnings', () => {
  const f = fixture();
  for (const verified of [true, false]) {
    const id = String(verified);
    f.notification.update({ id, remainingMillis: 5000, verified, mediaType: 'audio', name: 'iPhone' });
    assert.equal(f.nodes.allow.textContent, 'Always allow');
    assert.equal(f.nodes.once.textContent, 'Allow once');
    assert.equal(f.nodes.heading.textContent, 'Allow AirPlay audio?');
    assert.equal(f.nodes.details.textContent, 'Plays audio while keeping the CarPlay picture.');
    f.nodes.once.click();
    assert.deepEqual(f.sent.at(-1), { k: 'ap-trust', id, allow: true, remember: false });
  }
});

test('always allow sends persistent consent for any sender, without verification gating', () => {
  const f = fixture();
  for (const verified of [true, false]) {
    const id = String(verified);
    f.notification.update({ id, verified, remainingMillis: 5000 });
    f.nodes.allow.click();
    assert.deepEqual(f.sent.at(-1), { k: 'ap-trust', id, allow: true, remember: true });
  }
});

test('casting type explains screen takeover, and unknown values never invent a type', () => {
  const f = fixture();
  for (const [mediaType, title] of [['mirror', 'screen mirroring'], ['video', 'video'], ['photo', 'photos']]) {
    f.notification.update({ id: mediaType, mediaType, remainingMillis: 5000, verified: true });
    assert.ok(f.nodes.heading.textContent.includes(title));
    assert.match(f.nodes.details.textContent, /in place of the CarPlay picture/);
  }
  f.notification.update({ id: 'other', mediaType: '<video>', name: '\u0000\n', remainingMillis: 5000 });
  assert.equal(f.nodes.heading.textContent, 'Allow an AirPlay connection?');
  assert.equal(f.nodes.name.textContent, 'From “AirPlay”.');
  assert.match(f.nodes.details.textContent, /not known yet/);
});
