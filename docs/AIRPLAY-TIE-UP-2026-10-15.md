# AirPlay remote integration and delivery, 2026-10-15

The receiver improvements in [the implementation record](AIRPLAY-RECEIVER-2026-10-14.md)
are integrated with remote main through `4eba6096`:

- `090c529c`: confirmed CarPlay main-screen borrowing and mixed audio.
- `4eba6096`: temporary browser location diagnostic page at `nav-test/`.

## Integration decisions

Keep the CarPlay `changeModes` / `modesChanged` ownership state machine, event-channel
command handling, input gates, and bounded mirror-SETUP wait. A transport-only SETUP
can request a provisional loan before the screen stream appears. Once identified as
standalone audio, release the visual producer and return that loan. No audio resource
loan is requested. URL videos retain play/pause/seek intent across ownership changes.

Photo ownership now gates the browser's original-image presentation. The remote
Android photo encoder, surface bridge and encoded-photo keyframe requests are obsolete
and were removed; photo resources survive ownership changes without re-encoding.

Retain independent CarPlay and ordinary AirPlay audio producers and browser timing.
The ordinary path uses encoded audio on its dedicated stream, with isolated epochs,
queue overflow and teardown; CarPlay streams retain their own buffered music and
navigation behavior. Disabling CarPlay audio does not disable ordinary AirPlay audio.
Browser decoding and demand-switched Android HFP/SCO behavior follow the implementation
record. Do not reintroduce the old Android AAC decoder or 44.1 kHz/stereo-only guard.

Retain the temporary location diagnostic page as an independent remote addition.
It stays outside the main page's offline cache. The merged player cache is `v44`,
newer than the remote `v43` and the pre-merge local `v43`.

## Final verification and delivery

- 231 browser unit tests passed after integration.
- Real Chromium 151 AAC-LC and Opus decoding passed, including ordinary AirPlay
  stream 6 and decoded-output sequence retention.
- Public-tree credential screening, nine release-draft tests and FairPlay JNI
  boundary checks passed.
- Android production and unit-test sources compiled. The initial build stopped
  during lint after the browser integration blocker below. The user subsequently
  authorized skipping the remaining complete Android checks; the restarted run was
  canceled as requested. Final lint/APK and full Android tests were not completed
  for this merge. The restarted shared-module suite completed 1,944 tests with zero
  failures/errors before cancellation. Earlier implementation-stage results do not
  replace the skipped complete check.
- An extra smoke loaded the actual browser entry, including its CSP, then exercised
  photo ownership with a valid EXIF-oriented JPEG. The page starts and ownership
  hide/show/reuse worked, but the image initially did not decode: the CSP blocked
  the photo presenter's `blob:` URL. Earlier presenter smoke used an isolated page
  without the production CSP. The fix adds `blob:` only to `img-src`.
- The checked-in `tests/web-e2e/airplay-photo.mjs` now loads the real entry/CSP and
  verifies an original JPEG through the authenticated resource route: EXIF rotation
  gives 80×120, contain fitting and ownership hide/show/reuse pass, only one resource
  fetch occurs, and there are no CSP violations or page errors. Chromium 151 passed.
  All 231 browser unit tests also passed after the CSP fix.
- Delivery initially stopped at the verification gate. The requested CSP repair
  resolved that blocker; delivery completed with the user's explicit Android-check
  exception. Implementation checkpoint: `86fe366a`.
- Integration commit `876de51faa5110517bf7fa52ac2bb32053badae3` preserves both remote
  commits in merge ancestry. Local `main` was fast-forwarded, temporary branch `work`
  was deleted, and main was pushed to origin without force.
- [Publish site run 38659959803](https://github.com/uJZk/TiPlay/actions/runs/38659959803)
  completed successfully for that integration commit. Pages deployed the fixed entry
  and cache `v44` to <https://ujzk.github.io/TiPlay/>. A public HTTP revisit could not
  be verified from this environment: the configured proxy rejected the Pages host
  with CONNECT 403. The deployment-success statement is based on GitHub's run result,
  not a claimed live-page byte comparison.
- Generated site assembly passed. Public-tree checks and release-draft tests passed;
  no Android installable release or signed APK was published in this tie-up.

Existing implementation-stage results and real-device limits remain in the
implementation record. A local browser/Android test is not an iPhone or vehicle
acceptance test.
