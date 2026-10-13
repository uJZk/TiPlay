# User-authorized concurrency/lifecycle repairs

User direction after tie-up: “修复三项潜在风险”. Apply these repairs to the latest integrated main (98d88d93), retain all incoming Bluetooth/media behavior, and complete tie-up after verification. This explicitly permits the synchronization/notification/cancellation changes left as original sweep Open decisions.

## Disjoint ownership

- R1 / common owner: common/src/main/java/com/shilapi/xcertplay/TeslaBrowserLink.kt; common/src/test/java/com/shilapi/xcertplay/TeslaBrowserLinkTest.kt and narrowly necessary new common regression fixture if existing suite cannot meaningfully cover races.
- R2–R3 / shared owner: shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverServer.kt; shared/src/main/java/com/shilapi/xcertplay/media/BrowserAudioMediaSink.kt; shared/src/main/java/com/shilapi/xcertplay/web/WebAudioHub.kt if cancellation/ownership publication requires a small hook. Existing ReceiverServerTest, BrowserAudioMediaSinkTest, WebAudioHubTest and narrowly necessary new shared regression fixture. Any additional production file requires coordinator review and recording.
- Coordinator: integration conflicts, final source review, docs/AGENTS, full tests/build, commit/merge/push/Pages. No overlapping source edits while owners run.

## Required contracts

1. Tap-map create/pause/resume/remove/cleanup must use a consistent synchronization policy. Preserve pause/reconnect state, retired-sink isolation and owner-specific audio/video teardown. Avoid holding one map's monitor while reading an independently mutable map without its monitor. Test relevant concurrent retirement/pause behavior.
2. Playback stop must not perform reverse-socket I/O under ownership, including nested /stop and Connection.finish callers. Capture exact old-session target before retiring, preserve stop/control/resource ordering, keep a slow peer from blocking ownership/acceptance/close, and prevent an old stopped event reaching a replacement session. Preserve ordinary AirPlay protocol and retire-all socket cleanup.
3. Decoder close/cancellation must not wait on a monitor held through potentially one-second buffered PCM capacity waiting. Preserve ordered music/backpressure, output-buffer release, route epoch/pause/reset semantics and Bluetooth routing. Prevent post-retirement stale publication or reset poisoning. Test full-buffer cancellation and replacement safety using bounded latches or controlled callbacks.
4. Tests must exercise actual concurrency/resource behavior; no source-text-only lock assertions or arbitrarily broad timeout increases. Failures should be explained, not swallowed. No new dependencies, upstream renames, unrelated product changes or performance claims without measurements.

## Integration notes

Six stash conflicts resolved while retaining incoming player/epoch callbacks, mirroring settings refresh, route-record validation, vendor asset list and cache version v34. ReceiverBonjour configProvider is now used by incoming normal mirroring settings, so it is retained; only unused trial TXT provider removed. Incoming bounded real-UDP-bind helper supersedes this sweep's identical test-only helper, which was removed. Original sweep completion baseline remains 37e810ee because all 128 incoming files were not swept.
