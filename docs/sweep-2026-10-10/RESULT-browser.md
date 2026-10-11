# Browser sweep result

Reviewed all 20 files in the browser scope against STANDARDS.md rules 1–9 and AGENTS.md. `site/play/*` and the seven `tests/web/*.test.mjs` files are additions after `e837efa`; the inherited `site/assets/site.css` and `site/content.json` were reviewed only at the fork's changed hunks. No upstream code or generated locale pages changed.

## Changes

- `site/play/fmp4.js`: `box()` now computes the body length and concatenates the header and original parts directly. Previously it allocated an intermediate body and copied every part into it, then copied that body into the final box. This removes that intermediate typed array and copy for each MP4 box, including the boxes built for every MSE video frame. Box order, size encoding, output ownership and public exports are unchanged. No measured throughput or latency claim is made.
- `site/play/sw.js`: cache version v3 → v4, as required by its existing cache-update instruction whenever a cached asset changes.

## Review coverage and performance findings

- `app.js`, `decoder-worker.js`, `video.js`, `mse.js`, `fmp4.js`, `link.js`: followed network reads through record parsing, worker transfers, decoder configuration/output, canvas rendering, MSE conversion/append, touch slots and the control outbox. Whole record payloads are already views; split payloads receive one copy. Chunk transfers already avoid a copy when their buffer holds only that chunk. JSON config parsing occurs per configuration rather than per video frame. Decoder replacement closes the old decoder and rejects its stale output; the presenter closes the prior frame when taking ownership of a new frame.
- Bounds remain unchanged: record payload cap 8 MiB, decoder/MSE queue thresholds 30, decode timing map 120 entries, sample windows 240/64, touch slots two, and control outbox normal push limit 64. Touch moves already coalesce through animation frames and the outbox; changing the two-contact allocation/sort helpers would be speculative. Existing retry, heartbeat and keyframe-request policies are preserved.
- `appearance.js`, `sw.js`, `index.html`, `style.css`, `icon.svg`: reviewed init, cache/resource declarations, listener setup and static structure; no extra cleanup justified. Inherited stylesheet changes are a branding comment only. Inherited content changes consistently implement branding, links, package identity and removal of Telegram entries; no structural defect found.
- Reviewed all seven browser test files, including golden protocol records, box layout/sample offsets, touch order/outbox recovery, decoder stale output, appearance and site assembly. Retained their behavioral assertions unchanged.

## Open decisions (not changed)

1. `app.js` `pumpChunks()` and `decoder-worker.js` `feed()` forward/enqueue chunks without acknowledgement or checking consumer demand. A producer can outrun a stalled worker/configuration await; decoded frames transferred to a busy main thread likewise have no explicit delivery bound. Adding backpressure or dropping messages requires a queue/ordering policy and fallback-path browser tests, outside behavior-preserving cleanup.
2. `video.js` and `mse.js` `stop()` stop record reads but retain the configured decoder/media, statistics intervals and last displayed frame. This supports reconnect/resize reuse, but retains resources while disconnected and permits pending decoder configuration/output to finish. A distinct final-disposal lifecycle needs an explicit decision and reconnect/page-cache tests; blindly closing on every stop changes behavior.
3. `mse.js` owns a new object URL only in a local variable while awaiting `sourceopen`; `close()` can revoke only `media.url`, which is assigned after that await. If a pending generation is replaced, its early return does not revoke that URL, and a missing `sourceopen` can leave the configuration promise pending. Correcting pending-source ownership/cancellation changes lifecycle behavior and should be handled with targeted asynchronous MSE tests.

## Verification

- `node --test tests/web/*.test.mjs` on available Node v24.19.0: six test files passed (`appearance`, `fmp4`, `link`, `page`, `records-v1`, `video`); `site.test.mjs` failed because sandboxed `execFileSync` reports `spawnSync python3 EPERM`.
- Ran `node tests/web/site.test.mjs` to identify the failure: all three site tests hit that same child-process infrastructure restriction. The child assembler reports successful assembly and exit status 0, but Node rejects the spawn result. No application assertion failure was reached. CI specifies Node 22; this workspace provides Node 24.
- `node --check site/play/fmp4.js`, `node --check site/play/sw.js`, and scoped `git diff --check` passed.
- Coordinator owns Android CI and final repository verification. No new tests were added for the small concatenation cleanup; existing MP4 structural and golden-stream tests cover its outputs.

## Coordinator verification follow-up

The earlier local infrastructure blockers above are historical. JDK/SDK setup is now fixed, and the full required Android test/lint/build command passed (2,177 tests, zero failures/errors/skips). Full browser unit suite passed 50/50; RealPhone.java compilation passed. Optional fake-phone E2E still fails the stats-event assertion, recorded separately in README.md. See README.md and ENVIRONMENT.md for final results and repeatable setup.
