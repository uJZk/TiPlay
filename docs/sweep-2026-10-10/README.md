# Code sweep 2026-10-10

Status: complete — cleanup and authorized queue/lifecycle fixes verified. See [FOLLOWUP-2026-10-11.md](FOLLOWUP-2026-10-11.md).

- Scope: first sweep, TiPlay-owned code only (user excludes upstream original code). See SCOPE.md.
- upstream-base: `e837efa95e10632aee3e1d6e8c03dcc66c754868`
- base-commit: `e80a6208e7f17e7432261a2a7ee50ade15155bdd` (final sweep point for the next sweep)
- current HEAD: `e80a6208e7f17e7432261a2a7ee50ade15155bdd`
- Initial working tree: clean.
- Standards: STANDARDS.md, grounded in AGENTS.md and upstream merge policy.
- Resume: consult TASKS.md; agents own disjoint source files. Each agent writes its own RESULT-<task>.md to avoid concurrent edits; coordinator integrates these into TASKS.md after each batch.
- Model availability: Sonnet/Opus unavailable; use gpt-6.1-sol for mechanical tooling and gpt-6-astra for lifecycle/protocol/settings judgment, matching the skill capability tiers.

## Initial open decisions

The user authorized these fixes on 2026-10-11. All six modules now have verified implementations and regression tests. Full Android CI, browser tests and both E2E harnesses pass. The following list preserves the initial findings.

Performance review found follow-ups requiring behavioral policy decisions; no changes applied and no measured regression/gain claimed. Details and file references are in each RESULT report.

- common: coalesce/bound per-trigger interface probe threads; preserve request freshness.
- network: coalesce hotspot refresh tasks without losing retries; define bounded timed-out shell reader cleanup.
- web: define limits/coalescing for never-dropped configuration records and queued key-frame requests.
- shared-other: replace lifetime audio SETUP CopyOnWriteArrayList only after defining concurrent diagnostic snapshot semantics.
- browser: define producer backpressure, disconnected decoder/frame lifetime and pending MSE object URL ownership.
- tooling: see RESULT-tooling.md for harness lifecycle/queue decisions. Optional fake-phone E2E retry failed the stats-event assertion with one field received, after H.264 muxing, VP8 decode, viewport and touch checks passed. Full E2E is not passing; see E2E-VALIDATION.txt.

These findings mean performance best practices review is complete, not a blanket certification. Allocation/copy reductions are evident from source; end-to-end latency/throughput was not measured.

## Follow-up verification — 2026-10-11

- All six queue/lifecycle findings resolved with explicit bounds, cancellation and ownership rules; residual platform-read limits are documented in FOLLOWUP-2026-10-11.md.
- Full required Android CI succeeded in 7m 40s, including mobile/home/maphost lint and all three debug APKs. Shared/common/home reports: 1,205/992/4 tests, total 2,201, zero failures/errors/skips.
- Browser 60/60 and tooling 4/4 tests pass. Fake and real Java phone-server E2E both pass, including every browser decode path, native H.264 MSE, recovery, session retirement, touches, stats, CORS and offline caching.
- All 12 bundled browser assets match source. Public-tree and whitespace checks pass. First compile/delivery failures and final passing logs are retained under FOLLOWUP-*.
- No performance benchmark or physical vehicle validation claimed. Commit/push/deployment progress is recorded in TIE-UP-2026-10-11.md.

## Initial cleanup verification

- Source diff spot-checked: all 11 changed source files are in scope; inherited edits belong to TiPlay hunks. Protocol, validation order, settings ordering and resource ownership preserved by inspection.
- Full required AGENTS.md Android command succeeded on Temurin 25.0.4.1+1 (`BUILD SUCCESSFUL in 9m 21s`; 247 tasks, 30 executed / 217 up-to-date). Included shared/common/home unit tests; mobile/home/maphost lint; and all three debug APK builds.
- Android report totals: shared 1,186; common 987; home 4; total 2,177 tests, zero failures/errors/skips. See ANDROID-TEST-SUMMARY.json and ANDROID-VALIDATION.txt.
- Browser unit suite passed 50/50 (Node 24.19.0; CI specifies Node 22). See BROWSER-VALIDATION.txt. Browser source has not changed since that passing run.
- Public-tree check passed. Site generator produced seven landing pages with no generated Git changes. All 63 in-scope Android XML files parse without duplicate named entries. Diff and changed-JS syntax checks passed.
- RealPhone.java compiled successfully with Temurin 25 and the newly built shared classes/Kotlin standard library.
- Optional fake-phone E2E retry failed the stats-event assertion after earlier playback/touch checks. This separate harness issue is an Open decision, not a passing check; see E2E-VALIDATION.txt.
- No end-to-end performance gain measured. No commits or pushes made.

## Environment recovery

Foojay JDK provisioning returned HTTP 403 initially (ANDROID-INITIAL-BLOCKER.txt). Installed JDK 25 from permitted official distribution hosts and required Android SDK/NDK packages from dl.google.com. Redirected Android/Robolectric user data and Gradle cache to writable directories, preserving shell HOME. Oracle JDK started the build but caused crypto-provider initialization errors in Robolectric; switched to the CI vendor, Temurin, stopped the old daemon and disabled old configuration-cache reuse for the verification run. All required checks then passed. Environment changes required no additional tracked application/Gradle source edits.

See ENVIRONMENT.md for verified checksums, installed paths and the complete repeatable command; SDK-VALIDATION.txt records SDK installation. Tools are installed outside the repository. Debug APKs are available under each application's build/outputs/apk/debug directory.

## Next sweep

All six source tasks and required global verification are done. Scope the next sweep from the final base-commit above plus uncommitted changes. Original upstream code remains excluded unless the user changes that constraint. The tie-up now commits these working-tree changes; consult TIE-UP-2026-10-11.md for the completed source baseline and delivery state. Earlier no-commit notes above describe pre-tie-up verification.
