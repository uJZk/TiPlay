// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { PACKAGE, GUARD, PROBE, parseServices, serviceHeaderShapes, parseUidState, instrumentationAbsent, parseRecordingOp, ownedNotifications, frozenAppMetadata,
  validateIdentity, validateObservation } from './android-mic-foreground-probe.mjs';

function fixture() {
  const state = { importance: 125, recordAudioGranted: true, recordAudioRawMode: 4,
    uiResumed: false, backgroundElapsedMs: 46_000, activeServices: ['guard', 'probe'] };
  const report = { packageName: PACKAGE, apkSha256: 'a'.repeat(64), scenario: 'background',
    versionName: 'fixture-hud-test', versionCode: 1,
    runtime: { uid: 10209, applicationUid: 10209, pid: 321, selinuxType: 'untrusted_app', sdk: 36, targetSdk: 37 },
    recordingOpenedByHarness: false, bluetoothUsedByHarness: false, instrumentationUsedByHarness: false,
    exemptions: { companionAssociations: 0, ignoringBatteryOptimizations: false, overlayPermission: false,
      deviceOwner: false, profileOwner: false, privilegedBackgroundActivityPermission: false,
      privilegedBackgroundFgsPermission: false, voiceInteractionOwner: false },
    probeCreateCount: 1, lastState: state,
    events: [
      { event: 'app-handler-probe-dispatch', details: { uid: 10209, binderCallingUid: 10209 } },
      { event: 'start-foreground-rejected', atElapsedMs: 60_000, state,
        details: { exceptionClass: 'java.lang.SecurityException', microphoneTypeDenial: true, eligibleStateMentioned: true } },
      { event: 'actual-common-helper', details: { message: 'reason=MICROPHONE_ELIGIBILITY_UNAVAILABLE' } },
      { event: 'guard-heartbeat', atElapsedMs: 62_000, details: { actualTypes: 16 } },
    ] };
  const service = component => ({ component, recordIdentity: component, foreground: true, types: 16,
    wiuStart: 'DENIED', wiuCapabilities: 'DENIED', wiuNoBinding: 'DENIED',
    wiuInBind: 'DENIED', wiuByBinding: 'DENIED', startReason: 'PROC_STATE_FGS',
    recentCallingUid: 10209, backgroundActivityBinding: false, backgroundActivityStart: false });
  return { report, snapshot: { services: [service(GUARD), service(PROBE)], instrumentationAbsent: true,
    recordingActive: false, recordingOpMode: 'foreground', uidState: 'fgs' } };
}

test('AOSP16 service dump parser reads actual type, caller and per-service reasons', () => {
  const source = `ACTIVITY MANAGER SERVICES (dumpsys activity services)
  * ServiceRecord{a123 u0 ${PACKAGE}/${PROBE} c:${PACKAGE}}
    recentCallingUid=10209
    getFgsAllowWiu_forStart=DENIED
    getFgsAllowWiu_forCapabilities=DENIED
    mAllowWiu_noBinding=DENIED
    mAllowWiu_inBindService=DENIED
    mAllowWiu_byBindings=DENIED
    mAllowStart_noBinding=PROC_STATE_FGS
    isForeground=true foregroundId=30002 types=0x00000010 foregroundNoti=Notification()
`;
  const [value] = parseServices(source);
  assert.equal(value.component, PROBE); assert.equal(value.types, 16); assert.equal(value.recentCallingUid, 10209);
  assert.equal(value.wiuStart, 'DENIED'); assert.equal(value.startReason, 'PROC_STATE_FGS');
  assert.match(value.recordIdentity, /^[0-9a-f]{16}$/);
  assert.deepEqual(serviceHeaderShapes(source), { count: 1, truncated: false,
    shapes: [{ recognized: true, component: 'probe', callingPackage: 'application' }] });
  assert.equal(parseServices(source.replace(` c:${PACKAGE}`, ''))[0].component, PROBE);
  const second = source.replace('a123', 'b456').replaceAll(PROBE, GUARD).replace('types=0x00000010', 'types=0x00000090');
  const records = parseServices(source + second.slice(second.indexOf('  * ServiceRecord')));
  assert.deepEqual(records.map(record => [record.component, record.types]), [[PROBE, 16], [GUARD, 144]]);
  assert.notEqual(records[0].recordIdentity, records[1].recordIdentity);
  assert.throws(() => parseServices(source.replace(` c:${PACKAGE}`, ` c:${PACKAGE} unknown:extra`)), /Unsupported ServiceRecord header/);
  assert.equal(serviceHeaderShapes(source.replace(` c:${PACKAGE}`, ' unknown:extra')).shapes[0].recognized, false);
  const bounded = serviceHeaderShapes(Array(13).fill(source).join(''));
  assert.equal(bounded.count, 13); assert.equal(bounded.truncated, true); assert.equal(bounded.shapes.length, 12);
  assert.throws(() => parseServices('unknown platform output'));
});

test('instrumentation and unknown UID-state observations fail closed', () => {
  assert.equal(instrumentationAbsent('ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)'), true);
  assert.equal(instrumentationAbsent('ACTIVITY MANAGER RUNNING PROCESSES\n  Active instrumentation:\n    ActiveInstrumentation{x}'), false);
  assert.throws(() => instrumentationAbsent('no diagnostic permission'));
  assert.equal(parseUidState('FOREGROUND_SERVICE'), 'fgs'); assert.equal(parseUidState('4 (FGS)'), 'fgs');
  assert.equal(parseUidState('PROCESS_STATE_TOP'), 'top'); assert.throws(() => parseUidState('unknown'));
});

