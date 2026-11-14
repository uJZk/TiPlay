// SPDX-License-Identifier: GPL-3.0-only
// Test-only Android instrumentation RPC and an explicit emulator UDP NAT adapter.
import assert from 'node:assert/strict';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { connect, isIPv4 } from 'node:net';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const execFile = promisify(execFileCallback);
const targetPackage = 'com.ujzk.tiplay.hudtest';
const testComponent = 'com.ujzk.tiplay.audiointerop.test/com.shilapi.xcertplay.web.NativeAudioProbeInstrumentation';
const libraryNames = ['libjingle_peerconnection_so.so', 'libdatachannel.so', 'libtiplay_rtc_audio.so'];

const inspectApks = String.raw`
import hashlib,json,sys,zipfile
from pathlib import Path
def package(path,libs=False):
 p=Path(path)
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
 result={'sha256':h.hexdigest()}
 with zipfile.ZipFile(p) as z:
  assert not any(n.startswith('assets/offline-mfi/') for n in z.namelist()),'Source-only APK required'
  if libs:
   result['libraries']={}
   for name in ['libjingle_peerconnection_so.so','libdatachannel.so','libtiplay_rtc_audio.so']:
    entry=z.getinfo('lib/x86_64/'+name)
    digest=hashlib.sha256()
    with z.open(entry) as f:
     for block in iter(lambda:f.read(1024*1024),b''): digest.update(block)
    result['libraries'][name]={'sha256':digest.hexdigest(),'bytes':entry.file_size}
 return result
print(json.dumps({'app':package(sys.argv[1],True),'test':package(sys.argv[2])}))
`;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function commandError(error) {
  // adb errors can contain paths/endpoints. Keep its class/code, not captured output.
  const code = Number.isInteger(error?.code) ? error.code : 'unknown';
  return Error(`Android test command failed (${code}).`);
}

// Cleanup is deliberately sequential, but failure of one owned resource must
// never prevent attempting the remaining ones. Only fixed labels reach logs.
export async function runCleanupActions(actions) {
  const failed = [];
  for (const [label, action] of actions) {
    try { await action(); } catch { failed.push(label); }
  }
  if (failed.length) throw Error('Android cleanup failed: ' + failed.join(', ') + '.');
}

export async function removeAndroidMapping({ key, value, mappings, nat, runAdb }) {
  if (!mappings.has(key)) return;
  // Local sockets and an emulator redirect are distinct owned resources. A
  // failed redirect stays pending even after every local socket was closed.
  await Promise.all([value.publicSocket, ...[...value.flows.values()].map(flow => flow.socket)].map(udp => new Promise(resolve => {
    try { udp.close(resolve); } catch { resolve(); }
  })));
  const removed = await runAdb(['emu', 'redir', 'del', `udp:${value.redirectPort}`]);
  assert.match(removed.stdout, /\bOK\b/, 'The emulator did not remove the owned UDP mapping.');
  mappings.delete(key);
  nat.activeMappings = [...mappings.values()].filter(entry => !entry.counters || entry.counters === nat).length;
  nat.redirectCommandsRemoved++;
}

export function acceptUpstreamDatagram(counters, sender, redirectPort) {
  counters.upstreamReceivedDatagrams++;
  if (sender.address !== '127.0.0.1') { counters.droppedAddressDatagrams++; return false; }
  if (sender.port !== redirectPort) { counters.droppedPortDatagrams++; return false; }
  counters.fromGuestDatagrams++; return true;
}

function udpCounters() {
  return { mappingsCreated: 0, activeMappings: 0, toGuestDatagrams: 0, fromGuestDatagrams: 0,
    upstreamReceivedDatagrams: 0, droppedAddressDatagrams: 0, droppedPortDatagrams: 0,
    forwardingErrors: 0, redirectCommandsSucceeded: 0, redirectCommandsRemoved: 0 };
}

export async function drainAndRemoveMappings(responseChain, mappings, removeMapping) {
  await runCleanupActions([
    ['response-drain', async () => { await responseChain; }],
    // Take the snapshot after any in-flight adb add has settled, even if it
    // failed. A snapshot taken when close() begins can miss a late owned add.
    ['udp-mappings', () => runCleanupActions([...mappings].map(([key, entry]) => ['udp-mapping', () => removeMapping(key, entry)]))],
  ]);
}

