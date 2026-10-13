# D3 retired browser support cleanup

Status: complete; coordinator owns final integrated verification.

## Evidence and removals

Exact paths and use evidence were registered in RETIRED-SCOPE.md before edits. This phase follows the user's explicit expansion to post-merge retired support code, including obsolete exported helpers that C3 previously preserved.

- Removed `timeLabel` from `site/play/airplay-controls.js`. At the previous baseline it formatted the custom range control and duration label; incoming Video.js controls removed both runtime calls. Repository non-vendor source/test search found no remaining consumer except its own dedicated test.
- Removed only `time labels handle hours and unknown duration without clock wraparound` from `tests/web/airplay-controls.test.mjs`, along with its now-unused import. `playbackState` input validation remains, and the current Video.js E2E continues to cover playback, command revisions, route muting and disposal.
- Removed the `onPresentation` option/default and its per-draw callback/sample object in `site/play/video.js`. Incoming `app.js` and `decoder-worker.js` already removed all wiring to the retired recording-time overlay; source/test search showed no remaining subscriber. Current draw FPS, signed presentation-offset statistics, deadlines, rendering and frame release are untouched. This eliminates obsolete per-frame work; no benchmark or measured improvement is claimed.
- Renamed the obsolete AirPlay-video-specific 500ms timing test to describe fallback video deadlines. Its generic configuration and queue/deadline assertions still protect the current fallback contract, so those assertions remain.
- Bumped service-worker cache v34 to v35 for the changed runtime assets. ASSETS is unchanged; no vendor, generated locale or runtime asset file was deleted.

## Preserved current support

`MAX_MEDIA_DELAY` and the generic timing scheduler remain required for unknown-mode/startup fallback and current mirrored audio/video. PCM timeline/mixing, ordered Bluetooth route records, credit generations and transport ownership remain active. Browser microphone capture, its resampler and presentation-debug asset had already been removed by incoming changes; no remaining source references were found. No Android Bluetooth microphone implementation was touched.

## Verification

Node 22.23.3: `node --test --experimental-test-isolation=none tests/web/airplay-controls.test.mjs tests/web/audio.test.mjs tests/web/video.test.mjs tests/web/media-timing.test.mjs tests/web/delta-wiring.test.mjs tests/web/debug-window.test.mjs tests/web/page.test.mjs` passed 58/58. This includes worklet/route synchronization, worker transfers, canvas expiry and resource release, current debug fields, and recursive service-worker asset checks.

`git diff --check` on browser/test paths passed. Non-vendor browser/test/E2E searches found no remaining `timeLabel`, `onPresentation`, `PcmCapture`, `activateMicrophone`, `captureRate`, `formatPresentation` or `presentation-debug` references. The prior coordinator's full 114-test and browser E2E results apply before this phase; the final suite should now contain 113 tests after the one justified retirement. No Gradle, external network, commit or push performed.

## Open decisions

None introduced. Current timing and media behavior was retained; only exclusively retired browser support was removed.
