# Sweep delivery

## Current status

Code and documentation cleanup is committed as `4b89fc7d7e88a1e9c1824fef0cf4f7b4bcd98872`, fast-forwarded into main and pushed. The temporary work branch was deleted. The initial v98 page was published and independently byte-verified. Full local Android verification and cloud Android/WASM CI passed. Both sweeps are complete; their final source baseline is that cleanup commit. The initial receipt was documentation-only and used `[skip ci]`. Subsequent user-authorized repairs are recorded below; v99 is now published from `1bc4eb793f9e2b3d6085f10a434dfa7842f9bcd2` and independently byte-verified.

## Initial sweep decisions and scope

- Fast-forwarded the clean `work` branch from `dccb1c3e` to remote `5c47dd009c7b88e2edadfe77625dfbdf17697d02` (four commits).
- Recovered code baseline `91430639` from the deleted completed 2026-10-13 record. Documentation baseline is `4bdffcd6`. Reviewed 1,241 current code/test/config files and 45 documents; focused/manual and whole-scope mechanical coverage are distinguished in worker reports.
- Only behavior-preserving cleanup was applied. Cache and diagnostic identifiers advance together from v97 to v98 because page sources changed. APK remains beta.24/code66; no signed release is needed for this cleanup.
- Kept only the newest record for each sweep type; older records remain in Git. Renamed three guides and repaired inbound references under the existing naming standard.

## Verification

- Complete final browser suite: 598 passed, zero failures/skips, Node 24.19.0 (CI uses Node 22).
- Complete Python discovery: 33 passed.
- AirPlay native JNI checks, seven SRP checks, native Soxr source reproduction, RTC ABI/notice hashes/alignment and AVPlayer artifact integrity checks passed.
- Site generation/assembly, offline runtime manifest and public credential scan passed.
- Independent code review confirmed mechanical equivalence, scope compliance and unchanged ordering of all 140 unique diagnostic summary keys.
- Complete required Android command: **BUILD SUCCESSFUL in 25m 13s**, 251 tasks executed; shared 2,466, common 1,863, home six: **4,335 tests, zero failures/errors/skips**. Mobile/home/maphost Debug lint and assemblies all passed. Used the workflow's single-worker/memory policy with an isolated JDK 25/SDK/Gradle cache and system CA/proxy settings.
- Initial Android setup stopped before tests because Gradle encountered the NDK while SDK installation was unfinished. Retrying after installation resolved that setup failure; no source workaround or test omission was needed.
- The final 414 local Markdown links/anchors, documentation word limits and whitespace checks passed. Three additional scope pages record all 778 current code paths changed over the exact documentation range and map them to the reviewed guides.
- Fresh-class native Soxr/Kotlin signal, packet-boundary, JNI, queue/deadline, retirement and concurrency checks passed. Encoded host RTC checks were not rerun because host libraries are unavailable; no encoded transport logic changed.
- [Pages 40367405686](https://github.com/uJZk/TiPlay/actions/runs/40367405686) passed. All 217 public files (31,811,194 bytes) match the exact assembly; script/WASM MIME types and no redirects verified.
- [Android/WASM CI 40367405720](https://github.com/uJZk/TiPlay/actions/runs/40367405720) passed: both `check` (27m 37s) and `wasm` (2m 3s) succeeded, including Node 22 browser checks, full Android tests/lint/debug builds, native Soxr streaming checks and byte-identical WASM reproduction.
- Owned download scratch, assembled-site output and temporary sweep scripts were removed; no session build processes remain. Reusable SDK/JDK/Gradle caches, machine-local SDK selection and verification logs remain ignored; no credentials or build outputs are committed.

## Follow-up repairs

The user subsequently requested fixes for both deferred findings. The issue forms
now route current reports to TiPlay and collect Android-phone/car-browser context.
The general E2E harness and synthetic phone now use real H.264 RTP,
metadata-only video DataChannel records, actual Canvas pixels and source-generation
barriers. Old VP8/WebCodecs/pacer assertions and live hardware-preference overrides
were retired; pairing/privacy, touch/viewport, Debug/portal, reconnect/takeover,
localization, nested hosting and Service Worker/offline coverage remain.

The new real-browser test reproduced a production source-switch deadlock: stopping
the initial BUNDLE-leading video transceiver reset DTLS/SCTP before the in-band
`video-offer` could leave. The browser now retains that transceiver inactive,
stops the old receiver track and creates a distinct replacement track. Later
non-anchor transceivers stop normally. Authenticated identity, SDP limits and
generation/ready gates remain; peer closure releases the inactive anchor.

Follow-up verification:

- Final v99 production-page E2E passed **116 checks**, including actual red/blue
  pixels after two source changes, all current Worker/chunk/main presentation
  paths, terminal encoder-error and compressed-record rejection with live controls,
  secure reconnect, takeover and offline pairing-link reopening.
- A separate real RTP main/Worker Processor-to-Canvas run passed. The standalone
  source fixture also passed two generations, error isolation, control continuity
  and complete track/peer/ICE-waiter retirement. No WebCodecs decoder or local-track
  substitute was used for these RTP results.
- The managed `/usr/bin/chromium` still has its original policy; its negative run
  exits nonzero with `RTP E2E blocked: no-local-candidates`, never a playback pass.
  Successful RTP runs use a separately installed official Playwright test browser
  with default settings, without policy-file or network-policy changes.
- JVM compatibility/shared-server and secure-production-refusal checks passed.
- All **605 browser and harness-helper unit tests**, **33 Python tests**, form YAML/schema checks and independent production lifecycle review passed. Site assembly, offline-cache and public-tree checks passed.
- The required complete Android command passed in **9 seconds**, 251 tasks
  (12 executed, 239 up-to-date). Android source/build inputs are unchanged; the
  previously passed 4,335 Android results remain applicable. The web-only follow-up
  uses `[skip ci]` and manual Pages publication after local source checks; the old
  cloud CI run above certifies its own initial sweep source, not a new run.

Publication completed through [Pages 40425187334](https://github.com/uJZk/TiPlay/actions/runs/40425187334)
from `1bc4eb793f9e2b3d6085f10a434dfa7842f9bcd2`. All 217 public files
(31,811,563 bytes) match the committed assembly; JavaScript/WASM MIME types and
no redirects were verified. This follow-up changes no APK release/version.
Temporary assembled-site output and verification scripts were removed after
verification; reusable test-browser/toolchain caches and result logs stay ignored.

## Remaining acceptance

Both deferred software findings and the discovered BUNDLE source-switch deadlock are resolved. Browser v99 is published and verified; no software decision remains open from this work.
Physical iPhone/vehicle interoperability, Android JNI encoder switching, actual
hardware decoding, speaker/panel latency and sustained vehicle playback remain
unperformed acceptance. Desktop synthetic RTP cannot establish these results.
