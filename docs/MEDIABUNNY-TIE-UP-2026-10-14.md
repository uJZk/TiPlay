# Media playback tie-up — 2026-10-14

The user invoked tie-up and explicitly requested skipping builds. Cleanup,
commit, main integration, push and the existing Pages delivery are authorized.
The user also requested including the pre-existing screenshot deletions.

## Playback and compatibility

Mediabunny and WebCodecs supply decoded media; TiPlay owns Canvas, Web Audio,
the clock, buffering and seek. Video.js supplies native controls, loading and
automatic hiding, without volume, plus a matching Stop button. HLS WebVTT uses
the maintained hls.js parsers and an independent, cancellable subtitle path.
Authoritative dependencies and licenses are in the vendor build inputs and
notices. Durable contracts are in [AIRPLAY.md](AIRPLAY.md) and
[the playback boundaries](VIDEOJS-10-2026-10-14.md).

Pause preserves the selected speed. Rate-aware Android directives and reports
carry the actual rate. An older APK's directives omit rate and must preserve
the browser's selection; accurate iPhone rate feedback requires updating the
APK too. Independent seek revisions keep later pause/play commands from
undoing an earlier seek. Embedded, encrypted and fragmented MP4 subtitles
remain outside the separate WebVTT path. Mirror captions already rendered
into the transmitted picture do not require that path.

## Validation and cleanup

Before this tie-up, all nine required Android CI tasks passed: shared 1,847,
common 1,503 and Home 6 tests (3,356 total, no failures/errors/skips), plus
the three apps' lint and debug assembly. Node 22 passed 152 browser tests.
Desktop Edge checks passed actual MP4/HLS decoding, WebGL/2D rendering, seek,
speed, authenticated bilingual subtitles and native language selection,
mute, stop, cleanup, diagnostics and offline module loading. Public-tree
validation and nine release-draft tests also passed.

This tie-up reuses those outputs and does not run Android or vendor builds.
A final browser compatibility regression checks that an older APK's pause/play
does not reset 2x. All 31 affected browser unit tests, both actual-playback and
page/offline E2E checks, offline-manifest/vendor-hash validation, documentation
word limits and `git diff --check` passed after that JavaScript correction.
Existing fixtures were unchanged and test-owned Edge processes were closed.
Pages uses cache v42.

The temporary validation container cap was 4 GiB within the user's 16 GiB
total WSLC budget. Its original limits were restored after validation; the
specific WSLC session was terminated and its Windows VM process disappeared.
Global WSLC/WSL configuration was not changed. Session-generated Python
caches were removed; local drivers, fixtures and logs remain ignored under
`agent_docs/mediabunny/`. Deleted screenshot links were removed with the images.

## Delivery and follow-up

The source starts on main, so no worktree or feature-branch merge is needed.
Commits use `[skip ci]` to honor the requested build skip; the existing
`pages.yml` workflow is dispatched separately for the exact main commit.
Its static site assembly publishes the already generated browser dependencies.
No APK rebuild, draft replacement, APK release or device installation is part
of this tie-up. The existing downloadable APK therefore keeps its previous
Android rate-feedback behavior until a later APK delivery.

Real iPhone/vehicle checks remain in [todo.md](todo.md): browser codec support,
long playback, performance and acoustic audio/video synchronization, subtitle
alignment, authenticated/direct resource reachability and recovery after live
segments expire. Desktop checks cannot establish those device results.
