# C3 browser and web-test result

## Scope and review

Reviewed the 178 files assigned in Scope-C3-1.md against baseline `91430639..5c47dd00` and STANDARDS.md. Coverage comprises 158 JavaScript modules, six CSS files, two HTML files, eight JSON fixtures, two C files, one C++ fixture generator and one Java harness. All assigned JavaScript modules were parsed for declaration/reference and duplicate-literal candidates; fixture JSON was parsed. Changes and current code received proportional inspection, with deeper review of browser startup, transport/frame ownership, audio dispatch and decode, output clocks, NetEq/Worklet hot paths, AVPlayer disposal and control adapters, diagnostics, photo/artwork bounds, consent and location lifecycle. Vendor and generated assets were excluded.

## Changes

Seven code/test files changed mechanically:

- `site/play/app.js`: removed an unused transport import and unreachable HTTP-error helper; corrected a comment that still described a live WebCodecs fallback.
- `site/play/browser-diagnostics.js`: removed seven repeated summary-key literals. The existing Set already removed them; all 140 unique keys retain their original order and priority.
- `site/play/airplay-fetch.js`: replaced the retired serial-scheduler explanation with the actual optional-deadline contract.
- `tests/web-e2e/phone-run.mjs` and `tests/web-e2e/run.mjs`: removed an unused sleep helper and filesystem import.
- `tests/web/audio.test.mjs` and `tests/web/audio-diagnostics.test.mjs`: removed unused timing/buffer imports and an unused render-time helper.

Retained exported compatibility APIs, deliberate object-rest omissions used to exclude secrets/internal fields, unused loop bindings needed to consume async iterators, and test harness bindings referenced by dynamically extracted functions. No protocol, stored key, queue bound, clock policy, cancellation order, consent, capture privacy, ownership or AVPlayer/Canvas behavior changed. No performance gain is claimed.

The coordinator owns the required browser cache/diagnostic version refresh from v97 to v98 and full integration checks. Those metadata lines were not edited by C3.

## Verification

Passed:

- `node --test tests/web/audio.test.mjs tests/web/audio-diagnostics.test.mjs tests/web/page.test.mjs tests/web/rtc-diagnostics.test.mjs tests/web/touch-latency.test.mjs`
- `node --test tests/web/browser-diagnostics.test.mjs tests/web/airplay-photo.test.mjs tests/web/airplay-sdr.test.mjs tests/web/airplay-avplayer.test.mjs`
- `node --check tests/web-e2e/run.mjs` and `node --check tests/web-e2e/phone-run.mjs`.
- Ad hoc before/after comparison of deduplicated diagnostic key lists: identical values and order.
- JavaScript parsing, JSON parsing and `git diff --check`.

Full web/Android checks remain coordinator-owned. Chromium end-to-end harnesses and physical phone/vehicle acceptance were not run by C3.

## Open decisions

`tests/web-e2e/run.mjs` still assumes the former compressed-video DataChannel/WebCodecs architecture: its VP8 `VideoDecoder` hardware-support gate, worker/main path names, `decodedFps` and scheduled-presentation fields, and compressed-media assertion disagree with the current RTP/MediaStreamTrackProcessor/Canvas runtime. See its hardware gate around line 268, compressed-media assertion around line 297 and presentation assertions around line 224; the current pipeline in `site/play/rtc-video.js` rejects compressed FRAME records. Updating or retiring those executable assertions changes test contracts and needs a separate decision. They were preserved; the unused import cleanup does not claim that this harness currently validates the production video path.
