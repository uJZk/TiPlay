import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirPlayTrustNotification } from '../../site/play/airplay-trust.js';

function fixture() {
  let now = 0;
  const nodes = Object.fromEntries(['heading', 'name', 'allow', 'reject'].map(key => [key, {
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
  assert.equal(f.nodes.name.textContent, '<script>untrusted</script>');
  f.tick(4999); assert.equal(f.root.hidden, false);
  f.tick(5000); assert.equal(f.root.hidden, true);
  f.nodes.allow.click();
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
  f.nodes.allow.click(); f.nodes.allow.click();
  assert.deepEqual(f.sent, [{ k: 'ap-trust', id: 'first', allow: true }]);
  assert.equal(f.root.hidden, true);
  f.notification.update({ id: 'second', remainingMillis: 5000 });
  f.nodes.reject.click();
  assert.deepEqual(f.sent[1], { k: 'ap-trust', id: 'second', allow: false });
  f.notification.update({ id: 'second', remainingMillis: 3000 });
  assert.equal(f.root.hidden, true);
});

test('server cancellation and disconnect invalidate old UI actions', () => {
  const f = fixture();
  f.notification.update({ id: 'first', remainingMillis: 5000 });
  f.notification.update(null);
  f.nodes.allow.click(); assert.deepEqual(f.sent, []);
  f.notification.update({ id: 'second', remainingMillis: 5000 });
  f.notification.clear();
  f.nodes.allow.click(); assert.deepEqual(f.sent, []);
  assert.equal(f.root.hidden, true);
});

test('invalid status input never displays consent', () => {
  const f = fixture();
  for (const invalid of [null, {}, { id: 12, remainingMillis: 5000 }, { id: 'bad', remainingMillis: Infinity },
    { id: 'bad', remainingMillis: 0 }, { id: 'x'.repeat(65), remainingMillis: 5000 }]) {
    f.notification.update(invalid); assert.equal(f.root.hidden, true);
  }
});

test('the consent button explains whether the verified device will be remembered', () => {
  const f = fixture();
  f.notification.update({ id: 'verified', remainingMillis: 5000, verified: true });
  assert.equal(f.nodes.allow.textContent, 'Allow and remember');
  f.notification.update({ id: 'legacy', remainingMillis: 5000, verified: false });
  assert.equal(f.nodes.allow.textContent, 'Allow this connection');
});
