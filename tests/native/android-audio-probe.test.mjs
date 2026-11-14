// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { acceptUpstreamDatagram, countIpv4LinkLocalHostCandidates, drainAndRemoveMappings, instrumentationResultCollector,
  removeAndroidMapping, runCleanupActions } from './android-audio-probe.mjs';

test('cleanup attempts every owned resource and retains failed emulator redirects', async () => {
  const calls = [], mappings = new Map(), nat = { activeMappings: 2, redirectCommandsRemoved: 0 };
  const closed = label => ({ close(done) { calls.push(label); done(); } });
  for (const [key, port] of [['one', 10001], ['two', 10002]]) mappings.set(key, {
    publicSocket: closed(key + '-public'), flows: new Map([['flow', { socket: closed(key + '-flow') }]]),
    forwardingRecord: Object.freeze({ fixtureId: port }),
  });
  let failFirst = true;
  const forwarding = { remove: async record => {
    calls.push('record:' + record.fixtureId);
    if (record.fixtureId === 10001 && failFirst) throw Error('private endpoint must never reach cleanup output');
  } };
  const actions = [...mappings].map(([key, value]) => ['udp-mapping', () => removeAndroidMapping({ key, value, mappings, nat, forwarding })]);
  actions.push(['adb-forward', async () => { calls.push('forward'); throw Error('private-forward'); }],
    ['streams', async () => { calls.push('streams'); }], ['force-stop', async () => { calls.push('force-stop'); }]);
  await assert.rejects(runCleanupActions(actions), error => {
    assert.equal(error.message, 'Android cleanup failed: udp-mapping, adb-forward.'); return true;
  });
  assert.deepEqual(calls, ['one-public', 'one-flow', 'record:10001', 'two-public', 'two-flow', 'record:10002', 'forward', 'streams', 'force-stop']);
  assert.deepEqual([...mappings.keys()], ['one']); assert.equal(nat.activeMappings, 1); assert.equal(nat.redirectCommandsRemoved, 1);
  failFirst = false;
  await removeAndroidMapping({ key: 'one', value: mappings.get('one'), mappings, nat, forwarding });
  assert.equal(mappings.size, 0); assert.equal(nat.activeMappings, 0); assert.equal(nat.redirectCommandsRemoved, 2);
  await removeAndroidMapping({ key: 'one', mappings, nat, forwarding });
  assert.equal(nat.redirectCommandsRemoved, 2);
});

test('upstream counters distinguish raw replies and each strict filter rejection', () => {
  const counters = { upstreamReceivedDatagrams: 0, fromGuestDatagrams: 0, droppedAddressDatagrams: 0, droppedPortDatagrams: 0 };
  assert.equal(acceptUpstreamDatagram(counters, { address: '192.0.2.1', port: 1234 }, 1234), false);
  assert.equal(acceptUpstreamDatagram(counters, { address: '127.0.0.1', port: 9999 }, 1234), false);
  assert.equal(acceptUpstreamDatagram(counters, { address: '127.0.0.1', port: 1234 }, 1234), true);
  assert.deepEqual(counters, { upstreamReceivedDatagrams: 3, fromGuestDatagrams: 1, droppedAddressDatagrams: 1, droppedPortDatagrams: 1 });
});

