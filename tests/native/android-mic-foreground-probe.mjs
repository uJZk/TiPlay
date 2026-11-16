// SPDX-License-Identifier: GPL-3.0-only
// Manual API36 admission proof. Never starts instrumentation or any recording API.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
export const PACKAGE = 'com.ujzk.tiplay.hudtest';
export const ACTIVITY = 'com.shilapi.xcertplay.foregroundproof.ForegroundAdmissionProofActivity';
export const GUARD = 'com.shilapi.xcertplay.foregroundproof.ForegroundAdmissionGuardService';
export const PROBE = 'com.shilapi.xcertplay.foregroundproof.ForegroundAdmissionProbeService';
const BASE = 16, MIC = 128, FOREGROUND_MODE = 4;
const TOP_REASONS = new Set(['PROC_STATE_TOP', 'UID_VISIBLE']);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Fail closed on unknown dumps; only bounded classifications leave the controller. */
export function parseServices(text) {
  assert.match(text, /ACTIVITY MANAGER SERVICES/, 'Unsupported service dump.');
  const headers = [...text.matchAll(/^\s*\* ServiceRecord\{[^\n]*?\s([^\s}]+\/[^\s}]+)\}/gm)];
  return headers.map((header, index) => {
    const block = text.slice(header.index, headers[index + 1]?.index ?? text.length);
    const component = header[1].split('/')[1];
    const reason = name => {
      const match = new RegExp('\\b' + name + '=([A-Z0-9_]+)').exec(block);
      return match?.[1] ?? null;
    };
    const type = /\btypes=0x([0-9a-f]+)/i.exec(block);
    const caller = /\brecentCallingUid=(\d+)/.exec(block);
    return { component, recordIdentity: createHash('sha256').update(header[0]).digest('hex').slice(0, 16),
      foreground: /\bisForeground=true\b/.test(block),
      types: type ? Number.parseInt(type[1], 16) : 0,
      wiuStart: reason('getFgsAllowWiu_forStart'), wiuCapabilities: reason('getFgsAllowWiu_forCapabilities'),
      wiuNoBinding: reason('mAllowWiu_noBinding'), wiuInBind: reason('mAllowWiu_inBindService'),
      wiuByBinding: reason('mAllowWiu_byBindings'), startReason: reason('mAllowStart_noBinding'),
      recentCallingUid: caller ? Number(caller[1]) : null,
      backgroundActivityBinding: /mIsAllowedBgActivityStartsByBinding=true/.test(block),
      backgroundActivityStart: /mIsAllowedBgActivityStartsByStart=[^\n]*allowsBackgroundActivityStarts=true/.test(block) };
  });
}

