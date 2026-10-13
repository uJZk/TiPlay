# Code sweep 2026-10-13

Status: complete — integrated main, three-risk repairs and post-merge/retired-code cleanup verified; source committed/merged/pushed and Pages deployment successful; see TIE-UP.md.

- Previous completed sweep: docs/sweep-2026-10-12.
- Initial baseline: `477801f5e2fde2b48d064bcd06dc2df71f312514`.
- Initial HEAD: `37e810ee339da79ed53dc106138c7a80ee6c0680`; integrated main: `98d88d93f17cc17742ef68d39c0f3b6306970d12`.
- base-commit: `91430639a7c617934a4e7c778976360f7853140d` (final verified source commit after integrated cleanup; next sweep excludes delivery-only documentation).
- Initial working tree: clean. No commit, push, signing, release or deployment authorized.
- Scope: SCOPE.md records files/touch counts/commits; HISTORY.txt and DIFFSTAT.txt retain history evidence.
- Standards: STANDARDS.md, AGENTS.md and docs/Upstream.md.
- Resume: TASKS.md and RESULT-T1–T4.md identify owners, final changes and verification; ENVIRONMENT.md reproduces toolchain/checks.
- User focus: obsolete/completed experiment code and potential performance problems. User clarified single entry means a single Bonjour broadcast service and subsequently directed its code removal. RETIREMENT-SCOPE.md records that explicit behavior authorization; no launcher/UI entry contract was retired.

## Original sweep results (before incoming main integration)

- Retired the optional single-Bonjour trial: removed global setting reader, shared endpoint/leases/router/external receiver adapter, TXT/identity override providers and session hooks. CarPlay and ordinary AirPlay now always use the existing separate discovery/listener/identity paths; previously opted-in devices return to those paths. No old setting is read or reset. Removed 5 production experiment files and 4 dedicated test files (13 test methods); retained standalone session/media/Bonjour, phone-browser and launcher lifecycle regressions. Current AIRPLAY.md instructions match the code.
- CarPlayBonjour.kt and CarPlayVpnService.kt exactly match the pre-trial baseline. Ordinary AirPlay retains its separately persisted identity, normal ReceiverServer startup and five-second discovery refresh. REVIEW.md records the scope/default-path review.
- Removed duplicated reconnect assertions, unused test imports/local, stale test naming and the write-only wifiSettings field; UI controls and callbacks remain.
- Cache fitted viewport on its GL owner thread, invalidating on source geometry changes. Reuse stream-local mirror header/ByteBuffer, private copied Annex-B start code and worker-local MediaCodec.BufferInfo. Replace per-sample PCM active callback with an equivalent indexed scan; remove redundant PCM size check and unused canvas binding, with the required service-worker asset version update.
- Media payload ownership, queue limits, timing, backpressure, lock scopes and timeout policy remain. No end-to-end performance gain was measured.

## User follow-up: risk repairs and post-merge cleanup

The user invoked tie-up, requested fixes for all three reported risks, and requested another code cleanup after merging main. TIE-UP.md, REPAIR-SCOPE.md and INTEGRATION-SCOPE.md record this authorization and the 108 incoming code/test/resource file histories. Work fast-forwarded to 98d88d93 and six stash conflicts were resolved without restoring the retired single-Bonjour experiment or replacing new Bluetooth/Video.js behavior.

- Tap registries now share one lock; retirement detaches audio/video together and closes them outside that registry lock. New tests cover pause/retirement interleaving and delayed old teardown versus replacement ownership.
- Reverse notifications/resource events enqueue on the captured connection's bounded serial worker; socket writing never runs under ownership. New tests cover slow writers, ordering, prompt stop/close, cancelled resource futures and same-ID replacement isolation.
- Decoder buffered publication no longer holds its monitor through queue waiting. A publication lease serializes retirement and reset admission under the hub's short lock, removes queued retired records and rejects late PCM/reset; interruption releases waiting producers. New tests cover full-buffer replacement/pause, late-reset epoch safety and replacement delivery. Already-consumed in-flight records remain outside queue cancellation; existing reset/epoch protocol handles retirement boundaries.
- Post-merge cleanup removes a stale Media3 opt-in, a write-only retained config field, per-sample policy-set and PCM-tail allocations, repeated silence/full-capture copies, repeated proxy regex compilation and an unused E2E import. Incoming dynamic mirroring configuration provider remains because settings now use it. Incoming bounded UDP helper replaces our duplicate helper.
- User clarified that newly retired remnants are part of cleanup. Removed the unused Android decoder-size setter/layout helper and its 4 tests, obsolete seek/audio/decoder diagnostic APIs and 1 dedicated test; still-photo canvas scaling and encoder/GL teardown remain. Removed the old browser progress-bar time helper/test and recording-time overlay callback; real FPS/offset statistics remain. Removed the unused VideoTeeMediaSink adapter and 3 dedicated tests; compiled-phone E2E now uses the actual BrowserOnlyMediaSink path. Active NtpClock/VideoMediaClockMapping and normal receiver/Bluetooth/proxy regressions remain. RETIRED-SCOPE.md and RESULT-D1–D3.md record exact reachability evidence. The intermediate viewport cache is superseded by retiring the obsolete layout path entirely; service-worker cache is now v35.
- See RESULT-R1.md, RESULT-R2-R3.md and RESULT-C1–C3.md. Current functional coverage retained; no measured device performance claim.

