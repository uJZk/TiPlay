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
        self.assertIn("runtimeBackend === 'android' ? child?.close()", source)
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
  abi: 'x86_64', mainWebRtcInitialized: true }, apkSha256: 'a'.repeat(64), testApkSha256: 'b'.repeat(64),
  sourceCommit: 'd'.repeat(40), nat: { peerGenerationsCreated: 2, mappingsCreated: 2, activeMappings: 0,
    toGuestDatagrams: 123, fromGuestDatagrams: 456, redirectCommandsSucceeded: 2, redirectCommandsRemoved: 2,
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
  value => { value.nat.linkLocalCandidateGenerations = 1; }, value => { value.nat.observedLinkLocalHostCandidates = 0; }
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
const helper = new Function(helperBody + '; return closeHarnessResources;')();
const tail = source.slice(source.lastIndexOf('} finally {') + '} finally {'.length).trim();
assert.equal(tail.endsWith('}'), true);
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const cleanup = new AsyncFunction('runtimeBackend', 'child', 'browser', 'blackhole', 'server',
  'closeHarnessResources', 'persistReport', 'process', 'outcomeReport', tail.slice(0, -1) + '; return outcomeReport;');
for (const initial of [{ status: 'passed' }, { status: 'blocked', failureClass: 'OriginalFailure' }]) {
  const attempted = [], written = [], processState = {}, finalProof = { nat: { activeMappings: 2 } };
  const fail = name => { attempted.push(name); throw Error('private-error-that-must-not-reach-the-report'); };
  const result = await cleanup('android', { close: () => { finalProof.nat.activeMappings = 1; return fail('child'); },
    get proof() { return structuredClone(finalProof); } }, { close: () => fail('browser') },
    { close: () => fail('blackhole') }, { close: callback => { attempted.push('server'); callback(); } },
    helper, value => written.push(value), processState, initial);
  assert.deepEqual(attempted, ['child', 'browser', 'blackhole', 'server']);
  assert.equal(processState.exitCode, 1); assert.equal(written.length, 1);
  assert.equal(result.status, initial.status === 'passed' ? 'failed' : 'blocked');
  assert.equal(result.failureClass, initial.failureClass);
  assert.equal(result.androidRuntimeProof.nat.activeMappings, 1, 'Persist the post-cleanup residue, not the earlier snapshot.');
  assert.deepEqual(result.cleanupFailures, ['child', 'browser', 'blackhole'].map(stage => ({ stage, exception: 'Error' })));
  assert.equal(JSON.stringify(result).includes('private-error'), false);
}
const attempted = [], processState = {}, written = [];
const result = await cleanup('host', { kill: () => attempted.push('child') }, { close: () => attempted.push('browser') },
  null, { close: callback => { attempted.push('server'); callback(); } }, helper, value => written.push(value), processState,
  { status: 'passed' });
assert.deepEqual(attempted, ['child', 'browser', 'server']); assert.equal(result.status, 'passed');
assert.equal(processState.exitCode, undefined); assert.equal(written.length, 1);
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
