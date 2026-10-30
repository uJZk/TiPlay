#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Build/run the actual Android AAR compressed-video loopback probe on an ADB device."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import zipfile

REPO = Path(__file__).resolve().parents[2]
PRODUCT_PREFIXES = (
    "com/shilapi/xcertplay/web/BrowserRtcVideoTrack",
    "com/shilapi/xcertplay/web/BrowserRtcVideoSourceProcessor",
    "com/shilapi/xcertplay/web/BrowserRtcVideoPolicy",
    "com/shilapi/xcertplay/web/WebVideoRecord",
    "com/shilapi/xcertplay/web/WebJson",
    "com/shilapi/xcertplay/diagnostics/RawTraffic$Reference",
)
DEVICE_DIR = "/data/local/tmp/tiplay-native-probe"
NATIVE_EVENT_PREFIX = "TIPLAY_RTC_SOURCE_RATE "
NATIVE_SOURCE_REVISION = "73cb8180f7258ee292878d6edd05177f41883962"


def run(command, **kwargs):
    subprocess.run([str(part) for part in command], check=True, **kwargs)


def newest(paths):
    paths = list(paths)
    if not paths:
        raise SystemExit("Required build input is missing; see tests/native/README.md")
    return max(paths, key=lambda path: tuple(int(n) for n in re.findall(r"\d+", str(path))))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scenario_label(args):
    return f"{args.mode}-{args.start_bitrate}-{args.encoder_delay}" + ("-source-rate" if args.source_rate else "")


def rate_windows(samples):
    """Use one active RTP stream and phase per interval; never mix retired SSRCs."""
    previous = {}
    identities = {}
    windows = []
    for sample in samples:
        required = ("phase", "senderId", "statsId", "ssrc", "statsTimestampUs", "sampleMonotonicNanos",
                    "bytesSent", "packetsSent", "sourceBytes", "sourceFrames")
        if any(sample.get(name) is None for name in required):
            raise ValueError("Required active RTP rate sample fields are missing")
        key = (sample.get("phase"), sample.get("senderId"), sample.get("statsId"), sample.get("ssrc"))
        phase = (key[0], key[1])
        if phase in identities and identities[phase] != key[2:]:
            raise ValueError("Active RTP identity changed within one phase")
        identities[phase] = key[2:]
        old = previous.get(key)
        previous[key] = sample
        if old is None:
            continue
        elapsed = (sample["statsTimestampUs"] - old["statsTimestampUs"]) / 1_000_000
        source_elapsed = (sample["sampleMonotonicNanos"] - old["sampleMonotonicNanos"]) / 1_000_000_000
        if elapsed <= 0 or source_elapsed <= 0:
            raise ValueError("Active RTP statistics timestamps did not advance")
        window = {"phase": key[0], "senderId": key[1], "statsId": key[2], "ssrc": key[3],
                  "elapsedSeconds": elapsed, "sourceSampleElapsedSeconds": source_elapsed}
        for name in ("bytesSent", "headerBytesSent", "retransmittedBytesSent", "packetsSent", "sourceBytes", "sourceFrames"):
            if name in sample and name in old:
                delta = sample[name] - old[name]
                if delta < 0:
                    raise ValueError("Active RTP counter reset within one phase: " + name)
                window[name + "Delta"] = delta
        if "bytesSentDelta" in window:
            window["rtpPayloadBitsPerSecond"] = 8 * window["bytesSentDelta"] / elapsed
        if "retransmittedBytesSentDelta" in window and "bytesSentDelta" in window:
            window["rtpPayloadExcludingRetransmissionBitsPerSecond"] = 8 * (
                window["bytesSentDelta"] - window["retransmittedBytesSentDelta"]) / elapsed
        if "sourceBytesDelta" in window:
            window["sourceInputBitsPerSecond"] = 8 * window["sourceBytesDelta"] / source_elapsed
        windows.append(window)
    return windows


