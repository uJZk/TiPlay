// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import test from 'node:test';
import { countIpv4LinkLocalHostCandidates, drainAndRemoveMappings, instrumentationResultCollector,
  removeAndroidMapping, runCleanupActions } from './android-audio-probe.mjs';

test('cleanup attempts every owned resource and retains failed emulator redirects', async () => {
  const calls = [], mappings = new Map(), nat = { activeMappings: 2, redirectCommandsRemoved: 0 };
  const closed = label => ({ close(done) { calls.push(label); done(); } });
  for (const [key, port] of [['one', 10001], ['two', 10002]]) mappings.set(key, {
    publicSocket: closed(key + '-public'), flows: new Map([['flow', { socket: closed(key + '-flow') }]]), redirectPort: port,
  });
  let failFirst = true;
  const runAdb = async args => {
    calls.push(args.at(-1));
    if (args.at(-1) === 'udp:10001' && failFirst) throw Error('private endpoint must never reach cleanup output');
    return { stdout: 'OK\n' };
  };
  const actions = [...mappings].map(([key, value]) => ['udp-mapping', () => removeAndroidMapping({ key, value, mappings, nat, runAdb })]);
  actions.push(['adb-forward', async () => { calls.push('forward'); throw Error('private-forward'); }],
    ['streams', async () => { calls.push('streams'); }], ['force-stop', async () => { calls.push('force-stop'); }]);
  await assert.rejects(runCleanupActions(actions), error => {
    assert.equal(error.message, 'Android cleanup failed: udp-mapping, adb-forward.'); return true;
  });
  assert.deepEqual(calls, ['one-public', 'one-flow', 'udp:10001', 'two-public', 'two-flow', 'udp:10002', 'forward', 'streams', 'force-stop']);
  assert.deepEqual([...mappings.keys()], ['one']); assert.equal(nat.activeMappings, 1); assert.equal(nat.redirectCommandsRemoved, 1);
  failFirst = false;
  await removeAndroidMapping({ key: 'one', value: mappings.get('one'), mappings, nat, runAdb });
  assert.equal(mappings.size, 0); assert.equal(nat.activeMappings, 0); assert.equal(nat.redirectCommandsRemoved, 2);
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
