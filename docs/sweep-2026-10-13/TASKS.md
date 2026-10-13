# Tasks

All owners read STANDARDS.md; edit in-scope files only, preserve behavior, run relevant tests/lint. Each owner updates only its own section below and writes RESULT-Tn.md. No shared source ownership.

## T1

- Scope: common/src/test/** (only files in SCOPE.md).
- Rules: STANDARDS.md 1–10 and applicable AGENTS contracts.
- Model: gpt-6-astra; Retirement requires judgment about current contracts and coverage.
- Status: done; full Android validation passed.
- Result: RESULT-T1.md; duplicate assertions and unused test code removed; single-Bonjour trial test retired by user request; launcher and independent receiver regressions retained.

## T2

- Scope: common/src/main/** (only files in SCOPE.md).
- Rules: STANDARDS.md 1–10 and applicable AGENTS contracts.
- Model: gpt-6-astra; Media and connection lifecycle performance needs ownership/thread analysis.
- Status: done; authorized single-Bonjour retirement and full Android validation completed.
- Result: RESULT-T2.md; viewport cache, unused settings field cleanup and common single-Bonjour trial retirement; audio-tap synchronization remains an open decision.

## T3

- Scope: shared/** (only files in SCOPE.md, excluding vendored/generated JNI).
- Rules: STANDARDS.md 1–10 and applicable AGENTS contracts.
- Model: gpt-6-astra; Protocol, queues and concurrent hot paths need deep judgment.
- Status: done; full Android validation passed, including 1327 shared tests.
- Result: RESULT-T3.md; single-Bonjour trial retired (4 production files and 12 dedicated tests), three scratch-allocation cleanups and two bounded UDP release checks; independent-path regressions retained.

## T4

- Scope: site/play/**, tests/web/**, tests/web-e2e/**, scripts/** and changed build/workflow files (only files in SCOPE.md).
- Rules: STANDARDS.md 1–10 and applicable AGENTS contracts.
- Model: gpt-6-astra; Browser media hot paths and test retirement need behavioral judgment.
- Status: done.
- Result: RESULT-T4.md; 57 focused browser tests and 9 release tests passed; coordinator full web suite 128/128 passed.

## T5

- Scope: mobile build/manifest changes; shared/src/main/jni/Android.mk and airplay/fairplay_jni.c.
- Rules: STANDARDS.md 1, 3, 4, 8, 11; product and upstream contracts.
- Model: coordinator gpt-6.1-sol; focused read-only review of version/launcher wiring and bounded JNI boundary, escalate ambiguous findings.
- Status: done.
- Result: no cleanup justified; native uses bounded stack buffers only at handshake, size/mode guards precede vendor calls, no media hot-loop allocation. Mobile changes are release version and deliberate single launcher selection; keep product entry contract. Native boundary checks included in final validation.

## T6

- Scope: final review and full validation across completed disjoint tasks.
- Rules: STANDARDS.md 1–12; AGENTS required CI command.
- Model: coordinator gpt-6.1-sol; integrate reviewed changes and check final source/test evidence.
- Status: done.
- Result: REVIEW.md, ENVIRONMENT.md, validation logs; full Android tests/lint/debug-build set passed; source/scope review complete.

## R1

- Scope: REPAIR-SCOPE.md common tap-map locking and regression files.
- Rules: STANDARDS.md 13; preserve owner/pause/retirement behavior.
- Model: gpt-6-astra; multi-thread lifecycle/lock ordering requires deep judgment.
- Status: done; final integrated verification passed.
- Result: RESULT-R1.md; one registry lock, detached owner-specific teardown and two controlled runtime concurrency regressions.

## R2–R3

- Scope: REPAIR-SCOPE.md receiver notification and buffered audio cancellation files.
- Rules: STANDARDS.md 13; preserve protocol/event/session and Bluetooth/audio ordering.
- Model: gpt-6-astra; cross-module network/backpressure concurrency requires deep judgment.
- Status: done; final integrated verification passed.
- Result: RESULT-R2-R3.md; bounded per-connection reverse-event writers and cancellable decoder publication leases preserve captured-target/event/epoch ordering.

## C1

- Scope: Incoming common production/tests in INTEGRATION-SCOPE.md, excluding TeslaBrowserLink.kt/TeslaBrowserLinkTest.kt and all R1 fixtures.
- Rules: STANDARDS.md 14; preserve merged behavior and follow shared written rules.
- Model: gpt-6-astra; Integrated Android lifecycle/media changes need careful behavior-preserving review.
- Status: done; final integrated verification passed.
- Result: RESULT-C1.md; obsolete Media3 marker and retained config field cleaned; current regressions retained; playback reference visibility recorded as an open decision.

## C2

- Scope: Incoming shared production/tests in INTEGRATION-SCOPE.md, excluding ReceiverServer.kt/ReceiverServerTest.kt, BrowserAudioMediaSink.kt/BrowserAudioMediaSinkTest.kt, WebAudioHub.kt/WebAudioHubTest.kt and all R2–R3 fixtures.
- Rules: STANDARDS.md 14; preserve merged behavior and follow shared written rules.
- Model: gpt-6-astra; Bluetooth routing, proxy/resource ownership and protocol additions need judgment.
- Status: done; final integrated verification passed.
- Result: RESULT-C2.md; four incoming production files cleaned for repeated allocation/regex work, all current regressions retained; legacy Bluetooth callback generation noted as an Open decision.

## C3

- Scope: Incoming site/play and tests/web/web-e2e plus build/workflow/mobile hunks in INTEGRATION-SCOPE.md; no vendors/generated locale HTML.
- Rules: STANDARDS.md 14; preserve merged behavior and follow shared written rules.
- Model: gpt-6-astra; Browser media and service-worker integration need contract-aware cleanup.
- Status: done.
- Result: RESULT-C3.md; merged audio/Video.js/cache reviewed, unused E2E import removed; 111 browser tests passed, 3 site-assembly cases require coordinator subprocess permissions.

## D1

- Scope: RETIRED-SCOPE.md common retired support code/tests, excluding R1.
- Rules: STANDARDS.md 15; prove exclusive retired use.
- Model: gpt-6-astra; reachability/retirement judgment.
- Status: done; final integrated verification passed.
- Result: RESULT-D1.md; retired decoder geometry helper/four tests and dead diagnostics APIs/one test removed; active photo and browser regressions retained.

## D2

- Scope: RETIRED-SCOPE.md shared retired support code/tests, excluding R2–R3.
- Rules: STANDARDS.md 15; prove exclusive retired use.
- Model: gpt-6-astra; media/protocol dependency judgment.
- Status: complete and frozen; coordinator full Android/phone E2E validation pending.
- Result: RESULT-D2.md; stale Media3 comment corrected, retired VideoTeeMediaSink and three dedicated tests deleted, RealPhone moved to current BrowserOnlyMediaSink; active clock/FCUP/Bluetooth/transport regressions and logger/cleanup behavior retained.

## D3

- Scope: RETIRED-SCOPE.md browser retired support code/tests; no vendors/generated.
- Rules: STANDARDS.md 15; prove exclusive retired use.
- Model: gpt-6-astra; worker/asset reachability judgment.
- Status: done.
- Result: RESULT-D3.md; removed retired time-label helper/test and recording-overlay callback, retained current timing regressions, cache v35; 58 focused Node tests passed.
