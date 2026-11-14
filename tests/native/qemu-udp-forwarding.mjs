// SPDX-License-Identifier: GPL-3.0-only
// Test-only HMP control. Media continues to use UDP, never this Unix socket.
import { connect, isIPv4 } from 'node:net';
import { lstat } from 'node:fs/promises';

const MAX_OUTPUT = 256 * 1024;
const HOST = '127.0.0.1';

export class QemuUdpForwardingError extends Error {
  constructor(code) { super(code); this.name = 'QemuUdpForwardingError'; this.code = code; }
}
const fail = code => { throw new QemuUdpForwardingError('qemu-hmp-' + code); };
const portValid = value => Number.isInteger(value) && value > 0 && value <= 65535;

function plain(text) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
}

// QEMU readline can redraw a line using CR/BS; interpret those controls before
// inspecting output. They must not create a false backend or forwarding row.
function lines(text) {
  const result = []; let row = [], column = 0;
  for (const character of plain(text)) {
    if (character === '\n') { result.push(row.join('')); row = []; column = 0; }
    else if (character === '\r') column = 0;
    else if (character === '\b') column = Math.max(0, column - 1);
    else if (character === '\t' || character >= ' ') row[column++] = character;
  }
  if (row.length) result.push(row.join(''));
  return result;
}

function responseText(text, command) {
  const rendered = lines(text);
  return rendered.filter(line => line.trim() !== command &&
    line.trim() !== '(qemu) ' + command && line.trim() !== '(qemu)').join('\n').trim();
}

function commandFailed(text) {
  return /(?:unknown command|not found|invalid |could not|failed|not supported|error:|expecting |ambiguous)/i.test(text);
}

function networkVerified(text, netdevId) {
  let wifiNic = false, matches = 0;
  for (const row of text.split('\n')) {
    const client = /^\s*(\\\s+)?([^:\s]+):\s+index=-?\d+,type=([^,\s]+)(?:,(.*))?$/.exec(row);
    if (!client) { if (row.trim()) wifiNic = false; continue; }
    if (!client[1]) {
      wifiNic = client[3] === 'nic' && /(?:^|,)model=virtio-wifi(?:-[A-Za-z0-9_.-]+)?(?:,|$)/.test(client[4] || '');
    } else if (client[2] === netdevId) {
      if (!wifiNic || client[3] !== 'user') fail('wifi-user-backend-unverified');
      matches++;
    }
  }
  if (matches !== 1) fail('wifi-user-backend-unverified');
}

function usernet(text) {
  const sections = new Map(); let section;
  for (const row of text.split('\n')) {
    const header = /^(?:VLAN|Hub)\s+-?\d+\s+\(([^)]+)\):\s*$/.exec(row.trim());
    if (header) {
      if (sections.has(header[1])) fail('ambiguous-usernet-section');
      section = []; sections.set(header[1], section); continue;
    }
    if (!row.includes('UDP[HOST_FORWARD]')) continue;
    const match = /^\s*UDP\[HOST_FORWARD\]\s+\d+\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+\d+\s+\d+\s*$/.exec(row);
    if (!section || !match || !isIPv4(match[1]) || !isIPv4(match[3]) ||
        !portValid(Number(match[2])) || !portValid(Number(match[4]))) fail('invalid-usernet-row');
    section.push({ hostAddress: match[1], hostPort: Number(match[2]), guestAddress: match[3], guestPort: Number(match[4]) });
  }
  return sections;
}

function targetRows(sections, id, record) {
  const rows = sections.get(id);
  if (!rows) fail('missing-usernet-section');
  return rows.filter(row => row.hostAddress === HOST && row.hostPort === record.hostPort &&
    row.guestAddress === record.guestAddress && row.guestPort === record.guestPort);
}

function foreignForward(sections, id, record) {
  return [...sections].some(([name, rows]) => rows.some(row => row.hostPort === record.hostPort &&
    (row.hostAddress === HOST || row.hostAddress === '0.0.0.0') &&
    (name !== id || row.hostAddress !== HOST || row.guestAddress !== record.guestAddress || row.guestPort !== record.guestPort)));
}

