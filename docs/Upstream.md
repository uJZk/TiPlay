# Upstream

Read this document before changing inherited code or updating the upstreams below.
TiPlay supports Android phone + car browser use only.

## Upstreams to track

| Upstream | Used for | Current baseline / provenance |
| --- | --- | --- |
| [DiPlay](https://github.com/shihabal3amri/DiPlay) | CarPlay receiver and shared Android code | Git merge ancestry; see `CHANGELOG.md` for merged releases. |
| [Video.js](https://github.com/videojs/video.js) | Browser MP4/HLS playback, including bundled VHS | `8.24.1`; [vendored files and update instructions](../site/play/vendor/videojs/README.md). |
| [UxPlay](https://github.com/FDH2/UxPlay) | Ordinary AirPlay protocol reference, `playfair` transport keys and FairPlay reply tables | `ec203121355220dd90278a369eeabb0b8ba4f14a`; [native provenance](../shared/src/main/jni/airplay/README.md). |

When updating these components, review upstream releases and changes since the recorded baseline,
especially security, protocol compatibility, playback and lifecycle fixes. Adopt relevant changes,
then update the baseline, provenance, license notices and validation record together. Tracking an
upstream does not mean automatically upgrading it or merging its entire application.

## Maintenance rules

- DiPlay updates flow into TiPlay only. Send no pull requests or patches to DiPlay;
  disable pushes and tag fetching on its remote.
- Put TiPlay features in new files; limit inherited-file edits to small hooks.
  Remove TiPlay-owned duplicate or unused code while preserving future upstream reuse.
  Do not rename, move, reformat or delete inherited files or identifiers.
- Preserve packages, classes, Android resources, preferences, log/thread names,
  intent actions, `DIPLAY_AUTH_ASSETS_DIR` and `rootProject.name`. Keep
  `com.shilapi.xcertplay`, `com.shihab.diplay.action.EMBED_MAP` and
  `com.shihab.diplay.DISCONNECT`; TiPlay's application ID remains `com.ujzk.tiplay`
  (`.hudtest` for debug). Keep TiPlay preference and browser storage keys stable too.
- Current issues, releases and downloads point to `https://github.com/uJZk/TiPlay`; the hosted page is `https://ujzk.github.io/TiPlay/`. Preserve dated destinations and upstream provenance.
- Browser HEVC, AirPlay and VPN labels are intentionally concise, without experimental suffixes. Preserve inherited locale text unless explicitly changed.
- User-visible names use TiPlay. Keep DiPlay in credits, archived READMEs, historical
  release/audit records and source comments. Never globally replace DiPlay with TiPlay.
  Link numbered upstream issues, PRs and commits to their original repository.
- Preserve phone + browser session, media, permission and connection contracts.
  Keep native head-unit behavior gated and its settings hidden. Do not restore APK-bundled
  browser pages or local `/play/` routes; the browser page is hosted over HTTPS.
- Keep TiPlay strings in separate resource files and translate every supported locale.
  Retain upstream identifiers and licenses; resolve naming collisions in TiPlay-owned additions.

## Updating DiPlay

Configure the remote once:

```sh
git remote add upstream https://github.com/shihabal3amri/DiPlay.git
git remote set-url --push upstream DISABLED
git config remote.upstream.tagOpt --no-tags
```

Start from a clean worktree, fetch both remotes, review the upstream changelog and diff,
then merge on a branch:

```sh
git fetch origin
git fetch upstream
git log --oneline origin/main..upstream/main
git diff --stat origin/main...upstream/main
git switch -c upstream-sync origin/main
git merge --no-ff upstream/main -m "Merge upstream DiPlay <version or short commit>"
```

Keep upstream improvements and reapply TiPlay hooks when resolving conflicts. Inspect TiPlay's
changes from the common base rather than relying on an old file-by-file conflict inventory.
Check configuration fields, preference/resource collisions, session teardown, product gates,
branding and all locales even when Git reports no conflict. Preserve TiPlay's root READMEs,
AGENTS index, application ID, release provenance and hosted browser delivery.
Record the merged version in `CHANGELOG.md` and `RELEASE-NOTES-NEXT.md`.

Use a merge commit; do not rebase `main`, squash the upstream merge or cherry-pick upstream
commits. Commit product adaptations separately. After validation, fast-forward `main` to the
integration branch and push only to `origin`.

## Updating Video.js and UxPlay

**Video.js:** select an explicit release, download its official npm tarball and verify published
integrity. Update the JS, CSS, translations and license together under `site/play/vendor/videojs/`.
Review bundled VHS changes. Verify MP4/HLS playback, seeking, buffering, resource proxying,
iPhone playback controls and offline assets. Keep the deployed version pinned; use no runtime CDN.

**UxPlay:** compare against the pinned commit and port relevant protocol fixes into TiPlay's
Android adapters. Update copied native modules and reply tables with their licenses/provenance.
Keep the desktop/GStreamer renderer outside the Android integration. Verify pairing, transport-key
exchange, mirroring/audio, HTTP video, discovery and CarPlay pause/resume isolation. This transport
key exchange does not provide FairPlay Streaming licenses or DRM video support.

## Validation and references

Run the checks in [AGENTS.md](../AGENTS.md) and [BUILD.md](BUILD.md#check-the-source-build),
including browser tests and `python3 scripts/check_public_tree.py`. For UxPlay native changes,
also run `python3 scripts/test_airplay_native.py`. Regenerate changed site outputs and verify
the hosted browser entry. Record real iPhone/car checks and any untested behavior separately.

- [AirPlay contracts and validation](AIRPLAY.md)
- [Credits and licenses](THIRD_PARTY_NOTICES.md)
- Original xcertplay README archives: [English](UPSTREAM-README.md), [中文](UPSTREAM-README.zh-CN.md).
  Their native head-unit instructions describe upstream history, not TiPlay's supported product.
