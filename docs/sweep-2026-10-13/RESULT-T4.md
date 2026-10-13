# T4 result

Status: complete; coordinator full browser verification passed.

## Changes

- `site/play/pcm-timeline.js`: replace the per-sample `Array.some` callback in `active(time)` with an indexed early-return scan. The audio worklet calls this for each output sample of each non-music timeline. The internally maintained queue is dense; scanning order, interval boundaries, overlap behavior and lack of queue mutation remain identical. This removes a callback expression from the sample loop; no measured throughput or latency gain is claimed.
- `site/play/audio-protocol.js`: remove a redundant `size < headerSize` check. The record size has already passed the identical 24-byte minimum before its payload is read; malformed/truncated behavior is preserved.
- `site/play/video.js`: remove the unused canvas-width destructuring binding during GPU drawing.
- `site/play/sw.js`: bump the cache version from v31 to v32 as required by its asset-update contract, so existing cached pages receive these changes.

## Performance and ownership review

Reviewed the in-scope browser decoder, presenter, media timing, PCM parsing/capture, worklet mixing, touch/control, statistics, release scripts and workflow/build hunks. Existing bounds remain: decoded frames 60; decoder timestamp bookkeeping 120; PCM timelines 160 packets plus time bounds; microphone upload queue 5 packets; one control POST in flight and 64 queued events. Touch moves remain coalesced to animation frames. Rendering retains one frame and closes retired/expired frames; worker transfer acknowledgement, audio credit generations, capture cancellation and timing plans remain unchanged.

PCM record assembly currently copies into a record buffer and then copies PCM into a dedicated transferable buffer. Eliminating the latter copy would require changing the worker-message payload/offset contract and checking transfer ownership; it was not folded into this cleanup. Timeline scans and channel sample calculations remain in the worklet because changing their ordering or caching state could affect overlapping packets, consumed-credit callbacks and ducking. GPU texture uploads, clock cutoffs, queue limits and frame-drop policy remain as implemented.

Build/workflow changes are restricted to the recorded incremental hunks for review; no source edits were warranted. No locale HTML or generated output was modified.

## Test retirement

Removed tests: none. Current web source-shape checks protect still-active page layout, debug and cache contracts. Behavioral tests cover current connection, permission, protocol, rendering, PCM timing and worker ownership regressions; feature completion alone is not evidence of redundancy. E2E fixtures exercise the supported phone + browser product and fallback paths. Native JNI boundary checks and release-draft tests protect current behavior and remain intact. Historical scope entries for already-removed fMP4/MSE files were not restored.

## Validation

- Node 22.23.3 focused browser checks, using `node --test --experimental-test-isolation=none tests/web/audio.test.mjs tests/web/media-timing.test.mjs tests/web/video.test.mjs tests/web/page.test.mjs`: 57 passed, 0 failed. Includes actual worklet mixing/ducking, ramps, PCM framing, GPU expiry/resource release and service-worker assets.
- Full required `node --test tests/web/*.test.mjs`: 15 test files passed; only `tests/web/site.test.mjs` failed. Running the full suite without process isolation exposes 125 passed and 3 failed tests, all three site-assembly cases failing with `spawnSync python3 EPERM`. This is an execution-sandbox subprocess restriction, not an assertion failure. The out-of-incremental-scope site test was not changed. The coordinator subsequently reran the full suite with local subprocess permissions: 128/128 passed.
- `python3 -m unittest discover -s tests -p test_release_draft.py`: 9 passed, no network calls (mocked delivery).
- `git diff --check` for T4-owned source paths passed.
- No Gradle run by this task; the coordinator owns the required Android checks. Browser E2E was reviewed, not executed; focused deterministic worklet/presenter tests cover the edited paths. No physical iPhone/vehicle measurements or performance benchmark was performed.

## Open decisions

No new behavior-changing defect established in this review. A future PCM copy reduction would require an explicit transport-ownership change and matching browser coverage. No queue policy, timeout, protocol or lifecycle decision was silently changed.

## Coordinator final verification

Full required Android tasks passed after retirement: 1327 shared + 1093 common + 4 home = 2424 tests, zero failures/errors/skips; mobile/home/maphost lint and debug APK builds passed. Node suite 128/128 passed. Scope and final source review passed; see README.md, REVIEW.md and ANDROID-TEST-SUMMARY.json. No commit or push.