class HmpSession {
  constructor(socketPath, timeoutMs, onCommand) {
    this.socketPath = socketPath; this.timeoutMs = timeoutMs; this.onCommand = onCommand;
    this.buffer = ''; this.waiter = null; this.usable = false; this.socket = null;
  }
  async open() {
    const socket = this.socket = connect({ path: this.socketPath });
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > MAX_OUTPUT) { this.abort('output-limit'); return; }
      this.flush();
    });
    socket.on('error', () => this.abort('transport-error'));
    socket.on('close', () => this.abort('transport-closed'));
    this.usable = true;
    const banner = await this.frame(true);
    if (!/\bQEMU\b.*\bmonitor\b/i.test(banner)) { this.abort('invalid-banner'); fail('invalid-banner'); }
  }
  frame(initial = false) {
    if (!this.usable || this.waiter) return Promise.reject(new QemuUdpForwardingError('qemu-hmp-session-unavailable'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.abort('command-timeout'), this.timeoutMs);
      this.waiter = { resolve, reject, timer, initial };
      this.flush();
    });
  }
  flush() {
    if (!this.waiter) return;
    // An HMP command finishes at a fresh prompt after LF. A readline CR redraw
    // of the input prompt is not a command boundary. The initial banner may
    // also use the prompt at the start of its final line.
    const clean = plain(this.buffer).replace(/\r/g, '');
    const prompt = /(?:^|\n)\(qemu\) $/.exec(clean);
    if (!prompt || (!this.waiter.initial && prompt.index === 0)) return;
    const waiter = this.waiter; this.waiter = null;
    clearTimeout(waiter.timer);
    const value = this.buffer; this.buffer = '';
    waiter.resolve(value);
  }
  async command(command) {
    if (!this.usable || this.waiter) fail('session-unavailable');
    if (this.buffer.trim()) { this.abort('unsolicited-output'); fail('unsolicited-output'); }
    this.buffer = '';
    const pending = this.frame();
    this.onCommand();
    try { this.socket.write(command + '\n', error => { if (error) this.abort('transport-write'); }); }
    catch { this.abort('transport-write'); }
    return responseText(await pending, command);
  }
  abort(code) {
    this.usable = false;
    if (this.waiter) {
      const waiter = this.waiter; this.waiter = null;
      clearTimeout(waiter.timer); waiter.reject(new QemuUdpForwardingError('qemu-hmp-' + code));
    }
    this.socket?.destroy();
  }
  close() { this.abort('session-closed'); }
}

