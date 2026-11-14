#!/usr/bin/env python3
"""Keep the focused interop proof isolated from producer publication and full CI."""
from pathlib import Path
import importlib.util
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/native-rtc-audio.yml"
HARNESS = ROOT / "tests/web-e2e/rtc-audio-native.mjs"


class AudioInteropWorkflowTest(unittest.TestCase):
    def test_existing_dispatch_keeps_android_default_and_host_is_a_separate_choice(self):
        source = WORKFLOW.read_text()
        self.assertIn("default: android-binaries", source)
        self.assertIn("type: choice", source)
        self.assertIn("if: ${{ inputs.mode == '' || inputs.mode == 'android-binaries' }}", source)
        self.assertIn("if: ${{ inputs.mode == 'host-interop' }}", source)
        self.assertIn("if: ${{ inputs.mode == 'android-interop' }}", source)
        jobs = re.split(r"^  ([\w-]+):\n", source.split("jobs:\n", 1)[1], flags=re.M)
        jobs = dict(zip(jobs[1::2], jobs[2::2]))
        self.assertEqual({"native", "host-interop", "android-interop", "symbols"}, set(jobs))
        self.assertIn("needs: native", jobs["symbols"])
        self.assertNotIn("contents: write", jobs["host-interop"])
        self.assertNotIn("archive_native_symbols", jobs["host-interop"])
        self.assertNotIn("contents: write", jobs["android-interop"])
        self.assertNotIn("archive_native_symbols", jobs["android-interop"])

    def test_positive_control_is_required_before_negative_controls(self):
        source = WORKFLOW.read_text().split("  host-interop:\n", 1)[1].split("  android-interop:\n", 1)[0]
        positive = source.index("run: node tests/web-e2e/rtc-audio-native.mjs\n")
        blackhole = source.index("--fault=udp-blackhole")
        password = source.index("--fault=wrong-ice-password")
        self.assertLess(positive, blackhole)
        self.assertLess(blackhole, password)
        self.assertNotIn("continue-on-error", source)
        self.assertIn("id: baseline", source)
        self.assertEqual(2, source.count("if: ${{ !cancelled() && steps.baseline.outcome == 'success' }}"))
        self.assertNotIn("assembleDebug", source)
        self.assertNotIn("testDebugUnitTest", source)
        self.assertIn(":shared:compileDebugKotlin", source)
        self.assertIn("build.py --host", source)
        self.assertIn("tiplay-audio-interop/*.json", source)

    def test_android_mode_uses_only_two_app_uid_controls_and_bounded_kvm(self):
        source = WORKFLOW.read_text().split("  android-interop:\n", 1)[1].split("  symbols:\n", 1)[0]
        self.assertIn(":mobile:assembleDebug :mobile:assembleDebugAndroidTest", source)
        self.assertIn("system-images;android-35;google_apis;x86_64", source)
        self.assertIn("if [ ! -c /dev/kvm ]", source)
        self.assertIn("-accel on", source)
        self.assertIn("timeout 300", source)
        self.assertIn("seq 1 150", source)
        self.assertEqual(2, source.count("run: node tests/web-e2e/rtc-audio-native.mjs --backend=android"))
        self.assertNotIn("--fault=", source)
        self.assertNotIn("build.py --host", source)
        self.assertNotIn("testDebugUnitTest", source)
        self.assertNotIn("lintDebug", source)
        self.assertIn("path: ${{ runner.temp }}/tiplay-android-audio-interop/*.json", source)
        self.assertNotIn("*.log", source.split("name: Upload bounded synthetic Android", 1)[1])

    def test_android_backend_does_not_load_the_host_transport_or_permit_fault_mode(self):
        source = HARNESS.read_text()
        self.assertIn("assert.ok(['host', 'android'].includes(runtimeBackend)", source)
        self.assertIn("runtimeBackend === 'host' || fault === 'none'", source)
        self.assertIn("if (runtimeBackend === 'host')", source)
        self.assertIn("await import('../native/android-audio-probe.mjs')", source)
        self.assertIn("runtimeBackend === 'android' ? closeAndroidChild()", source)
        self.assertIn("await child.close()", source)
        self.assertIn("/^emulator-[0-9]+$/", source)
        self.assertIn("runtime.uid, runtime.applicationUid", source)
        self.assertIn("/^untrusted_app(?:_[0-9]+)?$/", source)
        self.assertIn("proof.finishedNormally, true", source)

    def test_actual_android_proof_gate_rejects_wrong_uid_domain_and_missing_identity(self):
        script = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(process.argv[1], 'utf8');