test('recording and notification observations reject unknown dumps and exclude notification history', () => {
  assert.deepEqual(parseRecordingOp('RECORD_AUDIO: foreground'), { mode: 'foreground', active: false });
  assert.equal(parseRecordingOp('RECORD_AUDIO: foreground; duration=(running)').active, true);
  assert.throws(() => parseRecordingOp('Unknown operation'));
  const text = `Current Notification Manager state:\n  Notification List:\n    NotificationRecord(x: pkg=${PACKAGE} user=0 id=30001 tag=null)\n  Archive:\n    NotificationRecord(x: pkg=${PACKAGE} user=0 id=30002 tag=null)\n`;
  assert.equal(ownedNotifications(text), 1);
  assert.equal(ownedNotifications(text.replace('id=30001', 'id=40000')), 0);
  assert.throws(() => ownedNotifications('No dump permission'));
});

test('identity gate rejects wrong app/domain/SDK, permissive exemptions and claimed recording', () => {
  const { report } = fixture(); validateIdentity(report, 'a'.repeat(64));
  for (const change of [r => { r.runtime.uid = 2000; }, r => { r.runtime.applicationUid = 1000; },
    r => { r.runtime.selinuxType = 'shell'; }, r => { r.runtime.sdk = 35; },
    r => { r.apkSha256 = 'b'.repeat(64); }, r => { r.exemptions.deviceOwner = true; },
    r => { r.exemptions.companionAssociations = 1; }, r => { r.recordingOpenedByHarness = true; }]) {
    const altered = structuredClone(report); change(altered); assert.throws(() => validateIdentity(altered, 'a'.repeat(64)));
  }
});

test('APK version is cross-checked against committed metadata, independent of a dirty working tree', () => {
  const expected = frozenAppMetadata('tiplayVersionName=fixture\ntiplayVersionCode=1\n');
  const { report } = fixture(); validateIdentity(report, 'a'.repeat(64), expected);
  assert.throws(() => validateIdentity({ ...report, versionCode: 2 }, 'a'.repeat(64), expected));
  assert.throws(() => validateIdentity({ ...report, versionName: 'another-hud-test' }, 'a'.repeat(64), expected));
  assert.throws(() => frozenAppMetadata('tiplayVersionCode=1\n'));
  assert.throws(() => frozenAppMetadata('tiplayVersionName=fixture\ntiplayVersionName=other\ntiplayVersionCode=1\n'));
});

test('real MIC-negative evidence requires denial, non-inherited WIU, BFSL base and app-owned dispatch', () => {
  const { report, snapshot } = fixture(); validateObservation('negative-mic-rejected-base-live', report, snapshot);
  const mutations = [
    (r, s) => { s.instrumentationAbsent = false; }, (r, s) => { s.recordingActive = true; },
    r => { r.lastState.recordAudioRawMode = 0; }, r => { r.lastState.recordAudioGranted = false; },
    r => { r.lastState.uiResumed = true; }, r => { r.lastState.backgroundElapsedMs = 500; },
    r => { r.probeCreateCount = 2; }, (r, s) => { s.uidState = 'top'; },
    (r, s) => { s.services[1].wiuStart = 'PROC_STATE_TOP'; }, (r, s) => { s.services[1].wiuCapabilities = null; },
    (r, s) => { s.services[1].wiuByBinding = 'INSTR_BACKGROUND_ACTIVITY_PERMISSION'; },
    (r, s) => { s.services[1].startReason = 'TEMP_ALLOWED_WHILE_IN_USE'; },
    (r, s) => { s.services[1].recentCallingUid = 2000; },
    (r, s) => { s.services[1].types = 144; }, (r, s) => { s.services[0].foreground = false; },
    r => { r.events[0].details.binderCallingUid = 2000; },
    r => { r.events[1].details.exceptionClass = 'android.app.ForegroundServiceStartNotAllowedException'; },
    r => { r.events[1].details.eligibleStateMentioned = false; },
    r => { r.events[2].details.message = 'MICROPHONE_PERMISSION_MISSING'; },
    r => { r.events.pop(); },
  ];
  for (const mutate of mutations) {
    const r = structuredClone(report), s = structuredClone(snapshot); mutate(r, s);
    assert.throws(() => validateObservation('negative-mic-rejected-base-live', r, s));
  }
});

test('pre-probe negative window proves a fresh absent Probe rather than cached TOP history', () => {
  const { report, snapshot } = fixture(); report.probeCreateCount = 0; snapshot.services.pop();
  validateObservation('negative-before-probe', report, snapshot);
  report.probeCreateCount = 1; assert.throws(() => validateObservation('negative-before-probe', report, snapshot));
});

test('positive retained MIC requires actual MIC bit and allowed WIU, while downgrade requires its removal', () => {
  const { report, snapshot } = fixture(); report.scenario = 'positive'; report.events = []; report.lastState.activeServices = ['probe'];
  snapshot.services = [snapshot.services[1]]; const probe = snapshot.services[0];
  probe.types = 144; probe.wiuStart = probe.wiuCapabilities = 'PROC_STATE_TOP';
  validateObservation('positive-background-retained', report, snapshot);
  probe.types = 16; assert.throws(() => validateObservation('positive-background-retained', report, snapshot));
  validateObservation('positive-background-downgraded', report, snapshot);
  probe.types = 144; assert.throws(() => validateObservation('positive-background-downgraded', report, snapshot));
});

test('missing-permission control cannot be relabeled as a while-in-use denial', () => {
  const { report, snapshot } = fixture(); report.scenario = 'missing'; report.lastState.recordAudioGranted = false;
  report.events[2].details.message = 'MICROPHONE_PERMISSION_MISSING'; snapshot.services.shift();
  validateObservation('missing-rejected-base-live', report, snapshot);
  report.lastState.recordAudioGranted = true; assert.throws(() => validateObservation('missing-rejected-base-live', report, snapshot));
});
