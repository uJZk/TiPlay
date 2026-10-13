# T2 result — common production code

Scope: existing `common/src/main/**` files recorded in SCOPE.md. STANDARDS.md, AGENTS.md and the upstream preservation rules were applied. No inherited source was changed. The explicit user-authorized retirement is defined in RETIREMENT-SCOPE.md.

## Changes

- `AirPlayVideoSurfaceBridge.kt`: cache the immutable fitted viewport between source-size updates. Previously every rendered frame repeated `AirPlayVideoLayout.fit()` and constructed a new `Viewport`. The encoder dimensions are immutable; source-aspect changes and rendering already run on the same HandlerThread. Invalidation remains in that queued size update, and computation remains inside the render exception boundary. GL calls, presentation metadata, callback ordering and disposal stay unchanged. This removes repeated fit work and one viewport construction per stable-size frame after the first. No runtime speed, latency or allocation benchmark was performed.
- `BrowserMainSettingsMenu.kt`: remove the private `wifiSettings` field and its assignments. Current code had no reads after the earlier settings revision removed visibility toggling. Both buttons are still created, attached and given the same callbacks.

- `AirPlayReceiverService.kt`: retire the optional single-Bonjour shared entry. Remove the flag/configuration, shared endpoint lease, shared identity branch and trial shutdown hooks. The former default branch now always starts the standalone `ReceiverServer`, advertises through `ReceiverBonjour` and refreshes discovery every five seconds. Its `tiplay_airplay_receiver` persisted keys, identity generation, `TiPlay AirPlay` name, HEVC setting, media/display callbacks and worker-owned shutdown remain unchanged.
- Delete fork-owned `UnifiedAirPlayTrialSettings.kt`; old `tiplay_unified_airplay_trial` settings are no longer read. Previously opted-in installations now use standalone receiver identity/discovery, as authorized by the user. No global settings value is mutated.

## Review coverage

Reviewed cast encoder/surface ownership, timestamp/submission queues, PCM sink and mirror AAC decoding, photo rendering, receiver service startup/shutdown, browser-link media taps and touch forwarding, connection retry/watch behavior, settings drafts/immediate apply, hotspot import/settings and the privileged USB hook. Scanned current in-scope Kotlin imports and XML structure. The unused upstream `CarPlayHostActivity.TextUtils` import was retained because its import line is outside the recorded incremental hunks.

Media buffers copied out of codec/ByteBuffer ownership were retained; changing that ownership needs a separate design. Existing bounded structures remain: mirror packet queue 24, mirror presentation map 128, cast frame/submission metadata 120. Existing decoder waits, encoder disposal timeout, frame coalescing and drop policies were preserved. Network/codec/probe work already assigned to workers was not moved. No collection limits, lock scopes, reconnect consent or media clock behavior changed.

## Checks

- `git diff --check -- common/src/main`: passed.
- Parsed all 52 existing in-scope XML files with Python ElementTree: passed.
- After trial retirement, search of `common/src/main` for `UnifiedAirPlayTrial`, `UnifiedAirPlayEndpoint`, `UnifiedAirPlayWirelessLease`, `tiplay_unified_airplay_trial`, `unifiedTrial` and `sharedEntry`: no matches. Reviewed the service diff to confirm standalone startup/discovery/identity statements are the former default branch unchanged, and receiver close still precedes discovery close on its worker.
- Reviewed existing `AirPlayVideoLayoutTest` assertions for landscape, portrait, rotation/pixel ratio and invalid size handling; no mechanical source-shape test added.
- No Gradle invocation in this task, as requested by the coordinator. The central Android CI run must validate compilation and existing common tests, including `AirPlayVideoLayoutTest`, `BrowserMainPageTest` and `BrowserMainHostTest`. No standalone `kotlinc` executable was available here. GL/device performance remains unmeasured.

## Open decisions

1. **Browser audio tap iteration does not use the audio map's monitor.** `TeslaBrowserLink.kt:129–130` constructs two separate synchronized maps. `pauseCarPlayDisplay()` at `:134–138` locks `taps` but iterates `audioTaps.values`; `releaseTap()` at `:235–237` can mutate `audioTaps` using only that map's own synchronization. Java synchronized-map iteration requires holding its map monitor, so concurrent pause/retirement can potentially throw or observe an inconsistent iteration. This is code evidence, not a reproduced device failure. Choosing a common transition lock versus copying a snapshot changes synchronization/retirement semantics and should receive targeted concurrent lifecycle coverage. Left unchanged under STANDARDS.md 3–4; no prior-session repair authorization assumed.

No tests were removed by T2. No commits or pushes were made.

## Coordinator final verification

Full required Android tasks passed after retirement: 1327 shared + 1093 common + 4 home = 2424 tests, zero failures/errors/skips; mobile/home/maphost lint and debug APK builds passed. Node suite 128/128 passed. Scope and final source review passed; see README.md, REVIEW.md and ANDROID-TEST-SUMMARY.json. No commit or push.