const body = source.slice(source.indexOf('function verifiedAndroidProof('), source.indexOf('async function report('));
const base = { runtime: { uid: 10123, applicationUid: 10123, selinuxType: 'untrusted_app_32', api: 35,
  abi: 'x86_64', mainWebRtcInitialized: true, qemuDefaultIpv4Present: false, configuredGuestIpv4Present: true },
  qemuForwarding: {mode: 'qemu-hmp-slirp', backendType: 'user', monitorVerified: true, capabilitiesVerified: true,
    backendVerified: true, wifiNicVerified: true, closed: true, connected: false, pendingMappings: 0, unconfirmedMappings: 0, failures: 0},
  apkSha256: 'a'.repeat(64), testApkSha256: 'b'.repeat(64),
  sourceCommit: 'd'.repeat(40), nat: { peerGenerationsCreated: 2, mappingsCreated: 2, activeMappings: 0,
    toGuestDatagrams: 123, fromGuestDatagrams: 456, redirectCommandsAttempted: 2, redirectCommandsSucceeded: 2, redirectCommandsRemoved: 2,
    linkLocalCandidateGenerations: 2, observedLinkLocalHostCandidates: 2 },
  libraries: Object.fromEntries(['libdatachannel.so', 'libtiplay_rtc_audio.so', 'libjingle_peerconnection_so.so']
    .map(name => [name, { sha256: 'c'.repeat(64), bytes: 123 }])), finishedNormally: true };