def describe_rate_control_evidence(result, args, log_text):
    requested = "source-rate" if args.source_rate else "adaptive"
    if result.get("requestedRateControlMode") != requested:
        raise ValueError("Probe requested mode does not match the driver")
    if args.source_rate and "START_BITRATE" in log_text:
        raise ValueError("Source-rate request included explicit bitrate settings")
    if result.get("nativeRateControlVerified") is True:
        raise ValueError("This observation-only probe cannot verify native rate-control activation")
    result["nativeRateControlVerified"] = False
    result["rateControlEvidence"] = {
        "scope": "requested-mode-and-stream-observation-only",
        "customAarProvenancePresent": bool(result.get("build", {}).get("webrtcAarProvenance")),
        "nativeActivationEvidence": False,
        "controlledFeedbackComparison": False,
    }


def parse_native_rate_events(text):
    schemas = {
        "controller_skipped": {"v", "event", "transport"},
        "stream_attached": {"v", "event", "transport", "ssrc", "rtx_limiter"},
        "pacer_dispatch": {"v", "event", "transport", "ssrc"},
        "encoder_gate": {"v", "event", "transport", "ssrc", "network", "stream", "allow"},
    }
    events = []
    for line in text.splitlines():
        if NATIVE_EVENT_PREFIX not in line:
            continue
        event = json.loads(line.split(NATIVE_EVENT_PREFIX, 1)[1].strip())
        if (not isinstance(event, dict) or type(event.get("v")) is not int or event.get("v") != 1
                or not isinstance(event.get("event"), str) or set(event) != schemas.get(event.get("event"))):
            raise ValueError("Unsupported native source-rate diagnostic schema")
        if type(event.get("transport")) is not int or event["transport"] <= 0:
            raise ValueError("Native diagnostic transport identity must be nonzero")
        if "ssrc" in event and (type(event["ssrc"]) is not int or not 0 < event["ssrc"] <= 0xffffffff):
            raise ValueError("Native diagnostic SSRC is invalid or zero")
        if "rtx_limiter" in event and type(event["rtx_limiter"]) is not bool:
            raise ValueError("Native RTX limiter diagnostic must be Boolean")
        if event["event"] == "encoder_gate":
            if any(type(event[k]) is not int or event[k] not in (0, 1) for k in ("network", "stream", "allow")):
                raise ValueError("Native encoder gate state is invalid")
            if event["allow"] != (event["network"] & event["stream"]):
                raise ValueError("Native encoder gate result contradicts its state")
        events.append(event)
        if len(events) > 4096:
            raise ValueError("Native diagnostics exceeded the bounded event count")
    return events


def matching_native_provenance(build, patch_hash):
    provenance = build.get("webrtcAarProvenance")
    return (isinstance(provenance, dict) and bool(build.get("webrtcAarSha256"))
            and provenance.get("aar_sha256") == build["webrtcAarSha256"]
            and provenance.get("patch_sha256") == patch_hash
            and provenance.get("revision") == NATIVE_SOURCE_REVISION)


