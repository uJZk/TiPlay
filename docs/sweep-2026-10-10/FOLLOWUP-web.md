# Web queue and lifecycle follow-up

Implemented under the explicit policy-change authorization in FOLLOWUP-2026-10-11.md. Only TiPlay-owned shared web code/tests changed; prior touch and timing cleanups remain intact.

## Configuration backlog

`WebFrameQueue` now budgets queued configurations separately: at most eight records and 8 MiB of payloads, matching the protocol's maximum individual payload. Polling releases capacity. Existing frame age/count/byte limits remain intact. Accepted records keep their exact order.

A refused configuration ends its subscription with the existing END record format and reason `slow-consumer`. The hub immediately detaches that subscription; ending any subscription clears retained frame/config payloads and wakes its writer. It cannot continue sending frames that depend on a missing configuration. Reconnecting gets the current configuration and requests a key frame. An already dequeued record may finish writing before END, preserving transport order. The server's existing watchdog still closes stalled socket writes.

## Key-frame work

Each hub schedules at most one executor worker and retains at most one pending request. Bursts before execution collapse into one request; requests while a callback runs collapse into one subsequent retry. Ordinary requests retain the 500 ms rate limit, and explicit forced retries remain possible without accumulating tasks.

Pending requests carry the stream instance, not merely owner equality. Starting/ending a stream drops pending old-generation work, including when the same owner object starts a new stream. Worker admission checks the current stream under the hub lock, then performs network I/O outside it. A write already admitted before retirement may finish; queued retired callbacks are suppressed. This is intentional: aborting an active callback would require a cancellable network API or blocking stream teardown. A blocked active callback retains at most one coalesced retry, and a new stream's request replaces it.

Rejected executor submissions reset scheduling/rate state so a later request can recover. Callback exceptions remain contained, and subsequent pending retries continue. The `keyFrameRequests` counter now counts actual admitted callbacks rather than coalesced intents.

The default lazy single-thread executor belongs to the process and is shared across default hubs; per-session/subscription teardown does not shut it down. Injected executors remain owned by their callers. No new session-owned executor/thread is created by reconnects.

## Regression coverage

Seven added tests cover separate count/byte budgets, ordered polling and restored capacity, oversized configuration refusal, payload release, 1,000 rapid configurations followed by reconnect/key-frame recovery, 1,000-request bursts with queued and actively blocked executors, retired/same-owner generations, coalesced active retries, rejected submissions and callback failures, and continued usability of an injected executor after teardown.

Focused validation used the documented managed JDK/SDK environment:

`./gradlew :shared:testDebugUnitTest --tests 'com.shilapi.xcertplay.web.*' --console=plain --no-daemon --no-configuration-cache`

`git diff --check` passed. The focused Gradle attempt reached Kotlin compilation, then failed on four private-companion references in the concurrently added `airplay/AirPlayAudioSetupDiagnostics.kt`, outside this task. No web compilation errors were reported; tests did not execute. The audio agent is correcting that shared compilation blocker, and the coordinator will run the full mandatory Android CI command, superseding this attempt. Log: `/tmp/tiplay-web-followup-tests.log`. No measured performance improvement is claimed.

## Coordinator final verification — 2026-10-11

The full mandatory AGENTS.md Android command passed in 7m 40s, including this module's regression tests, all three application lint tasks and debug APK builds. Shared/common/home report totals are 1,205/992/4, zero failures/errors/skips. See FOLLOWUP-ANDROID-VALIDATION.txt and FOLLOWUP-ANDROID-TEST-SUMMARY.json. Final verification supersedes earlier pending/failed attempts above.