const child = { proof: structuredClone(base), exitCode: 0 };
const validate = new Function('assert', 'child', 'runtimeBackend', body + '; return verifiedAndroidProof;')(assert, child, 'android');
assert.equal(validate(true), child.proof);
for (const alter of [
  value => { value.runtime.uid = 0; }, value => { value.runtime.uid = 2000; },
  value => { value.runtime.applicationUid++; }, value => { value.runtime.selinuxType = 'runas_app'; },
  value => { value.runtime.api = 34; }, value => { value.runtime.abi = 'arm64-v8a'; },
  value => { value.runtime.mainWebRtcInitialized = false; }, value => { delete value.testApkSha256; },
  value => { delete value.libraries['libdatachannel.so']; }, value => { value.finishedNormally = false; },
  value => { value.nat.activeMappings = 1; }, value => { value.nat.fromGuestDatagrams = 0; },
  value => { value.nat.redirectCommandsRemoved = 1; }, value => { delete value.sourceCommit; },
  value => { value.nat.linkLocalCandidateGenerations = 1; }, value => { value.nat.observedLinkLocalHostCandidates = 0; },
  value => { value.runtime.configuredGuestIpv4Present = false; }, value => { value.qemuForwarding.wifiNicVerified = false; },
  value => { value.qemuForwarding.pendingMappings = 1; }, value => { value.qemuForwarding.unconfirmedMappings = 1; },
  value => { value.qemuForwarding.failures = 1; }, value => { value.nat.redirectCommandsAttempted++; }
]) {
  child.proof = structuredClone(base); alter(child.proof); assert.throws(() => validate(true));
}
child.proof = structuredClone(base); child.exitCode = 1; assert.throws(() => validate(true));
child.exitCode = 0; child.proof.finishedNormally = false; assert.equal(validate(false), child.proof);
const host = new Function('assert', 'child', 'runtimeBackend', body + '; return verifiedAndroidProof;')(assert, {}, 'host');
assert.equal(host(true), null);
"""
        completed = subprocess.run(["node", "--input-type=module", "-e", script, str(HARNESS)],
                                   text=True, capture_output=True, timeout=10)
        self.assertEqual(0, completed.returncode, completed.stderr)

    def test_actual_finally_attempts_every_resource_and_retains_failure(self):
        script = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(process.argv[1], 'utf8');
const helperBody = source.slice(source.indexOf('async function closeHarnessResources('), source.indexOf('function injectedSdp('));
const build = new Function('child', 'command', 'assert', helperBody + '; return {closeHarnessResources, closeAndroidChild};');
const helper = build(null, null, assert).closeHarnessResources;
const tail = source.slice(source.lastIndexOf('} finally {') + '} finally {'.length).trim();
assert.equal(tail.endsWith('}'), true);
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const cleanup = new AsyncFunction('runtimeBackend', 'child', 'browser', 'blackhole', 'server',
  'closeHarnessResources', 'closeAndroidChild', 'persistReport', 'process', 'outcomeReport', tail.slice(0, -1) + '; return outcomeReport;');
for (const initial of [{ status: 'passed' }, { status: 'blocked', failureClass: 'OriginalFailure' }]) {
  const attempted = [], written = [], processState = {}, finalProof = { nat: { activeMappings: 2 } };
  const fail = name => { attempted.push(name); throw Error('private-error-that-must-not-reach-the-report'); };
  const child = { exitCode: null, close: () => { finalProof.nat.activeMappings = 1; return fail('child'); },
    get proof() { return structuredClone(finalProof); } };
  const closeChild = build(child, async kind => { assert.equal(kind, 'close'); attempted.push('close-rpc'); }, assert).closeAndroidChild;
  const result = await cleanup('android', child, { close: () => fail('browser') },
    { close: () => fail('blackhole') }, { close: callback => { attempted.push('server'); callback(); } },
    helper, closeChild, value => written.push(value), processState, initial);
  assert.deepEqual(attempted, ['close-rpc', 'child', 'browser', 'blackhole', 'server']);
  assert.equal(processState.exitCode, 1); assert.equal(written.length, 1);
  assert.equal(result.status, initial.status === 'passed' ? 'failed' : 'blocked');
  assert.equal(result.failureClass, initial.failureClass);
  assert.equal(result.androidRuntimeProof.nat.activeMappings, 1, 'Persist the post-cleanup residue, not the earlier snapshot.');
  assert.deepEqual(result.cleanupFailures, [{stage: 'child', exception: 'AggregateError'},
    {stage: 'browser', exception: 'Error'}, {stage: 'blackhole', exception: 'Error'}]);
  assert.equal(JSON.stringify(result).includes('private-error'), false);
}
const attempted = [], processState = {}, written = [];
const result = await cleanup('host', { kill: () => attempted.push('child') }, { close: () => attempted.push('browser') },
  null, { close: callback => { attempted.push('server'); callback(); } }, helper, null, value => written.push(value), processState,
  { status: 'passed' });
assert.deepEqual(attempted, ['child', 'browser', 'server']); assert.equal(result.status, 'passed');
assert.equal(processState.exitCode, undefined); assert.equal(written.length, 1);
const order = [], closedProof = {finishedNormally: false};
const android = {exitCode: null, close: async () => { order.push('backend'); closedProof.finishedNormally = true; },
  get proof() { return closedProof; }};
const closeChild = build(android, async () => { order.push('rpc'); throw Error('close-rpc-failed'); }, assert).closeAndroidChild;
const failedProcess = {}, failedReport = [];
const failed = await cleanup('android', android, null, null, {close: callback => callback()}, helper, closeChild,
  value => failedReport.push(value), failedProcess, {status: 'failed', failureClass: 'OriginalMediaTimeout'});
assert.deepEqual(order, ['rpc', 'backend']); assert.equal(failedProcess.exitCode, 1);
assert.equal(failed.failureClass, 'OriginalMediaTimeout'); assert.equal(failed.androidRuntimeProof.finishedNormally, true);
android.exitCode = 0; order.length = 0;
await build(android, async () => assert.fail('Do not repeat a successful close RPC.'), assert).closeAndroidChild();
assert.deepEqual(order, ['backend']);
const initializationProof = {qemuForwarding: {closed: true, backendVerified: false, commandsSent: 2}};
const startup = await cleanup('android', null, null, null, {close: callback => callback()}, helper,
  build(null, null, assert).closeAndroidChild, () => {}, {},
  {status: 'failed', failureClass: 'QemuUdpForwardingError', androidRuntimeProof: initializationProof});
assert.equal(startup.androidRuntimeProof, initializationProof, 'Keep the post-cleanup startup error evidence when no backend was returned.');
"""
        completed = subprocess.run(["node", "--input-type=module", "-e", script, str(HARNESS)],
                                   text=True, capture_output=True, timeout=10)
        self.assertEqual(0, completed.returncode, completed.stderr)

    def test_udp_fixture_collects_guest_result_before_accepting_or_failing(self):
        script = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(process.argv[1], 'utf8');