test('actual mapper counts an unconfirmed provider add and closes sockets without inventing success', async () => {
  const source = readFileSync(new URL('./android-audio-probe.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  async function mapping('), end = source.indexOf('\n  function probeUdpFixture(', start);
  assert.ok(start > 0 && end > start);
  const mappings = new Map(), closed = [], nat = { mappingsCreated: 0, activeMappings: 0,
    redirectCommandsAttempted: 0, redirectCommandsSucceeded: 0, redirectCommandsRemoved: 0 };
  let nextId = 0, pendingMappings = 0;
  const createSocket = () => {
    const id = ++nextId, socket = new EventEmitter();
    socket.bind = (port, address, ready) => ready();
    socket.address = () => ({ port: 41000 + id });
    socket.close = ready => { closed.push(id); ready?.(); };
    return socket;
  };
  const forwarding = { add: async () => { pendingMappings++; throw Error('safe add timeout'); },
    close: async () => { pendingMappings--; } };
  const mapping = new Function('assert', 'mappings', 'createSocket', 'hostAddress', 'nat', 'forwarding',
    'const closingStarted=false; const socket=null; const removeMapping=()=>{ throw Error("unconfirmed record must stay provider owned"); };\nreturn ' + source.slice(start, end).trim())(
    assert, mappings, createSocket, '192.0.2.10', nat, forwarding);
  await assert.rejects(mapping(1, 12345), /safe add timeout/);
  assert.equal(nat.redirectCommandsAttempted, 1); assert.equal(nat.redirectCommandsSucceeded, 0);
  assert.equal(nat.mappingsCreated, 0); assert.equal(nat.activeMappings, 0);
  assert.equal(mappings.size, 0); assert.equal(pendingMappings, 1);
  assert.ok(closed.includes(1) && closed.includes(2));
  await forwarding.close(); assert.equal(pendingMappings, 0);
});

test('provider close can confirm a previously failed withdrawal before adapter reconciliation', async () => {
  const nat = { activeMappings: 1, redirectCommandsRemoved: 0 }, record = Object.freeze({ fixtureId: 1 });
  const socket = { close(done) { done(); } };
  const value = { publicSocket: socket, flows: new Map(), forwardingRecord: record, counters: nat };
  const mappings = new Map([['one', value]]);
  let confirmedRemoved = false, attempts = 0;
  const forwarding = { remove: async owner => {
    assert.equal(owner, record);
    if (!confirmedRemoved) { attempts++; throw Error('safe withdrawal timeout'); }
  }, close: async () => { attempts++; confirmedRemoved = true; } };
  await assert.rejects(removeAndroidMapping({ key: 'one', value, mappings, nat, forwarding }), /withdrawal timeout/);
  assert.equal(nat.activeMappings, 1); assert.equal(nat.redirectCommandsRemoved, 0);
  await forwarding.close();
  await removeAndroidMapping({ key: 'one', value, mappings, nat, forwarding });
  assert.equal(attempts, 2); assert.equal(nat.activeMappings, 0); assert.equal(nat.redirectCommandsRemoved, 1);
});

function fixtureController({ echo = false, failSetup = false, failRemove = false, failSend = false } = {}) {
  const source = readFileSync(new URL('./android-audio-probe.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  function probeUdpFixture('), end = source.indexOf('\n  async function mapAnswer(', start);
  assert.ok(start > 0 && end > start);
  const mappings = new Map(), calls = [], timers = {}, mediaCounters = { peerGenerationsCreated: 0, mappingsCreated: 0 };
  const counters = () => ({ mappingsCreated: 0, activeMappings: 0, toGuestDatagrams: 0, fromGuestDatagrams: 0,
    upstreamReceivedDatagrams: 0, droppedAddressDatagrams: 0, droppedPortDatagrams: 0, forwardingErrors: 0,
    redirectCommandsAttempted: 0, redirectCommandsSucceeded: 0, redirectCommandsRemoved: 0 });
  const mapping = async (owner, port, counts) => {
    assert.equal(owner, 'udp-fixture'); assert.notEqual(counts, mediaCounters);
    if (failSetup) throw Error('private setup endpoint');
    const value = { port: 40001, counters: counts };
    mappings.set(owner + ':' + port, value);
    counts.mappingsCreated++; counts.activeMappings++; counts.redirectCommandsAttempted++; counts.redirectCommandsSucceeded++;
    return value;
  };
  const removeMapping = async (key, entry) => {
    calls.push('remove');
    if (failRemove) throw Error('private redirection endpoint');
    mappings.delete(key); entry.counters.activeMappings--; entry.counters.redirectCommandsRemoved++;
  };
  const createSocket = () => {
    const socket = new EventEmitter();
    socket.bind = (port, address, done) => done();
    socket.close = done => { calls.push('client-close'); done(); };
    socket.send = (bytes, port, address, done) => {
      calls.push('send');
      if (failSend) throw Error('private synchronous send endpoint');
      done(null);
      if (echo) queueMicrotask(() => socket.emit('message', Buffer.from(bytes), { port, address }));
    };
    return socket;
  };
  const controller = new Function('assert', 'udpCounters', 'randomBytes', 'mapping', 'createSocket', 'hostAddress', 'mappings', 'removeMapping', 'runCleanupActions',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'let udpFixtureRun, udpFixtureProof; const closingStarted = false;\n' + source.slice(start, end) + '\nreturn {probeUdpFixture, get proof() { return udpFixtureProof; }};')(
    assert, counters, size => Buffer.alloc(size, 7), mapping, createSocket, '192.0.2.10', mappings, removeMapping, runCleanupActions,
    callback => { timers.deadline = callback; return 'deadline'; }, callback => { timers.retry = callback; return 'retry'; },
    name => { calls.push('clear-' + name); }, name => { calls.push('clear-' + name); });
  return { controller, mappings, calls, timers, mediaCounters };
}

test('actual UDP fixture verifies nonce and cleans its separate mapping before returning', async () => {
  const { controller, mappings, mediaCounters, calls } = fixtureController({ echo: true });
  const result = await controller.probeUdpFixture(12345);
  assert.equal(result.nonceMatched, true); assert.equal(result.timedOut, false);
  assert.equal(result.errors, 0); assert.equal(result.cleanupComplete, true);
  assert.equal(result.counters.redirectCommandsSucceeded, 1); assert.equal(result.counters.redirectCommandsRemoved, 1);
  assert.equal(mappings.size, 0); assert.deepEqual(mediaCounters, { peerGenerationsCreated: 0, mappingsCreated: 0 });
  assert.deepEqual(calls.slice(-2), ['client-close', 'remove']);
  assert.ok(!('port' in result) && !('nonce' in result));
});

test('actual UDP fixture timeout returns evidence and preserves failed redirect ownership', async () => {
  const { controller, mappings, timers } = fixtureController({ failRemove: true });
  const pending = controller.probeUdpFixture(12345);
  while (!timers.deadline) await Promise.resolve();
  for (let count = 0; count < 7; count++) timers.retry();
  timers.deadline();
  const result = await pending;
  assert.equal(result.timedOut, true); assert.equal(result.nonceMatched, false);
  assert.equal(result.attempts, 5); assert.equal(result.sentDatagrams, 5);
  assert.equal(result.cleanupComplete, false); assert.equal(result.errors, 1);
  assert.equal(result.counters.activeMappings, 1); assert.equal(mappings.size, 1);
});

test('actual UDP fixture infrastructure failure retains safe proof and exposes no raw endpoint', async () => {
  const { controller } = fixtureController({ failSetup: true });
  await assert.rejects(controller.probeUdpFixture(12345), error => {
    assert.equal(error.message, 'Android UDP topology control infrastructure failed.'); return true;
  });
  assert.equal(controller.proof.failureClass, 'Error'); assert.equal(controller.proof.errors, 1);
  assert.equal(controller.proof.cleanupComplete, true); assert.equal(controller.proof.counters.activeMappings, 0);
});

test('actual UDP fixture synchronous send failure clears timers and returns evidence for guest retrieval', async () => {
  const { controller, mappings, calls } = fixtureController({ failSend: true });
  const result = await controller.probeUdpFixture(12345);
  assert.equal(result.nonceMatched, false); assert.equal(result.errors, 1);
  assert.equal(result.cleanupComplete, true); assert.equal(mappings.size, 0);
  assert.deepEqual(calls, ['send', 'clear-deadline', 'clear-retry', 'client-close', 'remove']);
});

test('cleanup drains a pending redirect add before taking its mapping snapshot', async () => {
  const mappings = new Map(), removed = [];
  let finishAdd;
  const responseChain = new Promise(resolve => { finishAdd = resolve; }).then(() => {
    mappings.set('late-owned', { redirectPort: 10003 });
  });
  const cleanup = drainAndRemoveMappings(responseChain, mappings, async key => { removed.push(key); mappings.delete(key); });
  assert.deepEqual(removed, []);
  finishAdd(); await cleanup;
  assert.deepEqual(removed, ['late-owned']); assert.equal(mappings.size, 0);
  mappings.set('already-owned', {});
  await assert.rejects(drainAndRemoveMappings(Promise.reject(Error('private drain failure')), mappings,
    async key => { removed.push(key); mappings.delete(key); }), /response-drain/);
  assert.deepEqual(removed, ['late-owned', 'already-owned']); assert.equal(mappings.size, 0);
});

test('instrumentation failure collects complete safe final result before reporting', () => {
  const collector = instrumentationResultCollector();
  collector.accept('INSTRUMENTATION_RESULT: tiplayProbeErrorClass=UnsatisfiedLinkError');
  collector.accept('INSTRUMENTATION_RESULT: tiplayProbeErrorStage=main-webrtc-initialize');
  collector.accept('INSTRUMENTATION_RESULT: tiplayProbeErrorCode=probe-runtime-failure');
  collector.accept('INSTRUMENTATION_FAILED: private-endpoint');
  collector.accept('INSTRUMENTATION_RESULT: tiplayProbeErrorClass=private endpoint');
  assert.equal(collector.failure().message,
    'Android instrumentation failed (main-webrtc-initialize, probe-runtime-failure, UnsatisfiedLinkError).');
  assert.equal(collector.result.failed, true); assert.equal(collector.result.completed, undefined);
});

test('link-local proof accepts actual IPv4 host candidates only', () => {
  const candidates = ['a=candidate:a 1 UDP 1 169.254.111.111 12345 typ host',
    'a=candidate:b 1 UDP 1 169.254.2.3 12345 typ srflx', 'a=candidate:c 1 TCP 1 169.254.2.3 12345 typ host',
    'a=candidate:d 1 UDP 1 169.254.999.1 12345 typ host', 'a=candidate:e 1 UDP 1 fe80::1 12345 typ host',
    'a=candidate:f 1 UDP 1 10.0.2.15 12345 typ host'].join('\r\n');
  assert.equal(countIpv4LinkLocalHostCandidates(candidates), 1);
  assert.equal(countIpv4LinkLocalHostCandidates('v=0\n'), 0);
});

test('actual answer mapper preserves every non-endpoint SDP byte and retires old generations', async () => {
  const source = readFileSync(new URL('./android-audio-probe.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  async function mapAnswer('), end = source.indexOf('\n  function acceptProof(', start);
  assert.ok(start > 0 && end > start);
  const mappings = new Map(), generations = new Set(), linkLocalGenerations = new Set(), removed = [];
  const nat = { peerGenerationsCreated: 0, linkLocalCandidateGenerations: 0, observedLinkLocalHostCandidates: 0 };
  const mapping = async (generation, port) => {
    const key = generation + ':' + port;
    if (!mappings.has(key)) mappings.set(key, { port: 40000 + generation * 100 + port % 100 });
    return mappings.get(key);
  };
  const removeMapping = async key => { removed.push(key); mappings.delete(key); };
  const mapAnswer = new Function('mapping', 'mappings', 'generations', 'linkLocalGenerations', 'nat', 'isIPv4', 'removeMapping', 'assert', 'hostAddress', 'countIpv4LinkLocalHostCandidates', 'closingStarted',
    'return ' + source.slice(start, end).trim())(mapping, mappings, generations, linkLocalGenerations, nat, isIPv4, removeMapping, assert, '192.0.2.10', countIpv4LinkLocalHostCandidates, false);
  const original = 'v=0\r\na=ice-pwd:synthetic-fixture\r\na=mid:not-numeric\r\na=candidate:f\t1 UDP 212\t169.254.111.111\t12345 typ host generation 0\r\na=candidate:v6 1 UDP 100 fd00::1 12345 typ host\r\na=candidate:tcp 1 TCP 20 10.0.2.15 5555 typ host tcptype passive\r\n';
  const one = await mapAnswer({ generation: 1, sdp: original });
  assert.equal(one.sdp, original.replace('169.254.111.111\t12345', '192.0.2.10\t40145'));
  const two = await mapAnswer({ generation: 2, sdp: original.replace(/\r\n/g, '\n') });
  assert.equal(two.sdp, original.replace(/\r\n/g, '\n').replace('169.254.111.111\t12345', '192.0.2.10\t40245'));
  assert.deepEqual(removed, ['1:12345']); assert.equal(nat.peerGenerationsCreated, 2);
  assert.equal(nat.linkLocalCandidateGenerations, 2); assert.equal(nat.observedLinkLocalHostCandidates, 2);
  await assert.rejects(mapAnswer({ generation: 3, sdp: 'v=0\na=candidate:f 1 UDP 1 10.0.2.15 4444 typ host\n' }), /lacks an IPv4 link-local/);
  await assert.rejects(mapAnswer({ generation: 4, sdp: original.replace('12345', '0') }), /Invalid native UDP/);
});