## Remaining decisions from the post-merge review

1. AirPlayCastPlayer.browserVideo is a main-thread-written plain reference read through player.state on receiver threads; its inner playback state is volatile, but the outer reference has no explicit visibility guarantee. Recorded in RESULT-C1.md; no unrelated fourth repair was silently applied.
2. Legacy pre-Android-31 Bluetooth profile callbacks lack attempt tokens and can observe a newer stop/start attempt's shared flags. Generation-scoping needs targeted stale-callback coverage; recorded in RESULT-C2.md.

These are additional static findings in incoming code, separate from the three user-requested risks now repaired. Hardware route, real-device performance and physical vehicle validation remain device follow-ups.

## Verification

- Full Node 22 suite after final browser edits: 128/128 passed.
- Release-draft tests: 9 passed (mocked, no network).
- Host JNI boundary checks and final public-tree scan: passed.
- Full final AGENTS Android task set: BUILD SUCCESSFUL in 4m 36s, 246 tasks (59 executed, 187 up-to-date). Shared 1327, common 1093 and unchanged home 4 tests: total 2424, zero failures/errors/skips. Mobile/home/maphost lint and debug APK builds passed. Offline execution used 2 workers and common test JVM forks=2, with no new test filters. ANDROID-TEST-SUMMARY.json retains totals and selected regression evidence.
- Initial default sandbox blocked local socket/subprocess creation; permitted local execution resolved it. Initial Android shared run had one immediate UDP rebind failure after teardown (1339 tests, 1 failure); common had 1094/1094 and home 4/4 passing. Evidence: ANDROID-INITIAL-UDP-FAILURE.txt.
- Existing UDP tests now await actual original wildcard port bind within a one-second monotonic deadline, retrying BindException only. Both ports must really release; subsequent video/control and pre-teardown ownership assertions remain. Production shutdown intentionally does not wait for receive workers; no production join or reuseAddress workaround was introduced.
- Original 31 changed/deleted tracked files matched scope; original git diff --check and default-path review passed. The tie-up additionally runs post-merge full checks and browser E2Es; TIE-UP.md holds final delivery evidence. Physical device/vehicle tests and performance benchmarks are not run.

## Final integrated verification

- Complete required Android task set: BUILD SUCCESSFUL in 4m 13s, 246 tasks (53 executed, 193 up-to-date). Shared 1352, common 1067, unchanged home 4: **2423 tests, zero failures/errors/skips**; all three lint/debug-build tasks passed. TIE-UP-TEST-SUMMARY.json records relevant regressions.
- Final browser suite: **113/113**. Release helper tests: 9 passed; public-tree and whitespace checks passed. Pages regeneration added no unplanned generated changes; complete local site assembled with cache v35.
- Final fake-phone Chromium, compiled actual-server phone and Video.js real MP4 E2Es all passed. The phone fixture now uses current constructors/BrowserOnly path, serves nested vendor assets within its root, schedules synthetic CarPlay presentation ahead of arrival to comply with the existing zero raw deadline, and waits for a finite restart counter before requiring 20 additional frames. Original stats, actual-render, privacy, CORS and session-isolation assertions remain.
- Initial compilation/cancellation/phone-fixture failures and code evidence are retained in TIE-UP-*-INITIAL*.txt and result reports. Production cancellation now checks retirement at most every 10 ms within the original one-second wait budget; no timeouts or progress assertions were relaxed.
- All 55 changed/deleted tracked files are covered by written scope or tie-up's AGENTS documentation requirement. Current product/retired references and worker changes spot-checked. Temporary browser tools, clip, site output and scratch logs removed; verified owned idle build daemons stopped. No physical vehicle or hardware performance benchmark claim.