def native_structural_activation(result, events, patch_hash):
    evidence = {"verified": False, "scope": "native-branch-events-correlated-by-measured-ssrc",
                "peerBindingVerified": False,
                "associationLimit": "ssrc-and-process-local-transport-only",
                "identifiersLinkableWithinRun": True,
                "allRateControlPathsVerified": False, "streams": [], "reasons": []}
    reasons = evidence["reasons"]
    if result.get("requestedRateControlMode") != "source-rate":
        reasons.append("source-mode-not-requested" if not events else "unexpected-source-events-in-adaptive-mode")
        return evidence
    if not matching_native_provenance(result.get("build", {}), patch_hash):
        reasons.append("custom-aar-provenance-missing-or-mismatched")
    observations = result.get("generationProofs", [])
    if result.get("mode") in ("bundle", "bundle-video-anchor") and len(observations) != 3:
        reasons.append("generation-observations-missing")
    senders = [item.get("senderStatsFinal", {}) for item in observations]
    senders.append(result.get("senderStats", result.get("sender", {})))
    ssrcs = []
    for sender in senders:
        ssrc = sender.get("ssrc")
        if type(ssrc) is not int or not 0 < ssrc <= 0xffffffff:
            reasons.append("measured-sender-ssrc-missing-or-invalid")
        elif ssrc in ssrcs:
            reasons.append("ambiguous-reused-sender-ssrc")
        else:
            ssrcs.append(ssrc)
    for ssrc in ssrcs:
        attachment_events = [e for e in events if e["event"] == "stream_attached" and e["ssrc"] == ssrc]
        # CreateRtpVideoSender emits on each actual stream construction. SetCodec
        # can recreate a stream under the same transport/SSRC before any frame.
        # Collapse only identical structural observations, never conflicting IDs
        # or limiter choices; retain the raw events and count as separate evidence.
        attached = list({json.dumps(e, sort_keys=True): e for e in attachment_events}.values())
        if len(attached) != 1:
            reasons.append("stream-attachment-missing-or-ambiguous:" + str(ssrc))
            continue
        transport = attached[0]["transport"]
        linked = [e for e in events if e["transport"] == transport]
        controller = [e for e in linked if e["event"] == "controller_skipped"]
        pacer = [e for e in linked if e["event"] == "pacer_dispatch" and e["ssrc"] == ssrc]
        gate_events = [e for e in events if e["event"] == "encoder_gate" and e["ssrc"] == ssrc]
        # A recreated encoder owns a fresh once-per-state mask. These IDs do not
        # distinguish encoder objects, so verify only unique structural states.
        gates = list({json.dumps(e, sort_keys=True): e for e in gate_events}.values())
        allowed = [e for e in gates if e["network"] == e["stream"] == e["allow"] == 1]
        unique_gate_states = {(e["network"], e["stream"]) for e in gates}
        if (attached[0]["rtx_limiter"] is not False or len(controller) != 1 or len(pacer) != 1
                or not allowed or len(unique_gate_states) != len(gates)
                or any(e["transport"] != transport or e["allow"] != (e["network"] & e["stream"]) for e in gates)):
            reasons.append("required-native-branches-missing-or-conflicting:" + str(ssrc))
        evidence["streams"].append({"ssrc": ssrc, "transport": transport,
                                    "attachmentEventCount": len(attachment_events),
                                    "repeatedIdenticalAttachmentObservations": len(attachment_events) - 1,
                                    "attachmentInstanceIdentityVerified": False,
                                    "gateEventCount": len(gate_events),
                                    "uniqueGateObservationCount": len(gates),
                                    "repeatedIdenticalGateObservations": len(gate_events) - len(gates),
                                    "gateInstanceIdentityVerified": False,
                                    "controllerSkipObserved": len(controller) == 1,
                                    "pacerDispatchObserved": len(pacer) == 1,
                                    "encoderAllowObserved": bool(allowed),
                                    "networkBlockedCheckObserved": any(e["network"] == 0 and e["allow"] == 0 for e in gates),
                                    "networkResumeCycleVerified": False})
    evidence["verified"] = bool(ssrcs) and not reasons
    return evidence


def validate_rtp_phase(before, after, direction, frames):
    for identity in ("statsId", "ssrc"):
        if before.get(identity) is None or before[identity] != after.get(identity):
            raise ValueError("Active RTP identity missing or changed: " + identity)
    if before.get("statsTimestampUs") is None or after.get("statsTimestampUs") is None or after["statsTimestampUs"] <= before["statsTimestampUs"]:
        raise ValueError("Active RTP phase timestamp missing or did not advance")
    suffix = "Sent" if direction == "sender" else "Received"
    for field in ("frames" + suffix, "bytes" + suffix, "packets" + suffix):
        if field not in before or field not in after:
            raise ValueError("Required RTP phase counter is missing: " + field)
        delta = after[field] - before[field]
        if (field.startswith("frames") and delta != frames) or (not field.startswith("frames") and delta <= 0):
            raise ValueError("RTP phase counter did not match input: " + field)


def control_phase_observations(samples):
    phases = {}
    for sample in samples:
        if sample.get("phase") is None or sample.get("rttNanos", -1) < 0:
            raise ValueError("Control echo phase or RTT is missing")
        phase = phases.setdefault(sample["phase"], {"echoes": 0, "heartbeats": 0, "maximumObservedRttNanos": 0})
        phase["echoes"] += 1
        phase["heartbeats"] += int(sample.get("stage") == "heartbeat")
        phase["maximumObservedRttNanos"] = max(phase["maximumObservedRttNanos"], sample["rttNanos"])
    return phases


