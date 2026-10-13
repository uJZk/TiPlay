# Sweep tie-up and authorized risk repairs

Status: all final checks passed; committing and delivering.

User invoked tie-up, authorizing session cleanup, docs, commit, merge to main, normal push and existing Pages deployment. User then directed “修复三项潜在风险”; resolve all three before delivery. No new release/signing workflow is requested.

## Integration

- Sweep started at 37e810ee339da79ed53dc106138c7a80ee6c0680 on work with a clean tree.
- Read-only fetch found origin/main at 98d88d93f17cc17742ef68d39c0f3b6306970d12, with four later commits and browser media/Bluetooth changes.
- Session edits saved in recovery stash `397ef47bdeb84bc6e520e72ecb584cb2aae4b4b5`; work fast-forwarded to incoming main and stash reapplied. Six conflicts resolved preserving incoming product behavior and single-Bonjour retirement. Recovery stash retained until verified delivery.
- Original completed sweep base-commit remains 37e810ee: incoming 128-file main update is an integration input, not a delegated sweep. Include it in the next sweep.

User further requested “合并后再次对代码进行整理/清理”: INTEGRATION-SCOPE.md records incoming files/commits, and TASKS.md adds disjoint C1–C3 reviews alongside R1–R3. Original 128-file incoming integration is now explicitly reviewed for code cleanup; completion/next-sweep baseline will be recorded after all tasks and final checks.

## Authorized repairs

1. TeslaBrowserLink: serialize tap-map iteration/creation/removal under a consistent lock, preserve audio/video pause and retired-session ownership.
2. ReceiverServer: make stopped playback notification avoid network I/O under the ownership monitor, retaining session-target identity, order and shutdown cancellation.
3. BrowserAudioMediaSink: ensure decoder close does not wait on a monitor held through buffered PCM publication; retain pause/route/reset generations and bounded backpressure, prevent stale delivery.

Scope: the three production files and necessary existing regression files in common/shared tests, plus WebAudioHub if needed for cancellable generation-safe delivery. Add exact file list and checkable repair rules to REPAIR-SCOPE.md before editing. Full AGENTS Android task set and browser suite must pass after integration/repairs. Concurrency regression tests are warranted for these behavior-sensitive changes.

## Verification progress

- Final browser unit suite: 114/114 passed. Release helper tests: 9 passed; public-tree check passed.
- Existing full fake-phone Chromium E2E passed, including all fallback decoding paths, reconnects, touch mapping, resource retirement and cache behavior.
- Video.js real generated MP4 E2E passed, including playback state, seeking, failed-load command recovery and Bluetooth muting.
- Pages locale regeneration produced no extra tracked changes; assembled complete local Pages output including new incoming vendor assets and final cache v35. Vendor files were not edited.
- First Android compile found a Closeable expression-body return mismatch in the new publication lease; fixed to explicit Unit block without changing its behavior. TIE-UP-ANDROID-INITIAL-COMPILE.txt preserves the error. Full required task set is rerunning with all tests, no new filters.
- No signing/release build or deployment is requested. Incoming beta.2 version and prior signed delivery remain unchanged.

## Remaining findings

The requested three risks are repaired. Additional incoming-code static findings (outer browser playback reference visibility, legacy Bluetooth callback attempt scoping) are recorded in README.md and C1/C2 reports; they are not part of the authorized three-risk repair. Queue ownership, timing policies and hardware performance limits remain explicit.

## Delivery

Pending: finish validation, remove owned temporary test inputs and stop owned idle build processes, record checks/docs, commit, merge to main, normal push and automatic existing Pages deployment. No force push, no signed release. Source recovery stash remains until verified delivery.


## Additional retirement clarification and validation correction

User expanded post-merge cleanup to newly retired support code/tests; RETIRED-SCOPE.md and D1–D3 tasks record proof and exact adjacent paths. Full shared verification found one new cancellation regression at WebAudioHubTest line 52: publication retirement left the blocked music producer alive after 500 ms. Correct production cancellation, retain prompt-return assertion, then rerun full checks. No commit/push/deploy before passing final verification.

The cancellation regression was corrected in production: retain the original one-second absolute music wait budget, but use at most 10 ms capacity waits and recheck publication/generation/closed state each time. This promptly cancels all waiting producers even when another active publication keeps the queue full, independent of bulk-removal signaling. The original 500 ms test bound remains; a new multi-waiter/other-active-publication test verifies ordered surviving audio and no reader retirement. Initial failure retained in TIE-UP-ANDROID-INITIAL-CANCELLATION.txt.

Retirement review additionally removes the now-unused decoder size/layout and diagnostics, the old browser time label/recording overlay callback, and the obsolete VideoTee fixture path while retaining active video/media clocks and current BrowserOnly regressions. Final worker report lists exact deleted methods/files; source frozen, full required task set rerunning.

## Final verification and cleanup

Android: BUILD SUCCESSFUL in 4m 13s; 2423 tests (1352 shared, 1067 common, 4 unchanged home), zero failures/errors/skips; mobile/home/maphost lint and debug builds passed. Final Node 113/113, release tests 9, public-tree and whitespace checks passed. Final fake-phone, compiled actual-phone-server and actual Video.js MP4 Chromium E2Es all passed. TIE-UP-TEST-SUMMARY.json and final logs retain evidence.

The old phone fixture had constructor, nested-vendor, synthetic timestamp and optional-before-first-stats assumptions. Corrected only its fixture/host: current constructors/BrowserOnly, nested files limited to host root, current future scheduled presentation under zero CarPlay raw cap, finite post-restart counter followed by 20 further frames. Updated current authenticated audio/video URL assertion while retaining no-Referer, other-path leakage/CSP and isolation checks. Production defaults, budgets and runtime assertions were not loosened.

Verified owned idle Gradle and Kotlin compiler processes stopped. Removed only this session's temporary Playwright install, generated MP4, local assembled Pages tree, temporary init script and scratch logs; permanent test/result reports, caches and toolchain retained. All E2E services exited via their cleanup paths. Recovery stash retained until source push is confirmed.

## Delivery steps

1. Cleanup: complete, as above.
2. Build: required Android debug outputs and existing Pages assembly passed; signed/release build skipped (no release change requested).
3. Quick verify: complete; no production changes after final passing checks.
4. Docs: README, scopes/results/TASKS and this record updated; handoff linked from AGENTS.md.
5. Commit: pending.
6. Merge: work to default main pending; delete work after verified merge.
7. Push: normal origin/main push pending; never force.
8. Deploy: existing Publish site path applies; await source commit's Pages run after push.