export function instrumentationAbsent(text) {
  assert.match(text, /ACTIVITY MANAGER.*PROCESSES/, 'Unsupported process dump.');
  return !/Active instrumentation:|ActiveInstrumentation\{|instrumentationClass=(?!null\b)\S+/.test(text);
}

export function parseUidState(text) {
  if (/\b(?:PROCESS_STATE_)?TOP\b/.test(text)) return 'top';
  if (/\b(?:PROCESS_STATE_)?FOREGROUND_SERVICE\b|\bFGS\b/.test(text)) return 'fgs';
  const numeric = /^\s*([0-9]+)(?:\s|$)/.exec(text);
  if (numeric?.[1] === '2') return 'top';
  if (numeric?.[1] === '4') return 'fgs';
  throw Error('Unsupported UID state.');
}

export function parseRecordingOp(text) {
  const operation = /\bRECORD_AUDIO:\s*(foreground|allow|ignore|deny|default)\b/i.exec(text);
  assert.ok(operation || /No operations\./.test(text), 'Unsupported recording app-op dump.');
  return { mode: operation?.[1].toLowerCase() ?? 'absent', active: /\(running\)|running=true/.test(text) };
}

export function ownedNotifications(text) {
  assert.match(text, /Current Notification Manager state/, 'Unsupported notification dump.');
  const sections = [...text.matchAll(/^ {2}(?:Notification List|Enqueued Notification List):\s*$/gm)];
  assert.ok(sections.length, 'Missing active notification sections.');
  let count = 0;
  for (const section of sections) {
    const rest = text.slice(section.index + section[0].length);
    const next = /^ {2}\S/m.exec(rest);
    const body = rest.slice(0, next?.index ?? rest.length);
    count += body.split('\n').filter(row => row.includes('NotificationRecord(') &&
      row.includes('pkg=' + PACKAGE + ' ') && /\bid=(?:30001|30002)\b/.test(row)).length;
  }
  return count;
}

export function frozenAppMetadata(properties) {
  const names = [...properties.matchAll(/^tiplayVersionName=(.+)$/gm)];
  const codes = [...properties.matchAll(/^tiplayVersionCode=([0-9]+)$/gm)];
  assert.equal(names.length, 1, 'Missing or ambiguous committed version name.');
  assert.equal(codes.length, 1, 'Missing or ambiguous committed version code.');
  const versionCode = Number(codes[0][1]); assert.ok(Number.isSafeInteger(versionCode) && versionCode > 0);
  return { versionName: names[0][1].trim() + '-hud-test', versionCode };
}

export function validateIdentity(report, expectedApkHash, expectedMetadata) {
  const runtime = report.runtime;
  assert.equal(report.packageName, PACKAGE); assert.equal(report.apkSha256, expectedApkHash);
  assert.ok(Number.isInteger(runtime?.uid) && runtime.uid >= 10000);
  assert.equal(runtime.uid, runtime.applicationUid); assert.match(runtime.selinuxType, /^untrusted_app(?:_[0-9]+)?$/);
  assert.equal(runtime.sdk, 36); assert.equal(runtime.targetSdk, 37);
  assert.equal(report.recordingOpenedByHarness, false); assert.equal(report.bluetoothUsedByHarness, false);
  assert.equal(report.instrumentationUsedByHarness, false);
  assert.match(report.versionName, /-hud-test$/); assert.ok(Number.isInteger(report.versionCode));
  if (expectedMetadata) {
    assert.equal(report.versionName, expectedMetadata.versionName, 'Installed version differs from the build source commit.');
    assert.equal(report.versionCode, expectedMetadata.versionCode, 'Installed version code differs from the build source commit.');
  }
  const exemptions = report.exemptions;
  assert.equal(exemptions?.companionAssociations, 0);
  for (const name of ['ignoringBatteryOptimizations', 'overlayPermission', 'deviceOwner', 'profileOwner',
    'privilegedBackgroundActivityPermission', 'privilegedBackgroundFgsPermission', 'voiceInteractionOwner'])
    assert.equal(exemptions[name], false, 'Unexpected admission exemption.');
}

function serviceAt(snapshot, component, types, uid) {
  const matches = snapshot.services.filter(service => service.component === component);
  assert.equal(matches.length, 1, 'Missing or ambiguous proof service.');
  const service = matches[0]; assert.equal(service.foreground, true); assert.equal(service.types, types);
  assert.equal(service.recentCallingUid, uid, 'Service was not dispatched by the application UID.');
  assert.equal(service.backgroundActivityBinding, false); assert.equal(service.backgroundActivityStart, false);
  return service;
}

export function validateObservation(phase, report, snapshot) {
  const state = report.lastState, uid = report.runtime.uid;
  assert.equal(snapshot.instrumentationAbsent, true, 'Instrumentation exemption invalidates this proof.');
  assert.equal(snapshot.recordingActive, false, 'The admission proof must not record audio.');
  assert.equal(snapshot.services.some(service => service.foreground && ![GUARD, PROBE].includes(service.component)), false,
    'An unrelated foreground owner invalidates the isolated app control.');
  const background = phase.includes('background') || phase.startsWith('negative-before') || phase.startsWith('negative-mic');
  if (background) {
    assert.equal(state.uiResumed, false); assert.equal(state.importance, 125);
    assert.ok(state.backgroundElapsedMs >= 45_000); assert.equal(snapshot.uidState, 'fgs');
  } else if (phase.endsWith('visible-armed') || phase === 'negative-guard-visible') {
    assert.equal(state.uiResumed, true); assert.equal(state.importance, 100); assert.equal(snapshot.uidState, 'top');
  }
  if (report.scenario !== 'missing') {
    assert.equal(state.recordAudioGranted, true);
    assert.equal(state.recordAudioRawMode, FOREGROUND_MODE, 'A permissive app-op would bypass the negative.');
    assert.equal(snapshot.recordingOpMode, 'foreground', 'Independent app-op mode differs.');
  }
  if (phase === 'negative-before-probe') {
    assert.equal(report.probeCreateCount, 0, 'The negative probe must be a fresh ServiceRecord.');
    assert.equal(snapshot.services.some(service => service.component === PROBE), false);
    serviceAt(snapshot, GUARD, BASE, uid);
  } else if (phase === 'negative-mic-rejected-base-live') {
    assert.equal(report.probeCreateCount, 1);
    serviceAt(snapshot, GUARD, BASE, uid);
    const probe = serviceAt(snapshot, PROBE, BASE, uid);
    for (const key of ['wiuStart', 'wiuCapabilities', 'wiuNoBinding', 'wiuInBind', 'wiuByBinding'])
      assert.equal(probe[key], 'DENIED', 'The fresh probe inherited a while-in-use exemption.');
    assert.equal(probe.startReason, 'PROC_STATE_FGS', 'A special background-start exemption is not this control.');
    const dispatch = report.events.find(event => event.event === 'app-handler-probe-dispatch');
    assert.equal(dispatch?.details.uid, uid); assert.equal(dispatch?.details.binderCallingUid, uid);
    const denial = report.events.find(event => event.event === 'start-foreground-rejected');
    assert.equal(denial?.details.exceptionClass, 'java.lang.SecurityException');
    assert.equal(denial.details.microphoneTypeDenial, true); assert.equal(denial.details.eligibleStateMentioned, true);
    assert.equal(denial.state.recordAudioGranted, true);
    assert.ok(report.events.some(event => event.event === 'actual-common-helper' &&
      event.details.message.includes('MICROPHONE_ELIGIBILITY_UNAVAILABLE')));
    assert.ok(report.events.some(event => event.event === 'guard-heartbeat' && event.atElapsedMs > denial.atElapsedMs));
  } else if (phase.startsWith('positive-')) {
    const types = phase === 'positive-background-downgraded' ? BASE : BASE | MIC;
    const probe = serviceAt(snapshot, PROBE, types, uid);
    assert.ok(TOP_REASONS.has(probe.wiuStart)); assert.ok(TOP_REASONS.has(probe.wiuCapabilities));
    assert.equal(report.events.some(event => event.event === 'start-foreground-rejected'), false);
  } else if (phase === 'missing-rejected-base-live') {
    serviceAt(snapshot, PROBE, BASE, uid); assert.equal(state.recordAudioGranted, false);
    assert.ok(report.events.some(event => event.event === 'start-foreground-rejected' && event.details.microphoneTypeDenial));
    assert.ok(report.events.some(event => event.event === 'actual-common-helper' &&
      event.details.message.includes('MICROPHONE_PERMISSION_MISSING')));
  } else throw Error('Unexpected proof phase.');
}

async function runAdb(adb, serial, args) {
  try { return (await execFile(adb, ['-s', serial, ...args], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
  catch { throw Error('Owned emulator command failed.'); }
}

export async function runProof({ adb = process.env.ADB || 'adb', serial = process.env.ANDROID_SERIAL || 'emulator-5554',
  appApk = process.env.ANDROID_FGS_APP_APK, output = process.env.ANDROID_FGS_PROOF_OUTPUT } = {}) {
  assert.match(serial, /^emulator-[0-9]+$/); assert.ok(appApk && output, 'Missing APK or output path.');
  const command = args => runAdb(adb, serial, args);
  assert.equal((await command(['shell', 'getprop', 'ro.kernel.qemu'])).trim(), '1');
  assert.equal((await command(['shell', 'getprop', 'ro.build.version.sdk'])).trim(), '36');
  const bytes = await readFile(appApk), apkSha256 = createHash('sha256').update(bytes).digest('hex');
  await execFile('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert not any(n.startswith("assets/offline-mfi/") for n in z.namelist())', appApk]);
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const sourceCommit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
  if (process.env.GITHUB_SHA) assert.equal(sourceCommit, process.env.GITHUB_SHA);
  assert.match(sourceCommit, /^[0-9a-f]{40}$/);
  const committed = async path => (await execFile('git', ['show', sourceCommit + ':' + path], { cwd: repository })).stdout;
  const properties = await committed('gradle.properties'), expectedMetadata = frozenAppMetadata(properties);
  const helper = await committed('common/src/main/java/com/shilapi/xcertplay/SessionForegroundStart.kt');
  await command(['install', '-r', '-t', appApk]);
  const cases = [], result = { status: 'running', sourceCommit, apkSha256, apkBytes: bytes.length,
    committedAppMetadata: expectedMetadata, committedPropertiesSha256: createHash('sha256').update(properties).digest('hex'),
    helperSourceSha256: createHash('sha256').update(helper).digest('hex'),
    fixturePermissionSetup: 'Before measured cases only: ordinary runtime grant, RECORD_AUDIO app-op restricted to foreground; no FGS/while-in-use allowlist or role exemption.',
    sdk: 36, scenarios: cases, instrumentationStarted: false, recordingOpened: false,
    productionServiceIntegrationVerified: false, bluetoothOrScoVerified: false };
  let forcedCleanup = false;
  try {
    for (const scenario of ['positive', 'background', 'missing']) {
      await command(['shell', 'am', 'force-stop', PACKAGE]);
      // Setup ends before the only Activity launch. No app-op or permission mutation occurs during a measured background phase.
      await command(['shell', 'pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS']);
      if (scenario === 'missing') await command(['shell', 'pm', 'revoke', PACKAGE, 'android.permission.RECORD_AUDIO']);
      else {
        await command(['shell', 'pm', 'grant', PACKAGE, 'android.permission.RECORD_AUDIO']);
        await command(['shell', 'cmd', 'appops', 'set', PACKAGE, 'RECORD_AUDIO', 'foreground']);
      }
      const token = randomBytes(12).toString('hex'), reportPath = `files/foreground-admission-${token}.json`;
      result.currentScenario = scenario;
      const needed = scenario === 'positive' ? ['positive-visible-armed', 'positive-background-retained', 'positive-background-downgraded'] :
        scenario === 'background' ? ['negative-guard-visible', 'negative-before-probe', 'negative-mic-rejected-base-live'] : ['missing-rejected-base-live'];
      const observations = new Map();
      await command(['shell', 'am', 'start', '-W', '-n', PACKAGE + '/' + ACTIVITY, '--es', 'scenario', scenario, '--es', 'runToken', token]);
      const deadline = Date.now() + 210_000;
      let report;
      while (Date.now() < deadline) {
        let text;
        try { text = await command(['shell', 'run-as', PACKAGE, 'cat', reportPath]); } catch { await sleep(250); continue; }
        try { report = JSON.parse(text); } catch { await sleep(250); continue; }
        result.lastAppReport = report;
        validateIdentity(report, apkSha256, expectedMetadata); assert.equal(report.scenario, scenario); assert.equal(report.runToken, token);
        if (report.status === 'failed') throw Error('App admission proof failed: ' + (report.failureCode || 'unknown') + '.');
        if (needed.includes(report.phase) && !observations.has(report.phase)) {
          const [services, processes, uidState, ops] = await Promise.all([
            command(['shell', 'dumpsys', 'activity', 'services', PACKAGE]),
            command(['shell', 'dumpsys', 'activity', 'processes']),
            command(['shell', 'am', 'get-uid-state', String(report.runtime.uid)]),
            command(['shell', 'cmd', 'appops', 'get', PACKAGE, 'RECORD_AUDIO']),
          ]);
          const recording = parseRecordingOp(ops);
          const snapshot = { services: parseServices(services), instrumentationAbsent: instrumentationAbsent(processes),
            uidState: parseUidState(uidState), recordingActive: recording.active, recordingOpMode: recording.mode };
          // First post-denial heartbeat can be up to two seconds later; observe the same stable phase again.
          if (report.phase === 'negative-mic-rejected-base-live' && !report.events.some(event => event.event === 'guard-heartbeat' &&
            event.atElapsedMs > (report.events.find(event => event.event === 'start-foreground-rejected')?.atElapsedMs ?? Infinity))) {
            await sleep(300); continue;
          }
          validateObservation(report.phase, report, snapshot);
          observations.set(report.phase, { phase: report.phase, appSample: report, system: snapshot });
          result.currentObservations = [...observations.values()];
        }
        if (report.status === 'completed') break;
        await sleep(250);
      }
      assert.equal(report?.status, 'completed', 'Application did not complete within its owned budget.');
      assert.deepEqual([...observations.keys()], needed, 'A required real-system observation window was missed.');
      if (scenario === 'background') {
        const identities = [...observations.values()].map(value => value.system.services.find(service => service.component === GUARD)?.recordIdentity);
        assert.ok(identities.every(value => value && value === identities[0]), 'Guard ServiceRecord was replaced.');
        assert.equal(report.events.filter(event => event.event === 'service-created' && event.details.role === 'guard').length, 1);
      }
      let remaining = [], notifications = -1;
      for (let attempt = 0; attempt < 20; attempt++) {
        remaining = parseServices(await command(['shell', 'dumpsys', 'activity', 'services', PACKAGE]));
        notifications = ownedNotifications(await command(['shell', 'dumpsys', 'notification', '--noredact']));
        if (!remaining.some(service => [GUARD, PROBE].includes(service.component)) && notifications === 0) break;
        await sleep(250);
      }
      assert.equal(remaining.some(service => [GUARD, PROBE].includes(service.component)), false, 'Owned service survived normal cleanup.');
      assert.equal(notifications, 0, 'Owned foreground notification survived normal cleanup.');
      assert.deepEqual(report.lastState.activeServices, []);
      cases.push({ scenario, status: 'passed', observations: [...observations.values()], report, normalCleanupVerified: true,
        remainingOwnedServices: 0, remainingOwnedNotifications: notifications,
        permissionRevokeDuringMeasuredPhase: false, permissionRevocationProcessKillClaimed: false });
    }
    delete result.lastAppReport; delete result.currentObservations; delete result.currentScenario;
    result.status = 'passed'; result.normalCleanupVerified = true;
  } catch (error) {
    result.status = 'failed'; result.failure = error.message;
    // Emergency cleanup is never relabeled as successful normal service cleanup.
    forcedCleanup = true; await command(['shell', 'am', 'force-stop', PACKAGE]).catch(() => {});
  } finally {
    result.forcedCleanup = forcedCleanup;
    await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  }
  assert.equal(result.status, 'passed', result.failure || 'Foreground admission proof failed.');
  console.log(JSON.stringify({ status: result.status, sdk: result.sdk, sourceCommit, apkSha256,
    scenarios: cases.map(value => ({ scenario: value.scenario, status: value.status })), normalCleanupVerified: result.normalCleanupVerified,
    forcedCleanup, productionServiceIntegrationVerified: false, bluetoothOrScoVerified: false }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runProof();
