# Follow-up: codec-only Debug and hosted browser page

The user requested restoring the absence of hardware/software labels, then explicitly requested removing the app's bundled page. These are authorized follow-up changes after the completed sweep. The user then invoked tie-up; main integration and delivery are recorded in TIE-UP.md.

## Implementation

- Debug keeps four fields, with codec alone first: `HEVC · 60 fps · 5 ms · 34 ms`. Hardware/software labels and the formatter's unused language argument are removed. Service Worker cache is v16.
- Removed `BundleBrowserPage` and its generated asset source registration. Removed the Android asset loader and asset parameter from the app server factory.
- Removed local root/page redirects, static file loading, MIME/CSP tables, page-file diagnostics and the unused native phone-page link helper. The phone now serves `/hello`, `/video`, `/control` and `/bye` only. GET `/`, `/play` and `/play/*` return 404.
- Removed browser address inference that treated a plain-HTTP page origin as the phone. Hosted links use `?t=`, saved settings or the default phone address.
- Updated the package-assets regression and replaced obsolete static-page server tests with 404/health/keep-alive checks. The real App protocol E2E now uses a separate page host; fake-phone static serving is removed.
- Updated current browser documentation, UI notes, todo, AGENTS.md and E2E instructions. HTTPS hosting and its browser Service Worker provide the page and offline reopening; no local page is shipped in the APK.

## Verification

- Node 22 browser tests: 64/64 passed; JavaScript harness syntax and public-tree checks passed.
- Both browser E2Es passed independently after the initial concurrent runs: actual App protocol checks verify removed routes, independent page hosting, decoding, touch, fit, recovery, session restart, CORS and pairing-data redaction. Fake-phone checks include the codec/FPS/latency banner and offline Service Worker behavior.
- The first Android run found one test call retaining the removed factory argument; corrected it. Shared tests passed, with 1219 tests and zero failures/errors/skips. Final post-main-integration Android CI passed with 2268 tests, all three lint tasks and all three debug APKs. Final post-integration browser tests passed 65/65 and both E2Es passed; all three APKs contain zero browser page assets. See TIE-UP.md and its final evidence files.
- An initial browser run alongside Android work did not observe a decoder error from injected garbage; an initial App-protocol E2E timed out waiting for decoded frames after restart. Independent reruns passed without relaxing assertions or changing production recovery. Host contention is possible but is not established as the cause. Initial failure logs are retained separately.
- This record predates the user's tie-up authorization; see TIE-UP.md for commit, merge, push and Pages delivery.