def validate_final_rate_observations(result, args):
    phase = "generation-3-measured" if args.mode in ("bundle", "bundle-video-anchor") else "measured"
    windows = [window for window in result["rateWindows"] if window["phase"] == phase]
    if (not any(w.get("sourceFramesDelta", 0) > 0 and w.get("sourceBytesDelta", 0) > 0 and w.get("bytesSentDelta", 0) > 0 for w in windows)
            or sum(w.get("sourceFramesDelta", 0) for w in windows) != args.frames
            or sum(w.get("sourceBytesDelta", 0) for w in windows) != result["sourceBytes"]):
        raise ValueError("Final-phase rate observations are missing or do not cover the measured source input")
    return phase


def build(args):
    sdk = args.android_sdk
    caches = args.gradle_home / "caches/modules-2/files-2.1"
    aar = args.webrtc_aar or newest((caches / "io.github.webrtc-sdk/android/150.7871.01").glob("*/*.aar"))
    stdlib = args.kotlin_stdlib or newest((caches / "org.jetbrains.kotlin/kotlin-stdlib").glob("*/*/*.jar"))
    android_jar = newest(sdk.glob("platforms/*/android.jar"))
    d8 = newest(sdk.glob("build-tools/*/d8"))
    classes = args.product_classes or REPO / "shared/build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes"
    if not classes.is_dir():
        raise SystemExit("Compile the shared debug Kotlin classes first; see tests/native/README.md")
    work = args.work_dir
    work.mkdir(parents=True, exist_ok=True)
    classes_out = work / "classes"
    classes_out.mkdir(exist_ok=True)
    dex_out = work / "dex"
    dex_out.mkdir(exist_ok=True)
    with zipfile.ZipFile(aar) as archive:
        (work / "webrtc.jar").write_bytes(archive.read("classes.jar"))
        (work / "libjingle_peerconnection_so.so").write_bytes(archive.read(f"jni/{args.abi}/libjingle_peerconnection_so.so"))
    classpath = os.pathsep.join(map(str, (classes, work / "webrtc.jar", stdlib, android_jar)))
    run([args.java_home / "bin/javac", "-source", "8", "-target", "8", "-cp", classpath,
         "-d", classes_out, REPO / "tests/native/NativeVideoProbe.java"])
    with zipfile.ZipFile(work / "product.jar", "w") as archive:
        for path in classes.rglob("*.class"):
            name = path.relative_to(classes).as_posix()
            if name.startswith(PRODUCT_PREFIXES):
                archive.write(path, name)
    with zipfile.ZipFile(work / "probe-classes.jar", "w") as archive:
        for path in classes_out.rglob("*.class"):
            archive.write(path, path.relative_to(classes_out).as_posix())
    with (work / "d8.log").open("w") as output:
        run([d8, "--min-api", "28", "--lib", android_jar, "--output", dex_out,
             work / "probe-classes.jar", work / "product.jar", work / "webrtc.jar", stdlib],
            stdout=output, stderr=subprocess.STDOUT)
    with zipfile.ZipFile(work / "probe.jar", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in dex_out.glob("classes*.dex"):
            archive.write(path, path.name)
    fixture = work / "fixture.h264"
    if args.fixture:
        fixture.write_bytes(args.fixture.read_bytes())
    elif not fixture.exists():
        # Offline synthetic test input. The probe itself forwards these bytes without encoding.
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
             "testsrc2=size=1568x1080:rate=60", "-frames:v", "180", "-an", "-c:v", "libx264",
             "-preset", "ultrafast", "-profile:v", "high", "-level:v", "4.2", "-bf", "0",
             "-b:v", "10M", "-minrate", "10M", "-maxrate", "10M", "-bufsize", "10M",
             "-x264-params", "aud=1:repeat-headers=1:keyint=60:min-keyint=60:scenecut=0:nal-hrd=cbr",
             "-f", "h264", fixture])
    report = {"webrtcVersion": "150.7871.01", "webrtcAarSha256": sha256(aar),
              "fixtureSha256": sha256(fixture), "productClassesSha256": sha256(work / "product.jar"),
              "probeSha256": sha256(work / "probe.jar"), "abi": args.abi}
    provenance = aar.with_suffix(".provenance.json")
    if provenance.is_file():
        report["webrtcAarProvenance"] = json.loads(provenance.read_text())
        if report["webrtcAarProvenance"].get("aar_sha256") != report["webrtcAarSha256"]:
            raise SystemExit("Custom AAR provenance hash does not match the selected AAR")
    (work / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


def verify_queue_epoch_proof(value):
    """Validate only SDP/sender epoch evidence, not recovery or picture quality."""
    if not isinstance(value, list) or len(value) != 7:
        raise ValueError("Queue epoch proof needs an initial sender and three replacements")
    observed = set()
    previous = None
    for i, item in enumerate(value):
        if not isinstance(item, dict) or type(item.get("epoch")) is not int or item.get("failureEpoch") != 0:
            raise ValueError("Malformed or failed queue epoch status")
        if i % 2 == 0:
            expected = "initial-before-first-frame" if i == 0 else f"replacement-{i // 2 - 1}"
            epoch = item["epoch"]
            if item.get("stage") != expected or epoch <= 0 or epoch in observed:
                raise ValueError("Missing, out-of-order or reused queue epoch")
            observed.add(epoch)
            previous = epoch
        else:
            if item.get("stage") != f"retired-{i // 2}" or item["epoch"] != 0 or item.get("retiredEpoch") != previous:
                raise ValueError("Wrong or non-retired sender epoch")


def execute(args):
    work = args.work_dir
    build_record = json.loads((work / "build.json").read_text())
    patch_hash = sha256(REPO / "scripts/webrtc/source-rate-video.patch")
    if args.expect_native_activation and not matching_native_provenance(build_record, patch_hash):
        raise SystemExit("Native activation assertions require the matching custom AAR and source patch provenance")
    adb = [args.android_sdk / "platform-tools/adb", "-P", str(args.adb_port)]
    if args.serial:
        adb += ["-s", args.serial]
    run(adb + ["shell", "mkdir", "-p", DEVICE_DIR])
    run(adb + ["push", work / "probe.jar", work / "fixture.h264", work / "libjingle_peerconnection_so.so", DEVICE_DIR + "/"])
    label = scenario_label(args)
    command = f"CLASSPATH={shlex.quote(DEVICE_DIR + '/probe.jar')} app_process /system/bin "
    command += "com.shilapi.xcertplay.web.NativeVideoProbe "
    command += " ".join(map(shlex.quote, (args.mode, str(args.start_bitrate), str(args.encoder_delay), str(args.frames), "warm", "verbose" if args.native_verbose else "info", "source-rate" if args.source_rate else "adaptive", "queue-epoch" if args.expect_queue_epoch else "no-queue-epoch")))
    log = work / (label + ".log")
    with log.open("w") as output:
        run(adb + ["shell", command], stdout=output, stderr=subprocess.STDOUT)
    prefix = "BOOTSTRAP_RESULT " if args.mode == "bootstrap" else "RESULT_JSON "
    lines = [line[len(prefix):] for line in log.read_text().splitlines() if line.startswith(prefix)]
    if len(lines) != 1:
        raise SystemExit(f"Probe did not produce one final result; inspect {log}")
    result = json.loads(lines[0])
    result["nativeSetBitrateAccepted"] = "START_BITRATE true" in log.read_text() if args.start_bitrate > 0 else None
    result["build"] = build_record
    result["rateWindows"] = rate_windows(result.get("rateSamples", []))
    describe_rate_control_evidence(result, args, log.read_text())
    result["controlPhaseObservations"] = control_phase_observations(result.get("controlEchoSamples", []))
    run(adb + ["pull", DEVICE_DIR + f"/native-{label}.log", work / ("native-" + label + ".log")])
    native_events = parse_native_rate_events((work / ("native-" + label + ".log")).read_text())
    result["nativeSourceRateEvents"] = native_events
    result["nativeStructuralActivation"] = native_structural_activation(result, native_events, patch_hash)
    (work / (label + ".json")).write_text(json.dumps(result, indent=2) + "\n")
    for name in ("offer.sdp", "answer.sdp"):
        run(adb + ["pull", DEVICE_DIR + "/" + name, work / name])
    if args.mode in ("bundle", "bundle-video-anchor"):
        for name in (f"bundle-{kind}-{i}.sdp" for i in range(3) for kind in ("offer", "answer")):
            run(adb + ["pull", DEVICE_DIR + "/" + name, work / name])
        if args.mode == "bundle":
            run(adb + ["pull", DEVICE_DIR + "/pending-data-offer.sdp", work / "pending-data-offer.sdp"])
    print(json.dumps(result, indent=2))
    if args.expect_queue_epoch:
        try:
            verify_queue_epoch_proof(result.get("queueEpochProof"))
        except ValueError as error:
            raise SystemExit(f"Queue epoch evidence failed: {error}") from error
    if args.expect_native_activation and not result["nativeStructuralActivation"]["verified"]:
        raise SystemExit("Native branch activation was not established; inspect nativeStructuralActivation reasons")
    if args.expect_continuous and not args.source_rate and native_events:
        raise SystemExit("Adaptive comparison unexpectedly emitted source-rate branch events")
    if args.expect_bootstrap:
        profile = result["sourceProfile"]
        diagnostics = result["diagnostics"]
        checks = (result["failure"] is None,
                  diagnostics["source"] == "avc1." + profile,
                  diagnostics["negotiated"]["profileLevelId"] == profile,
                  diagnostics["current"]["profileLevelId"] == profile,
                  diagnostics["selection"] == "ready",
                  result["flow"]["outputFrames"] > 0,
                  result["receiver"].get("framesReceived", 0) > 0,
                  result["acceptedRequests"] > 0,
                  result["outputAccessUnitsOriginal"])
        if not all(checks):
            raise SystemExit("Sparse High-profile bootstrap assertions failed; inspect scenario JSON and logs")
    if args.expect_continuous:
        validate_rtp_phase(result["senderStatsBaseline"], result["senderStats"], "sender", args.frames)
        # The receiver delta is retained for compatibility; validate the original
        # baseline too so a retired SSRC cannot look like a successful zero base.
        validate_rtp_phase(result["receiverStatsBaseline"], result["receiverStats"], "receiver", args.frames)
        delta = result["delta"]
        checks = (delta["outputFrames"] == args.frames,
                  delta["releasedUnencodedFrames"] == 0,
                  delta["sourceAdaptationDrops"] == 0,
                  delta["lossEvents"] == 0,
                  result["nativeBlocked"] in (None, 0),
                  result["offeredSha256"] == result["encoderOutputSha256"],
                  result["receiverRtpDelta"].get("framesReceived") == args.frames)
        if not all(checks):
            raise SystemExit("Continuous native RTP assertions failed; inspect scenario JSON and logs")
        if args.source_rate and not (
                result.get("startBitrateBps") == 0 and result.get("minBitrateBps") is None and result.get("maxBitrateBps") is None
                and "TiPlay-SourceRateVideo/Enabled/" in result.get("senderFieldTrials", "")
                and "TiPlay-SourceRateVideo/" not in result.get("receiverFieldTrials", "")
                and result.get("sourceFrames") == args.frames and result.get("sourceBytes", 0) > 0
                and result.get("rateWindows")):
            raise SystemExit("Requested source-rate inputs/measurement assertions failed; native activation is not verified")
        final_phase = validate_final_rate_observations(result, args)
        if args.mode in ("bundle", "bundle-video-anchor"):
            negotiations = result["bundleNegotiations"]
            checks = (len(negotiations) == 4,
                      all(n["transportWideExtension"] and n["transportCcFeedback"] for n in negotiations),
                      result["dataChannelsOpen"],
                      result["controlEchoSendFailures"] == 0,
                      len(result.get("generationProofs", [])) == 3,
                      all(p["offeredFrames"] == p["outputFrames"] == p["receivedFrames"] for p in result.get("generationProofs", [])),
                      all(p.get("offeredSha256") and p["offeredSha256"] == p.get("encoderOutputSha256") for p in result.get("generationProofs", [])),
                      result.get("controlHeartbeatSent", 0) > 0,
                      result.get("controlHeartbeatSent") == result.get("controlHeartbeatCompleted"),
                      result.get("controlHeartbeatFailure") is None,
                      all(stage in result["controlRoundTrips"] for stage in ("initial", "replacement-0", "replacement-1", "replacement-2", "final")))
            if args.mode == "bundle":
                checks += (all(n["bundleTag"] == n["applicationMid"] for n in negotiations),)
            if not all(checks):
                raise SystemExit("BUNDLE/control continuity assertions failed; inspect scenario JSON and logs")
            for phase in ("generation-0", "generation-1", "generation-2", "replacement-0", "replacement-1", "replacement-2", final_phase):
                if result["controlPhaseObservations"].get(phase, {}).get("echoes", 0) == 0:
                    raise SystemExit("No timeout-level control availability observation for " + phase)
            for proof in result["generationProofs"]:
                validate_rtp_phase(proof["senderStatsBaseline"], proof["senderStatsFinal"], "sender", proof["offeredFrames"])
                validate_rtp_phase(proof["receiverStatsBaseline"], proof["receiverStatsFinal"], "receiver", proof["offeredFrames"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "run"))
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--android-sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", "/nonexistent")))
    parser.add_argument("--java-home", type=Path, default=Path(os.environ.get("JAVA_HOME", "/nonexistent")))
    parser.add_argument("--gradle-home", type=Path, default=Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle"))))
    parser.add_argument("--abi", choices=("x86_64", "x86", "arm64-v8a", "armeabi-v7a"), default="x86_64")
    parser.add_argument("--webrtc-aar", type=Path)
    parser.add_argument("--kotlin-stdlib", type=Path)
    parser.add_argument("--product-classes", type=Path)
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--adb-port", type=int, default=5037)
    parser.add_argument("--serial")
    parser.add_argument("--mode", choices=("paced", "serial", "burst", "bootstrap", "bundle", "bundle-video-anchor"), default="serial")
    parser.add_argument("--start-bitrate", type=int, help="Adaptive comparison startup prior; defaults to 32 Mbps, or zero with --source-rate")
    parser.add_argument("--source-rate", action="store_true", help="Request the TiPlay source-rate trial on the sending video factory only; forbids bitrate settings but does not prove native activation")
    parser.add_argument("--expect-native-activation", action="store_true", help="Require matching custom AAR provenance and correlated native branch events; does not prove all rate-control behavior")
    parser.add_argument("--expect-queue-epoch", action="store_true", help="In source-rate bundle mode, verify JNI epoch before frames and sender replacement retirement")
    parser.add_argument("--encoder-delay", type=int, default=0)
    parser.add_argument("--frames", type=int, default=180)
    expectations = parser.add_mutually_exclusive_group()
    expectations.add_argument("--expect-continuous", action="store_true")
    expectations.add_argument("--expect-bootstrap", action="store_true")
    parser.add_argument("--native-verbose", action="store_true")
    args = parser.parse_args()
    if args.start_bitrate is None:
        args.start_bitrate = 0 if args.source_rate else 32000000
    if args.source_rate and args.start_bitrate != 0:
        parser.error("--source-rate requires --start-bitrate 0 or no startup argument")
    if args.expect_queue_epoch and (not args.source_rate or args.mode != "bundle"):
        parser.error("--expect-queue-epoch requires --source-rate and --mode bundle")
    if args.expect_native_activation and not args.source_rate:
        parser.error("--expect-native-activation requires --source-rate")
    if args.expect_bootstrap and args.mode != "bootstrap":
        parser.error("--expect-bootstrap requires --mode bootstrap")
    if args.expect_continuous and args.mode == "bootstrap":
        parser.error("--expect-continuous applies to continuous producer modes")
    if args.action == "build":
        build(args)
    else:
        execute(args)


if __name__ == "__main__":
    main()