/** Open only the owned Unix HMP endpoint of this disposable emulator. */
export async function openQemuUdpForwarding({ socketPath, netdevId, guestAddress, timeoutMs = 5000 } = {}) {
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/') || Buffer.byteLength(socketPath) > 100 ||
      /[\x00-\x1f]/.test(socketPath)) fail('invalid-socket-path');
  if (typeof netdevId !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(netdevId)) fail('invalid-netdev');
  if (!isIPv4(guestAddress) || /^(?:0|127|169\.254|2[2-5][0-9])\./.test(guestAddress)) fail('invalid-guest-address');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 5000) fail('invalid-timeout');
  let socketIdentity;
  try { socketIdentity = await lstat(socketPath); } catch { fail('socket-unavailable'); }
  if (!socketIdentity.isSocket() || socketIdentity.isSymbolicLink() ||
      socketIdentity.uid !== process.getuid()) fail('socket-not-owned');
  const owned = new Map(), removed = new WeakSet();
  const stats = { mode: 'qemu-hmp-slirp', backendType: 'unknown', monitorVerified: false,
    capabilitiesVerified: false, backendVerified: false, wifiNicVerified: false,
    closed: false, mappingAddAttempts: 0, mappingsCreated: 0, mappingRemoveAttempts: 0,
    mappingsRemoved: 0, potentialMappingsResolvedAbsent: 0, uncertainRemovalsResolvedAbsent: 0,
    commandsSent: 0, reconnects: 0, failures: 0 };
  let session, queue = Promise.resolve(), closing = false, closeResult;
  const snapshot = () => ({ ...stats, connected: session?.usable === true,
    pendingMappings: owned.size, unconfirmedMappings: [...owned.values()].filter(value => !value.confirmed).length });
  const serialize = action => {
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  };
  const getSections = async () => {
    const answer = await session.command('info usernet');
    if (commandFailed(answer)) fail('usernet-unavailable');
    const sections = usernet(answer);
    if (!sections.has(netdevId)) fail('missing-usernet-section');
    return sections;
  };
  async function ensureSession() {
    if (session?.usable) return;
    let actual;
    try { actual = await lstat(socketPath); } catch { fail('socket-unavailable'); }
    if (!actual.isSocket() || actual.dev !== socketIdentity.dev || actual.ino !== socketIdentity.ino ||
        actual.uid !== socketIdentity.uid) fail('monitor-identity-changed');
    if (session) { session.close(); stats.reconnects++; }
    session = new HmpSession(socketPath, timeoutMs, () => { stats.commandsSent++; });
    try {
      await session.open(); stats.monitorVerified = true;
      for (const command of ['help hostfwd_add', 'help hostfwd_remove']) {
        const answer = await session.command(command);
        if (commandFailed(answer) || !answer.includes(command.slice(5))) fail('hostfwd-unsupported');
      }
      for (const command of ['info version', 'info chardev']) {
        const answer = await session.command(command);
        if (!answer || commandFailed(answer)) fail('monitor-unverified');
      }
      stats.capabilitiesVerified = true;
      const network = await session.command('info network');
      if (commandFailed(network)) fail('network-unavailable');
      networkVerified(network, netdevId);
      await getSections();
      stats.backendType = 'user'; stats.backendVerified = true; stats.wifiNicVerified = true;
    } catch (error) { session.close(); throw error; }
  }
  async function removeInternal(token) {
    if (removed.has(token)) return;
    const record = owned.get(token);
    if (!record) fail('unowned-forward');
    await ensureSession();
    const before = await getSections();
    if (foreignForward(before, netdevId, record)) fail('forward-tuple-mismatch');
    const rows = targetRows(before, netdevId, record);
    if (rows.length > 1) fail('ambiguous-forward');
    if (rows.length === 0) {
      if (record.confirmed && !record.removalAcknowledged && !record.removalAttempted) fail('owned-forward-missing');
      owned.delete(token); removed.add(token);
      if (record.confirmed && !record.removalAcknowledged) stats.uncertainRemovalsResolvedAbsent++;
      else if (record.confirmed) stats.mappingsRemoved++;
      else stats.potentialMappingsResolvedAbsent++;
      return;
    }
    stats.mappingRemoveAttempts++;
    record.removalAttempted = true;
    const answer = await session.command(`hostfwd_remove ${netdevId} udp:${HOST}:${record.hostPort}`);
    if (commandFailed(answer) || !/\bhost forwarding rule\b[^\n]*\bremoved\b/i.test(answer)) fail('remove-unacknowledged');
    record.removalAcknowledged = true;
    if (targetRows(await getSections(), netdevId, record).length !== 0) fail('remove-not-confirmed');
    owned.delete(token); removed.add(token); stats.mappingsRemoved++;
  }
  const provider = {
    snapshot,
    add({ hostPort, guestPort } = {}) {
      if (closing || stats.closed) return Promise.reject(new QemuUdpForwardingError('qemu-hmp-provider-closed'));
      return serialize(async () => {
        try {
          if (!portValid(hostPort) || !portValid(guestPort)) fail('invalid-port');
          if (owned.size >= 16) fail('forward-limit');
          await ensureSession();
          const before = await getSections();
          if ([...before.values()].flat().some(row => row.hostPort === hostPort &&
              (row.hostAddress === HOST || row.hostAddress === '0.0.0.0'))) fail('forward-already-present');
          const token = Object.freeze({});
          const record = { hostPort, guestPort, guestAddress, confirmed: false, removalAcknowledged: false, removalAttempted: false };
          owned.set(token, record); stats.mappingAddAttempts++;
          const answer = await session.command(`hostfwd_add ${netdevId} udp:${HOST}:${hostPort}-${guestAddress}:${guestPort}`);
          const after = await getSections();
          if (foreignForward(after, netdevId, record)) fail('forward-tuple-mismatch');
          const rows = targetRows(after, netdevId, record);
          if (rows.length === 0) {
            // A successful observation of absence resolves this potential add;
            // it does not pretend that a forwarding rule was removed.
            owned.delete(token); removed.add(token); stats.potentialMappingsResolvedAbsent++;
            fail('add-not-confirmed');
          }
          if (rows.length !== 1) fail('ambiguous-forward');
          if (commandFailed(answer)) fail('add-reported-error');
          record.confirmed = true; stats.mappingsCreated++;
          return token;
        } catch (error) { stats.failures++; throw error; }
      });
    },
    remove(token) {
      if ((typeof token !== 'object' || token === null)) return Promise.reject(new QemuUdpForwardingError('qemu-hmp-unowned-forward'));
      if (removed.has(token)) return Promise.resolve();
      if (stats.closed) return Promise.reject(new QemuUdpForwardingError('qemu-hmp-provider-closed'));
      if (closing) return closeResult.catch(() => {}).then(() => {
        if (!removed.has(token)) fail('provider-closed');
      });
      return serialize(async () => {
        try { await removeInternal(token); }
        catch (error) { stats.failures++; throw error; }
      });
    },
    close() {
      if (closeResult) return closeResult;
      closing = true;
      closeResult = serialize(async () => {
        let failed = false;
        try {
          for (const token of [...owned.keys()]) {
            try { await removeInternal(token); } catch { stats.failures++; failed = true; }
          }
        } finally { session?.close(); stats.closed = true; }
        if (failed || owned.size) fail('cleanup-incomplete');
      });
      return closeResult;
    },
  };
  try { await ensureSession(); }
  catch (error) {
    session?.close(); stats.closed = true; stats.failures++;
    const failure = error instanceof QemuUdpForwardingError ? error : new QemuUdpForwardingError('qemu-hmp-open-failed');
    failure.qemuForwarding = Object.freeze(snapshot());
    throw failure;
  }
  return provider;
}