const body = source.slice(source.indexOf('async function collectAndroidUdpFixture('), source.indexOf('function injectedSdp('));
const {collectAndroidUdpFixture: collect, verifyAndroidUdpFixture: verify} = new Function('assert', body
  + '; return {collectAndroidUdpFixture, verifyAndroidUdpFixture};')(assert);
const host = {nonceMatched: true, timedOut: false, attempts: 1, sentDatagrams: 1, receivedDatagrams: 1,
  errors: 0, cleanupComplete: true, counters: {redirectCommandsAttempted: 1, redirectCommandsSucceeded: 1}};
const guest = {receivedDatagrams: 1, echoedDatagrams: 1, errors: 0, closed: true, workerTerminated: true};
for (const mode of ['success', 'timeout', 'throw']) {
  const order = [], failure = Error('private-endpoint-message');
  const backend = {probeUdpFixture: async port => {
    order.push('host'); assert.equal(port, 12345);
    if (mode === 'throw') throw failure;
    return mode === 'success' ? structuredClone(host) : {...host, nonceMatched: false, timedOut: true, receivedDatagrams: 0};
  }, proof: {udpFixture: {...host, nonceMatched: false, cleanupComplete: false}}};
  const result = await collect(async kind => {
    order.push(kind); return kind === 'udp-probe-start' ? {port: 12345} : {udpProbe: structuredClone(guest)};
  }, backend);
  assert.deepEqual(order, ['udp-probe-start', 'host', 'udp-probe-result']);
  assert.deepEqual(result.fixture.guest, guest);
  if (mode === 'success') { verify(result.fixture); assert.equal(result.fixture.passed, true); }
  else { assert.throws(() => verify(result.fixture)); assert.equal(result.fixture.passed, false); }
  if (mode === 'throw') assert.equal(result.error, failure);
  assert.equal(JSON.stringify(result.fixture).includes('private-endpoint'), false);
  assert.equal(JSON.stringify(result.fixture).includes('12345'), false);
}
const result = await collect(async kind => {
  if (kind === 'udp-probe-result') throw Error('result-failed'); return {port: 12345};
}, {probeUdpFixture: async () => structuredClone(host)});
assert.equal(result.fixture.guest, null); assert.equal(result.fixture.guestResultFailureClass, 'Error');
assert.throws(() => verify(result.fixture));
assert.ok(source.indexOf('await collectAndroidUdpFixture(command, child)') < source.indexOf('browser = await chromium.launch'));
"""
        completed = subprocess.run(["node", "--input-type=module", "-e", script, str(HARNESS)],
                                   text=True, capture_output=True, timeout=10)
        self.assertEqual(0, completed.returncode, completed.stderr)

    def test_android_fixture_and_producer_verify_the_actual_link_local_policy(self):
        source = WORKFLOW.read_text()
        native = source.split("  native:\n", 1)[1].split("  host-interop:\n", 1)[0]
        android = source.split("  android-interop:\n", 1)[1].split("  symbols:\n", 1)[0]
        self.assertIn("python3 tests/native/test_rtc_audio_source_patches.py", native)
        self.assertIn("python3 tests/native/test_rtc_audio_address_policy.py", native)
        self.assertIn('--source-dir "$RUNNER_TEMP/tiplay-rtc-audio/src/libdatachannel/deps/libjuice"', native)
        self.assertLess(android.index("python3 scripts/rtc-audio/build.py --verify"), android.index(":mobile:assembleDebug"))
        self.assertIn('shell getprop ro.kernel.qemu', android)
        self.assertIn('shell id -u', android)
        self.assertIn('shell ip -o -4 addr show up scope global', android)
        self.assertIn('shell ip addr add 169.254.111.111/32 dev "$task_interface"', android)
        self.assertNotIn('setenforce', android)
        self.assertNotIn('bindProcessToNetwork', android)

    def test_fixture_parser_uses_actual_ipv4_records_in_both_ip_formats(self):
        path = ROOT / "tests/native/android_fixture_interface.py"
        spec = importlib.util.spec_from_file_location("fixture_interface", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cases = [
            ("2: eth0    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0\n", "eth0"),
            ("2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n"
             "    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0\n", "eth0"),
            ("2: eth0@if7 inet 10.0.2.15/24 scope global eth0\r\n", "eth0"),
            ("2: eth0: <BROADCAST,UP> mtu 1500\n", ""),
            ("2: eth0: <BROADCAST> mtu 1500\n    inet 10.0.2.15/24 scope global eth0\n", ""),
            ("2: eth0 inet 169.254.111.111/32 scope global eth0\n", ""),
            ("1: lo inet 127.0.0.1/8 scope host lo\n", ""),
            ("2: eth0 inet 0.0.0.0/0 scope global eth0\n", ""),
            ("2: eth0 inet 239.1.1.1/32 scope global eth0\n", ""),
            ("2: eth0 inet 999.0.0.1/24 scope global eth0\n", ""),
            ("2: private/name inet 10.0.2.15/24 scope global eth0\n", ""),
            ("    inet 10.0.2.15/24 scope global eth0\n", ""),
        ]
        for text, expected in cases:
            with self.subTest(expected=expected):
                interface, summary = module.inspect_interfaces(text)
                self.assertEqual(expected, interface)
                self.assertEqual(bool(expected), summary["interfaceSelected"])
                rendered = str(summary)
                for address in ["10.0.2.15", "169.254.111.111", "127.0.0.1", "private/name"]:
                    self.assertNotIn(address, rendered)
        android = WORKFLOW.read_text().split("  android-interop:\n", 1)[1].split("  symbols:\n", 1)[0]
        self.assertIn("task_network_deadline=$((SECONDS + 60))", android)
        self.assertIn("timeout 5", android)
        self.assertIn("python3 tests/native/android_fixture_interface.py", android)
        self.assertIn('android_fixture_interface.py --require-interface "$task_interface" --summary', android)

    def test_explicit_wifi_selection_never_defaults_to_an_address_or_first_interface(self):
        path = ROOT / "tests/native/android_fixture_interface.py"
        spec = importlib.util.spec_from_file_location("fixture_interface", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        text = "2: eth0 inet 10.0.2.15/24 scope global eth0\n3: wlan0 inet 10.0.2.16/24 scope global wlan0\n"
        self.assertEqual("", module.inspect_interfaces(text)[0], "Multiple ordinary interfaces are ambiguous.")
        self.assertEqual("10.0.2.16", module.inspect_interfaces(text, "wlan0", True)[0])
        self.assertEqual("wlan0", module.inspect_interfaces(text, "wlan0")[0])
        self.assertEqual("", module.inspect_interfaces(text, "unknown", True)[0])
        ambiguous = text + "3: wlan0 inet 10.0.2.17/24 scope global wlan0\n"
        value, summary = module.inspect_interfaces(ambiguous, "wlan0", True)
        self.assertEqual("", value); self.assertTrue(summary["ambiguous"])
        self.assertNotIn("10.0.2.", str(summary))
        self.assertEqual("", module.inspect_interfaces("3: wlan0: <BROADCAST> mtu 1500\n    inet 10.0.2.16/24\n", "wlan0", True)[0])
        source = WORKFLOW.read_text().split("  android-interop:\n", 1)[1].split("  symbols:\n", 1)[0]
        self.assertIn("-feature -WiFiPacketStream", source)
        self.assertIn('-qemu -monitor "unix:$task_hmp_socket,server,nowait"', source)
        self.assertIn("TIPLAY_QEMU_NETDEV_ID=virtio-wifi", source)
        self.assertIn("task_interface='wlan0'", source)
        self.assertIn("/sys/class/net/wlan0/phy80211", source)
        self.assertIn("printf '::add-mask::%s", source)
        self.assertIn("node --test tests/native/qemu-udp-forwarding.test.mjs", source)

    def test_no_machine_policy_or_browser_ice_policy_override(self):
        source = WORKFLOW.read_text() + HARNESS.read_text()
        for override in ["WebRtcIPHandling", "force-webrtc-ip-handling-policy", "policies/managed",
                         "disable-features=WebRtcHideLocalIpsWithMdns"]:
            self.assertNotIn(override, source)
        self.assertIn("status: blocked ? 'blocked' : 'failed'", source)
        self.assertIn("process.exitCode = 1", source)
        self.assertIn("firstPeerPeak > .001", source)
        self.assertIn("result.peak > .001", source)
        self.assertIn("if (encodedTapEnabled) args[0] = { ...args[0], encodedInsertableStreams: true }", source)

    def test_workflow_uses_only_valid_job_environment_contexts(self):
        path = ROOT / "tests/native/test_proof_workflow_contexts.py"
        spec = importlib.util.spec_from_file_location("proof_contexts", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.validate_job_env_contexts(WORKFLOW.read_text())


if __name__ == "__main__":
    unittest.main()
