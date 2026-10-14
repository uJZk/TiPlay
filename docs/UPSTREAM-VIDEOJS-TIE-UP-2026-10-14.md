# Upstream and Video.js tie-up — 2026-10-14

The user invoked [tie-up](skill://user/6ac97d91ed5c81919d90d7181baa6397/tie-up/SKILL.md),
authorizing cleanup, default-branch integration, push and existing delivery workflows.
Scope is the full DiPlay source sync, TiPlay audio adaptations and Video.js v10 migration.

## Source and integration

- `d40d09be6`: full DiPlay merge through `c30d3f0df`, with phone/browser product gates.
- `549792563`: owned browser RTP timing and bounded HFP/SCO microphone recovery.
- `d7d494ccb`: Video.js 10.1.0, official hls.js adapter and self-hosted offline assets.
- Remote main advanced to `6f6baed5e` during this session. Its manual endpoint contract,
  concise settings guidance and documentation cleanup are retained. Browser address/port
  changes apply on Android without silently changing browser endpoints; Japanese copy
  also explains manual reconnection.
- The integrated page uses cache v38 because remote main had already deployed v37.
  All vendor/player/caption files and licenses are included in the offline manifest.
- Preserve Android phone + car browser scope, application ID `com.ujzk.tiplay`, API 28
  minimum and inherited identifiers. Upstream ancestry remains a full merge.

## Packaging decision

GitHub confirms beta.2 is already published. Do not rerun its draft workflow or replace
published assets. Beta.3/versionCode 35 packages the new Android fixes using the existing
signing and runtime-input workflow, remaining a prerelease draft. There is no public APK
release in this tie-up. The download website's version label stays at downloadable beta.2
until beta.3 is published; Pages ships the compatible v10 browser update.

The runtime identity is still copied unchanged from the pinned, hash-verified DiPlay
0.2.18 APK. Updating source ancestry does not change that identity provenance.

## Verification and cleanup

The initial full CI passed shared 1,822, common 1,475 and Home 6 tests, plus three-app
lint/debug assembly. Browser tests passed 116, page/offline and MP4/HLS Canvas E2E
passed, native JNI boundaries passed and release-draft tests passed 9.

After integrating remote main, full Android CI passed again: shared 1,822, common
1,475 and Home 6 (3,303 total), with no failures/errors/skips, plus all three-app lint
and debug assembly. Node 22 tests passed 116/116; page/offline and MP4/HLS v10 E2E
passed; release-draft tests passed 9/9. Final Japanese endpoint translation and APK
resource regeneration passed a targeted translation test and debug assembly.
The assembled site includes all eight editions and every cache-v38 asset. The source-only debug build does not
package runtime identities. The release workflow separately checks signing, runtime
assets, package/version metadata, source ZIP exclusions and remote artifact digests.

Session scratch clones/metadata, conflict snapshots, media fixtures and vendor
node_modules were removed. Final local evidence is retained under ignored
`agent_docs/upstream-videojs-2026-10-14/`. Reused toolchain caches and earlier-session
notes remain. No earlier active background process required termination; the final local Gradle
and Kotlin build daemons were stopped after verification.

## Execution-channel recovery

The earlier cloud command-channel interruption has recovered. Current environment
status reports running/connected with no failure. Available cgroup counters show no
OOM kills or process-limit events; recorded memory peak was about 12.2 GiB against a
16 GiB limit. These current counters do not determine the historical platform cause.
No repository or gateway configuration was changed to claim a root-cause repair.

On another interruption, reconnect the selected environment, inspect the existing log
and process state before repeating commands, and resume any pending Git operation.
Run one Gradle build at a time with `--max-workers=2`, keep output in a log and stop
its daemon after checks. This prevents blind reruns and bounds build concurrency.

## Delivery status

Initial integrated source commit `3df7c27c45a72a4c7174907bcccb968ebfb3bd28` was pushed without force.
Local work and upstream integration branches were deleted; there is one main worktree.

[Pages run 38488994798](https://github.com/uJZk/TiPlay/actions/runs/38488994798) succeeded.
GitHub Pages deployment `7053293554` reports success for the same source commit at
https://ujzk.github.io/TiPlay/. This verifies deployment status, not a real-car visit.

[Signed beta.3 workflow 38489034087](https://github.com/uJZk/TiPlay/actions/runs/38489034087)
succeeded, including release lint/build, signature/runtime checks, exact source ZIP,
checksums, upload and temporary-input cleanup. [Beta.3 draft](https://github.com/uJZk/TiPlay/releases/tag/untagged-fa4527e80a814c115f93)
(ID `412219550`) remains a prerelease draft targeting the source commit above, with
exactly APK, matching source ZIP and `SHA256SUMS.txt`. The checksum attachment matches
the remote asset digests:

- APK SHA-256: `ec94351f7a10f747cf4a87f475c9257f54607dabc07c8045cfc85925fa571b44`.
- Source ZIP SHA-256: `de8aacb147319e9f4b57b59233c5fd166acab87d8106db08a09f3bd938bc87e8`.

[Remote Android checks 38488994847](https://github.com/uJZk/TiPlay/actions/runs/38488994847)
failed one shared test: `MediaClockDiagnosticsTest.failingFinalLoggerCannotPreventSocketRelease`
reported `BindException` immediately after closing a timing socket. Local stress reproduced
72 immediate rebind failures in 5,000 closes. Native datagram I/O can retain the descriptor
until its receiving worker returns, even after `DatagramSocket.close()`.

The follow-up adds bounded worker retirement outside the socket/clock locks, preserving
caller interruption and avoiding a self-join. Existing immediate-rebind coverage now runs
100 times and a cancellation case is added. The same 5,000-close probe has zero failures
after the fix. Targeted clock tests passed, including cancellation preservation. Final local full CI
passed shared 1,823, common 1,475 and Home 6 (3,304 total), zero failures/errors/skips,
plus three-app lint/debug assembly. Corrected draft delivery and remote CI are next. The first beta.3 artifact above will be replaced in its unpublished
draft by an exact build/source pair for the corrected commit. No APK is publicly
published by this tie-up, and published beta.2 assets are unchanged.

Real iPhone/car checks remain pending: USB/wireless negotiation, car HFP/SCO recording
recovery, call/Siri/navigation timing, long playback, Safari/vehicle browser compatibility
and direct iPhone resource CORS/reachability. Desktop tests do not establish those results.
