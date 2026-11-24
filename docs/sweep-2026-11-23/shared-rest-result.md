# Shared web, transport and build follow-up

Status: done for this follow-up scope. Reviewed changed hunks in `shared/build.gradle`, both changed `transport` production files, `AirPlayPlaybackDiagnostics.kt`, `AirPlayVideoPlayback.kt`, `AirPlayVideoProxy.kt`, `BrowserRtcAudioCandidates.kt`, `BrowserRtcAudioRouter.kt`, `BrowserRtcPeer.kt`, `BrowserRtcVideoTrack.kt`, `BrowserRtcVideoLease.kt`, `BrowserRtcVideoSourceProcessor.kt`, `BrowserRtcVideoTransaction.kt`, `BrowserVideoDiagnosticsSchema.kt`, `BrowserRtcVideoDiagnostics.kt`, `NativeRtcAudioPeer.kt`, `WebAudioHub.kt`, `WebVideoHub.kt`, and `rtc_audio_jni.c`. In particular, reviewed generation fencing, ownership, source-ready waits, JNI callback/lock handling and diagnostic privacy. No safe behavior-preserving edits were justified in these hunks.

Checked the changed web/transport paths for TODO/FIXME/HACK markers and ran `git diff --check` on those directories, JNI wrapper and build file: passed. No Gradle invocation was made because the coordinator is running it. No additional tests are claimed by this task.

Reviewed remaining changed test hunks by behavior and sampled assertions, including audio routing, callback ownership, video source-rate recovery, readiness barriers, diagnostics, proxy behavior and Bluetooth/lockdown ownership. Retained tests and fixtures without edits. Reviewed the JNI README and artifact metadata, and verified the four ABI artifacts and their recorded recipe using `python3 scripts/rtc-audio/build.py --verify` (passed). This is a cleanup review, not a proof of every possible execution path. The previous review covered the other listed production helpers; packaged libraries and vendor artifacts were not edited.

Open decisions: none identified in reviewed hunks.