export function countIpv4LinkLocalHostCandidates(sdp) {
  let count = 0;
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const fields = line.match(/\S+/g) || [];
    if (fields[2]?.toLowerCase() === 'udp' && isIPv4(fields[4]) &&
        fields[4].startsWith('169.254.') && fields[6] === 'typ' && fields[7] === 'host') count++;
  }
  return count;
}

export function instrumentationResultCollector() {
  const result = {};
  return {
    result,
    accept(line) {
      const field = /^INSTRUMENTATION_RESULT: tiplayProbe(ErrorStage|ErrorCode|ErrorClass)=([A-Za-z][A-Za-z0-9-]{0,80})$/.exec(line);
      if (field) result[field[1]] = field[2];
      if (line === 'INSTRUMENTATION_RESULT: tiplayProbeCompleted=true') result.completed = true;
      if (/^INSTRUMENTATION_FAILED:/.test(line)) result.failed = true;
    },
    failure() {
      const fields = ['ErrorStage', 'ErrorCode', 'ErrorClass'].filter(key => result[key]).map(key => result[key]);
      return Error('Android instrumentation failed' + (fields.length ? ' (' + fields.join(', ') + ')' : '') + '.');
    },
  };
}

export async function startAndroidAudioProbe({ adb = process.env.ADB || 'adb', serial = process.env.ANDROID_SERIAL || 'emulator-5554',
  appApk = process.env.ANDROID_AUDIO_APP_APK, testApk = process.env.ANDROID_AUDIO_TEST_APK, hostAddress } = {}) {
  assert.match(serial, /^emulator-[0-9]+$/, 'The Android audio proof accepts a disposable emulator only.');
  assert.ok(appApk && testApk, 'Supply ANDROID_AUDIO_APP_APK and ANDROID_AUDIO_TEST_APK.');
  const adbArgs = ['-s', serial];
  const runAdb = async args => {
    try { return await execFile(adb, [...adbArgs, ...args], { timeout: 60000, maxBuffer: 1024 * 1024 }); }
    catch (error) { throw commandError(error); }
  };
  assert.equal((await runAdb(['shell', 'getprop', 'ro.kernel.qemu'])).stdout.trim(), '1', 'The selected device is not an emulator.');
  const inspected = JSON.parse((await execFile('python3', ['-c', inspectApks, appApk, testApk],
    { timeout: 60000, maxBuffer: 65536 })).stdout);
  const properties = await readFile(new URL('../../gradle.properties', import.meta.url), 'utf8');
  const expectedVersion = /^tiplayVersionName=(.+)$/m.exec(properties)?.[1];
  const expectedCode = Number(/^tiplayVersionCode=(\d+)$/m.exec(properties)?.[1]);
  assert.ok(expectedVersion && Number.isSafeInteger(expectedCode), 'Missing product version metadata.');
  const addresses = Object.values(networkInterfaces()).flat().filter(value => value?.family === 'IPv4' && !value.internal).map(value => value.address);
  hostAddress ??= addresses[0];
  assert.ok(isIPv4(hostAddress) && addresses.includes(hostAddress), 'No ordinary host IPv4 interface is available.');

  const stdout = new PassThrough(), stderr = new PassThrough();
  const portReady = deferred(), proofReady = deferred(), exited = deferred();
  const mappings = new Map(), generations = new Set(), linkLocalGenerations = new Set();
  const nat = { ...udpCounters(), peerGenerationsCreated: 0,
    linkLocalCandidateGenerations: 0, observedLinkLocalHostCandidates: 0 };
  const instrumentationResult = instrumentationResultCollector();
  let instrumentation, socket, forwardPort, runtimeProof, finishedNormally = false, exitCode = null, closing, closingStarted = false;
  let responseChain = Promise.resolve();
  let udpFixtureRun, udpFixtureProof;
  const startupTimer = setTimeout(() => { portReady.reject(Error('Android instrumentation startup timed out.'));
    proofReady.reject(Error('Android runtime proof timed out.')); }, 60000);

  function proof() {
    const sourceCommit = process.env.GITHUB_SHA || process.env.ANDROID_AUDIO_SOURCE_SHA;
    return { ...(runtimeProof || {}), testApkSha256: inspected.test.sha256,
      sourceCommit: /^[0-9a-f]{40}$/.test(sourceCommit || '') ? sourceCommit : null,
      nat: { ...nat }, udpFixture: udpFixtureProof ? { ...udpFixtureProof, counters: { ...udpFixtureProof.counters } } : null,
      finishedNormally, instrumentationResult: { ...instrumentationResult.result } };
  }

  async function removeMapping(key, value) {
    await removeAndroidMapping({ key, value, mappings, nat: value.counters, runAdb });
  }

  async function mapping(generation, guestPort, counters = nat) {
    assert.equal(closingStarted, false, 'Android probe is closing.');
    const key = `${generation}:${guestPort}`;
    if (mappings.has(key)) return mappings.get(key);
    const publicSocket = createSocket('udp4'), reservation = createSocket('udp4'), flows = new Map();
    const bind = (udp, address) => new Promise((resolve, reject) => {
      udp.once('error', reject); udp.bind(0, address, () => { udp.removeListener('error', reject); resolve(); });
    });
    const forwardingError = () => {
      if (!closingStarted && mappings.has(key)) {
        counters.forwardingErrors++;
        // A failed fixture relay must leave RPC available for guest counters.
        if (counters === nat) socket?.destroy(Error('Android UDP forwarding failed.'));
      }
    };
    let redirectPort, redirectInstalled = false;
    try {
      await bind(publicSocket, hostAddress); await bind(reservation, '127.0.0.1');
      redirectPort = reservation.address().port;
      await new Promise(resolve => reservation.close(resolve));
      assert.equal(closingStarted, false, 'Android probe is closing.');
      const added = await runAdb(['emu', 'redir', 'add', `udp:${redirectPort}:${guestPort}`]);
      assert.match(added.stdout, /\bOK\b/, 'The emulator did not create the UDP mapping.');
      redirectInstalled = true; counters.redirectCommandsSucceeded++;
      const value = { publicSocket, flows, redirectPort, port: publicSocket.address().port, counters };
      mappings.set(key, value); counters.mappingsCreated++; counters.activeMappings++;
      // A close may have begun while adb was adding the owned redirect. Record
      // it first, then withdraw it through the same confirmed cleanup path.
      assert.equal(closingStarted, false, 'Android probe is closing.');
      publicSocket.on('error', forwardingError);
      publicSocket.on('message', (bytes, peer) => {
        if (closingStarted || !mappings.has(key)) return;
        const flowKey = peer.address + ':' + peer.port;
        let flow = flows.get(flowKey);
        if (!flow) {
          if (flows.size >= 32) { forwardingError(); return; }
          const upstream = createSocket('udp4');
          flow = { socket: upstream, ready: bind(upstream, '127.0.0.1') };
          flows.set(flowKey, flow);
          flow.ready.then(() => upstream.on('error', forwardingError), forwardingError);
          // Keep each browser source tuple distinct through the emulator NAT.
          upstream.on('message', (response, sender) => {
            if (!acceptUpstreamDatagram(counters, sender, redirectPort)) return;
            publicSocket.send(response, peer.port, peer.address, error => { if (error) forwardingError(); });
          });
        }
        counters.toGuestDatagrams++;
        flow.ready.then(() => {
          if (closingStarted || !mappings.has(key)) return;
          flow.socket.send(bytes, redirectPort, '127.0.0.1', error => { if (error) forwardingError(); });
        }).catch(forwardingError);
      });
      return value;
    } catch (error) {
      for (const udp of [reservation, publicSocket, ...[...flows.values()].map(flow => flow.socket)]) { try { udp.close(); } catch {} }
      if (redirectInstalled) await removeMapping(key, mappings.get(key)).catch(() => {});
      throw error;
    }
  }

  function probeUdpFixture(guestPort) {
    assert.ok(!udpFixtureRun, 'Run the Android UDP topology control once.');
    assert.ok(Number.isInteger(guestPort) && guestPort > 0 && guestPort <= 65535, 'Invalid UDP control port.');
    const counters = udpCounters(), nonce = randomBytes(32);
    const result = { nonceMatched: false, timedOut: false, attempts: 0, sentDatagrams: 0,
      receivedDatagrams: 0, unexpectedPayloadDatagrams: 0, errors: 0, cleanupComplete: false, counters };
    udpFixtureProof = result;
    udpFixtureRun = (async () => {
      let client, entry, infrastructureError;
      const key = `udp-fixture:${guestPort}`;
      try {
        entry = await mapping('udp-fixture', guestPort, counters);
        assert.equal(closingStarted, false, 'Android probe is closing.');
        client = createSocket('udp4');
        await new Promise((resolve, reject) => {
          client.once('error', reject);
          client.bind(0, hostAddress, () => { client.removeListener('error', reject); resolve(); });
        });
        await new Promise(resolve => {
          let done = false;
          const finish = () => {
            if (done) return; done = true;
            clearTimeout(deadline); clearInterval(retry); resolve();
          };
          const send = () => {
            if (closingStarted) { result.errors++; finish(); return; }
            if (result.attempts >= 5) return;
            result.attempts++;
            try {
              client.send(nonce, entry.port, hostAddress, error => {
                if (error) { result.errors++; finish(); } else result.sentDatagrams++;
              });
            } catch { result.errors++; finish(); }
          };
          const deadline = setTimeout(() => { result.timedOut = true; finish(); }, 3000);
          const retry = setInterval(send, 500);
          client.on('error', () => { result.errors++; finish(); });
          client.on('message', (bytes, sender) => {
            result.receivedDatagrams++;
            if (sender.address === hostAddress && sender.port === entry.port && bytes.equals(nonce)) {
              result.nonceMatched = true; finish();
            } else result.unexpectedPayloadDatagrams++;
          });
          send();
        });
      } catch (error) {
        result.failureClass = error.constructor.name;
        result.errors++; infrastructureError = true;
      } finally {
        try {
          await runCleanupActions([
            ['udp-control-client', async () => { if (client) await new Promise(resolve => { try { client.close(resolve); } catch { resolve(); } }); }],
            ['udp-control-mapping', async () => { if (mappings.has(key)) await removeMapping(key, mappings.get(key)); }],
          ]);
          result.cleanupComplete = counters.activeMappings === 0;
        } catch { result.errors++; }
        result.errors += counters.forwardingErrors;
      }
      if (infrastructureError) throw Error('Android UDP topology control infrastructure failed.');
      return { ...result, counters: { ...counters } };
    })();
    return udpFixtureRun;
  }

  async function mapAnswer(value) {
    assert.equal(closingStarted, false, 'Android probe is closing.');
    const generation = value.generation;
    assert.ok(Number.isSafeInteger(generation) && generation > 0, 'Invalid Android audio generation.');
    // Observe the native answer before any emulator endpoint translation. This
    // job must exercise the real IPv4LL gather path; do not manufacture one.
    const linkLocalCount = countIpv4LinkLocalHostCandidates(value.sdp);
    assert.ok(linkLocalCount > 0, 'Native Android answer lacks an IPv4 link-local host candidate.');
    if (!linkLocalGenerations.has(generation)) {
      linkLocalGenerations.add(generation); nat.linkLocalCandidateGenerations++;
      nat.observedLinkLocalHostCandidates += linkLocalCount;
    }
    for (const [key, entry] of [...mappings]) if (!key.startsWith(generation + ':')) await removeMapping(key, entry);
    const parts = value.sdp.split(/(\r?\n)/);
    for (let index = 0; index < parts.length; index += 2) {
      const line = parts[index];
      if (!line.startsWith('a=candidate:')) continue;
      const fields = [...line.matchAll(/\S+/g)];
      if (fields[2]?.[0].toLowerCase() !== 'udp' || !isIPv4(fields[4]?.[0])) continue;
      const port = Number(fields[5]?.[0]);
      assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid native UDP candidate port.');
      const translated = await mapping(generation, port);
      // Retain every other byte, including line endings and candidate whitespace.
      parts[index] = line.slice(0, fields[4].index) + hostAddress +
        line.slice(fields[4].index + fields[4][0].length, fields[5].index) + translated.port +
        line.slice(fields[5].index + fields[5][0].length);
    }
    assert.ok([...mappings.keys()].some(key => key.startsWith(generation + ':')), 'No native IPv4 UDP candidate to map.');
    if (!generations.has(generation)) { generations.add(generation); nat.peerGenerationsCreated++; }
    return { ...value, sdp: parts.join('') };
  }

  function acceptProof(value) {
    assert.equal(value.packageName, targetPackage); assert.equal(value.apkSha256, inspected.app.sha256);
    assert.equal(value.versionName, expectedVersion + '-hud-test'); assert.equal(value.versionCode, expectedCode);
    const runtime = value.runtime;
    assert.ok(Number.isInteger(runtime.uid) && runtime.uid >= 10000 && runtime.uid === runtime.applicationUid);
    assert.match(runtime.selinuxType, /^untrusted_app(?:_\d+)?$/);
    assert.equal(runtime.api, 35); assert.equal(runtime.abi, 'x86_64'); assert.equal(runtime.mainWebRtcInitialized, true);
    assert.equal(typeof runtime.qemuDefaultIpv4Present, 'boolean');
    for (const name of libraryNames) assert.deepEqual(value.libraries[name], inspected.app.libraries[name], 'Packaged Android library changed.');
    runtimeProof = value; clearTimeout(startupTimer); proofReady.resolve();
  }

  async function close() {
    if (closing) return closing;
    closingStarted = true;
    closing = (async () => {
      clearTimeout(startupTimer);
      let forced = false;
      await runCleanupActions([
        ['rpc-end', async () => { socket?.end(); }],
        ['instrumentation-exit', async () => {
          const timeout = setTimeout(() => { forced = true; instrumentation?.kill(); }, 7000);
          try { if (instrumentation) await exited.promise; } finally { clearTimeout(timeout); }
        }],
        ['rpc-destroy', async () => { socket?.destroy(); }],
        // No new response may enqueue once closingStarted is true. Drain the
        // in-flight mapper before taking the owned-redirection snapshot.
        ['response-and-mappings', () => drainAndRemoveMappings(Promise.allSettled([responseChain, udpFixtureRun]), mappings, removeMapping)],
        ['adb-forward', async () => { if (forwardPort) await runAdb(['forward', '--remove', `tcp:${forwardPort}`]); }],
        ['stdout-end', async () => { stdout.end(); }],
        ['stderr-end', async () => { stderr.end(); }],
        ['target-force-stop', async () => { if (forced) await runAdb(['shell', 'am', 'force-stop', targetPackage]); }],
        ['normal-completion', async () => {
          if (forced) throw Error('Android instrumentation did not finish normally.');
          if (runtimeProof) assert.ok(finishedNormally && exitCode === 0, 'Android instrumentation did not report normal completion.');
        }],
      ]);
    })();
    return closing;
  }

  try {
    await runAdb(['install', '-r', '-t', appApk]);
    await runAdb(['install', '-r', '-t', testApk]);
    instrumentation = spawn(adb, [...adbArgs, 'shell', 'am', 'instrument', '-w', '-r',
      '-e', 'expectedApkSha256', inspected.app.sha256, testComponent], { stdio: ['ignore', 'pipe', 'pipe'] });
    instrumentation.once('error', error => { portReady.reject(commandError(error)); proofReady.reject(commandError(error)); exited.resolve(); });
    instrumentation.stderr.on('data', bytes => stderr.write(bytes));
    createInterface({ input: instrumentation.stdout }).on('line', line => {
      const port = /^INSTRUMENTATION_STATUS: tiplayRpcPort=(\d+)$/.exec(line);
      if (port) portReady.resolve(Number(port[1]));
      instrumentationResult.accept(line);
      finishedNormally = instrumentationResult.result.completed === true;
    });
    // Wait for stdio close too, so the final Instrumentation result has been parsed.
    instrumentation.once('close', code => {
      exitCode = code;
      if (!closingStarted) { portReady.reject(instrumentationResult.failure());
        proofReady.reject(instrumentationResult.failure()); }
      exited.resolve();
    });
    const guestRpcPort = await portReady.promise;
    forwardPort = Number((await runAdb(['forward', 'tcp:0', `tcp:${guestRpcPort}`])).stdout.trim());
    assert.ok(Number.isInteger(forwardPort) && forwardPort > 0 && forwardPort <= 65535, 'Invalid adb forward port.');
    socket = connect(forwardPort, '127.0.0.1');
    socket.on('error', error => { proofReady.reject(error); if (runtimeProof && !closingStarted) stderr.write('Android probe RPC failed.\n'); });
    createInterface({ input: socket }).on('line', line => {
      if (closingStarted) return;
      responseChain = responseChain.then(async () => {
        const value = JSON.parse(line);
        if (value.k === 'android-runtime-proof') { acceptProof(value.proof); return; }
        const mapped = value.ok !== false && value.k === 'answer' ? await mapAnswer(value) : value;
        stdout.write(JSON.stringify(mapped) + '\n');
      }).catch(error => {
        proofReady.reject(error);
        if (!closingStarted) stderr.write('Android probe response mapping failed.\n');
        socket.destroy();
      });
    });
    await proofReady.promise;
    return { stdin: socket, stdout, stderr, get exitCode() { return exitCode; }, get proof() { return proof(); },
      kill() { void close().catch(() => {}); return true; }, close, probeUdpFixture };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
