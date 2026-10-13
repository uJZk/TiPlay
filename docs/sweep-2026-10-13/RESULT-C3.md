# C3 post-merge browser review

Status: done; full browser verification awaits coordinator execution permissions.

## Scope and change

Reviewed incoming browser, web-test/E2E and mobile build hunks from `37e810ee..98d88d93` under STANDARDS.md 14, together with the merged T4 cleanup. Removed the unused `resolve` import from `tests/web-e2e/airplay-video.mjs`; its promise callback parameter of the same name is an independent local binding. No production behavior, public export, vendor asset or generated page changed in C3.

## Integration review

- The audio parser retains the incoming route-record type 5, header-only route validation, route flag and restricted CarPlay/mirror modes. The merged redundant 24-byte minimum removal remains safe because the record-size check precedes payload reading. Browser route handling retains revision ordering, body retirement when status overtakes PCM, playback-generation credit isolation and worklet reset/muting. Browser microphone capture remains removed; Android owns Bluetooth capture.
- Ordinary AirPlay video remains owned by Video.js and its media clock. The content-type probe cancels its body before player creation; replacing playback aborts the probe, clears its timer and disposes the player. Revision-based seeks, updated-revision load failures, Bluetooth mute enforcement and restoration remain unchanged. Direct URL/proxy selection, no-referrer handling, page CSP and diagnostic direct-URL removal were preserved.
- The previous PCM active-scan cleanup and unused GL binding removal survived integration. No additional hot-path change was justified; no benchmark or performance gain is claimed.
- Service-worker v34 already covers the merged production assets. Its recursive asset test passes, including nested Video.js assets and excluding the retired presentation-debug module. This task changed only an E2E import, so another cache bump is unnecessary. Vendor files were not edited.
- Incoming mobile versionCode 34 and versionName 0.2.14-beta.2 are intentional release inputs and remain unchanged. No new workflow hunk appears in INTEGRATION-SCOPE.md.

## Tests and retirement

No additional tests retired. Incoming replacements reflect the current Bluetooth/playback contract; route ordering, fresh PCM after mute, absence of browser capture, worklet ducking and credit tests remain. The AirPlay E2E fixture retains MP4 decoding, seek-vs-rate revision, mute enforcement, disposal and current-command load-failure checks. Exported helpers and their existing tests were retained under the public-export preservation rule.

- Node 22.23.3: `node --test --experimental-test-isolation=none tests/web/*.test.mjs` ran 114 tests: 111 passed; the three site-assembly cases failed solely with `spawnSync python3 EPERM` in this execution sandbox. Coordinator notified to run the final required full suite with local subprocess permissions.
- `node --check tests/web-e2e/airplay-video.mjs`: passed.
- `git diff --check` on C3 source paths: passed.
- No Gradle, external network, browser E2E, vendor regeneration or physical-device validation performed by C3. The import-only edit does not change the E2E execution path.

## Open decisions

No newly established behavioral defect or proposed behavior change from C3. Direct-media/proxy compatibility and physical Bluetooth routing still need their existing browser/device acceptance; this cleanup does not claim to validate those environments.
