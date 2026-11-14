// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { openQemuUdpForwarding } from './qemu-udp-forwarding.mjs';

const backend = 'virtio-wifi';
const guestAddress = '10.0.2.16';
const defaultNetwork = [
  'net0: index=0,type=nic,model=e1000,macaddr=52:54:00:12:34:56',
  ' \\ mynet: index=0,type=user,net=10.0.2.0,restrict=off',
  'net1: index=0,type=nic,model=virtio-wifi-pci,macaddr=52:54:00:12:34:57',
  ' \\ virtio-wifi: index=0,type=user,net=10.0.2.0,restrict=off',
].join('\r\n');

async function monitorFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tiplay-hmp-'));
  const socketPath = join(directory, 'monitor.sock');
  const sockets = new Set(), commands = [], rows = new Map([
    ['mynet', []], [backend, []],
  ]);
  let timedOutAdds = 0, timedOutRemoves = 0;
  const row = (hostPort, guestPort, address = guestAddress) => ({ hostPort, guestPort, address });
  for (const [name, initial] of options.initialRows || []) rows.set(name, initial.map(value => ({ ...value })));

  function usernet() {
    const sections = [];
    for (const [name, values] of rows) {
      sections.push((options.sectionLabel || 'VLAN') + ' -1 (' + name + '):\r\n' +
        '  Protocol[State]    FD  Source Address  Port   Dest. Address  Port RecvQ SendQ\r\n' +
        values.map((value, index) => '  UDP[HOST_FORWARD] ' + (40 + index) + ' 127.0.0.1 ' +
          value.hostPort + ' ' + value.address + ' ' + value.guestPort + ' 0 0').join('\r\n'));
    }
    if (options.duplicateSection) sections.push('VLAN -1 (' + backend + '):\r\n');
    return sections.join('\r\n');
  }

  function response(command) {
    if (command === 'help') return 'hostfwd_add add forwarding\r\nhostfwd_remove remove forwarding\r\ninfo show information';
    if (command === 'help hostfwd_add') return 'hostfwd_add [netdev_id] [tcp|udp]:[hostaddr]:hostport-[guestaddr]:guestport';
    if (command === 'help hostfwd_remove') return 'hostfwd_remove [netdev_id] [tcp|udp]:[hostaddr]:hostport';
    if (command === 'info version') return '2.12.0 (Android emulator fixture)';
    if (command === 'info chardev') return 'compat_monitor1: filename=unix:' + socketPath + ',server=on';
    if (command === 'info network') return options.networkText ?? defaultNetwork;
    if (command === 'info usernet') return usernet();
    const add = /^hostfwd_add ([A-Za-z0-9_.-]+) udp:127[.]0[.]0[.]1:([0-9]+)-([0-9.]+):([0-9]+)$/.exec(command);
    if (add) {
      const name = add[1], hostPort = Number(add[2]), guestPort = Number(add[4]);
      if (!rows.has(name)) return 'Error: invalid netdev';
      if (options.addToWrongSection) rows.get('mynet').push(row(hostPort, guestPort, add[3]));
      else if (!options.silentAdd) {
        rows.get(name).push(row(hostPort, guestPort, add[3]));
        if (options.duplicateAddedRow) rows.get(name).push(row(hostPort, guestPort, add[3]));
      }
      if (options.timeoutFirstAdd && timedOutAdds++ === 0) return null;
      return ''; // Standard HMP add success has no OK acknowledgment.
    }
    const remove = /^hostfwd_remove ([A-Za-z0-9_.-]+) udp:127[.]0[.]0[.]1:([0-9]+)$/.exec(command);
    if (remove) {
      const name = remove[1], hostPort = Number(remove[2]);
      if (options.failRemovePorts?.has(hostPort)) return 'host forwarding rule not found';
      const values = rows.get(name) || [];
      const index = values.findIndex(value => value.hostPort === hostPort);
      if (index < 0) return 'host forwarding rule not found';
      values.splice(index, 1);
      if (options.timeoutFirstRemove && timedOutRemoves++ === 0) return null;
      return 'host forwarding rule removed';
    }
    return 'unknown command';
  }

  async function send(socket, output) {
    if (output === null || socket.destroyed) return;
    if (!options.fragmented) { socket.write(output); return; }
    const cut = Math.max(1, output.length - 5);
    socket.write(output.slice(0, cut));
    await nextTurn();
    if (!socket.destroyed) socket.write(output.slice(cut, output.length - 2));
    await nextTurn();
    if (!socket.destroyed) socket.write(output.slice(-2));
  }

  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let buffer = '', sequence = Promise.resolve();
    void send(socket, 'QEMU 2.12.0 monitor - type \'help\' for more information\r\n(qemu) ');
    socket.setEncoding('utf8');
    socket.on('data', bytes => {
      buffer += bytes;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const command = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        commands.push(command);
        sequence = sequence.then(async () => {
          const body = response(command);
          if (body === null) return;
          const echo = options.fragmented ? '\u001b[2K' + command + '\r\n' : command + '\r\n';
          await send(socket, echo + body + '\r\n(qemu) ');
        }).catch(() => socket.destroy());
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); });
  });
  return {
    socketPath, commands, rows,
    async open(extra = {}) {
      return openQemuUdpForwarding({ socketPath, netdevId: backend, guestAddress, timeoutMs: 300, ...extra });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function safeError(fixture, error) {
  assert.equal(error.constructor.name, 'QemuUdpForwardingError');
  assert.match(error.message, /^qemu-hmp-[a-z0-9-]+$/);
  assert.equal(error.code, error.message);
  for (const value of [fixture.socketPath, guestAddress, '127.0.0.1'])
    assert.ok(!error.message.includes(value), 'An operational endpoint leaked into an error.');
  return true;
}

function safeSnapshot(fixture, provider) {
  const snapshot = provider.snapshot(), encoded = JSON.stringify(snapshot);
  for (const value of [fixture.socketPath, guestAddress, '127.0.0.1'])
    assert.ok(!encoded.includes(value), 'An operational endpoint leaked into a snapshot.');
  return snapshot;
}

test('fragmented HMP session verifies the actual WiFi backend and complete forwarding lifecycle', async () => {
  const fixture = await monitorFixture({ fragmented: true });
  let provider;
  try {
    provider = await fixture.open();
    const initial = safeSnapshot(fixture, provider);
    assert.equal(initial.mode, 'qemu-hmp-slirp'); assert.equal(initial.backendType, 'user');
    for (const flag of ['monitorVerified', 'capabilitiesVerified', 'backendVerified', 'wifiNicVerified'])
      assert.equal(initial[flag], true);
    const owned = await provider.add({ hostPort: 32001, guestPort: 41001 });
    assert.deepEqual(fixture.rows.get(backend), [{ hostPort: 32001, guestPort: 41001, address: guestAddress }]);
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 1);
    await provider.remove(owned);
    assert.equal(fixture.rows.get(backend).length, 0);
    assert.equal(safeSnapshot(fixture, provider).mappingsRemoved, 1);
    await provider.remove(owned); // Confirmed removal is idempotent, with no second HMP delete.
    assert.equal(fixture.commands.filter(value => value.startsWith('hostfwd_remove ')).length, 1);
    await provider.close();
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 0);
    assert.equal(safeSnapshot(fixture, provider).closed, true);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('unknown, non-user, wrong-NIC and ambiguous backend identities fail before any mutation', async () => {
  const cases = [
    { networkText: defaultNetwork.replaceAll('virtio-wifi:', 'other-wifi:') },
    { networkText: defaultNetwork.replace('virtio-wifi: index=0,type=user', 'virtio-wifi: index=0,type=stream') },
    { networkText: defaultNetwork.replace('model=virtio-wifi-pci', 'model=e1000') },
    { duplicateSection: true },
    { networkText: defaultNetwork + '\r\nnet2: index=0,type=nic,model=virtio-wifi-pci\r\n \\ virtio-wifi: index=0,type=user,net=10.0.2.0,restrict=off' },
  ];
  for (const options of cases) {
    const fixture = await monitorFixture(options);
    try {
      await assert.rejects(fixture.open(), error => safeError(fixture, error));
      assert.equal(fixture.commands.some(value => value.startsWith('hostfwd_')), false);
    } finally { await fixture.close(); }
  }
});

test('the actual Hub usernet section format also verifies and retires an owned forward', async () => {
  const fixture = await monitorFixture({ sectionLabel: 'Hub' });
  let provider;
  try {
    provider = await fixture.open();
    const owned = await provider.add({ hostPort: 32010, guestPort: 41010 });
    assert.equal(safeSnapshot(fixture, provider).mappingsCreated, 1);
    await provider.remove(owned);
    await provider.close();
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 0);
    assert.equal(safeSnapshot(fixture, provider).mappingsRemoved, 1);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('a prompt and a matching row in another stack cannot certify a silent add', async () => {
  const fixture = await monitorFixture({ addToWrongSection: true });
  let provider;
  try {
    provider = await fixture.open();
    await assert.rejects(provider.add({ hostPort: 32002, guestPort: 41002 }), error => safeError(fixture, error));
    assert.equal(safeSnapshot(fixture, provider).mappingsCreated, 0);
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 1);
    assert.equal(fixture.rows.get(backend).length, 0);
    await assert.rejects(provider.close(), error => safeError(fixture, error));
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 1);
    assert.equal(fixture.rows.get('mynet').length, 1, 'The provider removed a row outside its selected stack.');
    assert.equal(fixture.commands.some(value => value.startsWith('hostfwd_remove mynet ')), false);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('a silent add with no row is rejected and confirmed absent without counting a removal', async () => {
  const fixture = await monitorFixture({ silentAdd: true });
  let provider;
  try {
    provider = await fixture.open();
    await assert.rejects(provider.add({ hostPort: 32003, guestPort: 41003 }), error => safeError(fixture, error));
    const snapshot = safeSnapshot(fixture, provider);
    assert.equal(snapshot.mappingsCreated, 0); assert.equal(snapshot.pendingMappings, 0);
    assert.equal(snapshot.mappingsRemoved, 0);
    await provider.close();
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('ambiguous duplicate forwarding rows never become a successful mapping', async () => {
  const fixture = await monitorFixture({ duplicateAddedRow: true });
  let provider;
  try {
    provider = await fixture.open();
    await assert.rejects(provider.add({ hostPort: 32004, guestPort: 41004 }), error => safeError(fixture, error));
    const snapshot = safeSnapshot(fixture, provider);
    assert.equal(snapshot.mappingsCreated, 0); assert.equal(snapshot.pendingMappings, 1);
    await assert.rejects(provider.close(), error => safeError(fixture, error));
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 1);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('failed deletion retains ownership while close still attempts remaining mappings', async () => {
  const fixture = await monitorFixture({ failRemovePorts: new Set([32005]) });
  let provider;
  try {
    provider = await fixture.open();
    const first = await provider.add({ hostPort: 32005, guestPort: 41005 });
    await provider.add({ hostPort: 32006, guestPort: 41006 });
    await assert.rejects(provider.remove(first), error => safeError(fixture, error));
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 2);
    const closing = provider.close();
    const lateRemoval = provider.remove(first);
    const closed = await Promise.allSettled([closing, lateRemoval]);
    for (const result of closed) {
      assert.equal(result.status, 'rejected'); safeError(fixture, result.reason);
    }
    assert.equal(safeSnapshot(fixture, provider).pendingMappings, 1);
    assert.equal(safeSnapshot(fixture, provider).mappingsRemoved, 1);
    assert.equal(safeSnapshot(fixture, provider).closed, true);
    assert.equal(safeSnapshot(fixture, provider).connected, false);
    assert.deepEqual(fixture.rows.get(backend).map(value => value.hostPort), [32005]);
    assert.ok(fixture.commands.includes('hostfwd_remove ' + backend + ' udp:127.0.0.1:32006'));
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('a sent add timeout remains owned until the original socket is reconciled', async () => {
  const fixture = await monitorFixture({ timeoutFirstAdd: true });
  let provider;
  try {
    provider = await fixture.open({ timeoutMs: 200 });
    await assert.rejects(provider.add({ hostPort: 32007, guestPort: 41007 }), error => safeError(fixture, error));
    const uncertain = safeSnapshot(fixture, provider);
    assert.equal(uncertain.pendingMappings, 1); assert.equal(uncertain.unconfirmedMappings, 1);
    assert.equal(uncertain.mappingsCreated, 0);
    await provider.close();
    const closed = safeSnapshot(fixture, provider);
    assert.equal(closed.pendingMappings, 0); assert.equal(closed.reconnects, 1);
    assert.equal(fixture.rows.get(backend).length, 0);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('a lost removal acknowledgment reconciles absence without inventing a successful delete receipt', async () => {
  const fixture = await monitorFixture({ timeoutFirstRemove: true });
  let provider;
  try {
    provider = await fixture.open({ timeoutMs: 200 });
    const owned = await provider.add({ hostPort: 32011, guestPort: 41011 });
    await assert.rejects(provider.remove(owned), error => safeError(fixture, error));
    const uncertain = safeSnapshot(fixture, provider);
    assert.equal(uncertain.pendingMappings, 1); assert.equal(uncertain.mappingsRemoved, 0);
    assert.equal(fixture.rows.get(backend).length, 0);
    await provider.close();
    const closed = safeSnapshot(fixture, provider);
    assert.equal(closed.pendingMappings, 0); assert.equal(closed.mappingsRemoved, 0);
    assert.equal(closed.uncertainRemovalsResolvedAbsent, 1);
    assert.ok(closed.failures > 0); assert.equal(closed.reconnects, 1);
    assert.equal(fixture.commands.filter(value => value.startsWith('hostfwd_remove ')).length, 1);
    assert.equal(closed.closed, true); assert.equal(closed.connected, false);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});

test('forged records and preexisting foreign host forwards cannot be deleted or replaced', async () => {
  const fixture = await monitorFixture({ initialRows: [[backend, [{ hostPort: 32008, guestPort: 41008, address: guestAddress }]]] });
  let provider;
  try {
    provider = await fixture.open();
    await assert.rejects(provider.add({ hostPort: 32008, guestPort: 41009 }), error => safeError(fixture, error));
    const owned = await provider.add({ hostPort: 32009, guestPort: 41009 });
    await assert.rejects(provider.remove({ ...owned }), error => safeError(fixture, error));
    assert.equal(fixture.commands.some(value => value === 'hostfwd_remove ' + backend + ' udp:127.0.0.1:32008'), false);
    await provider.close();
    assert.deepEqual(fixture.rows.get(backend).map(value => value.hostPort), [32008]);
  } finally { await provider?.close().catch(() => {}); await fixture.close(); }
});
