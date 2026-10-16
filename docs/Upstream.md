# Upstream maintenance

TiPlay is a GPL-3.0 derivative of [DiPlay by shihabal3amri](https://github.com/shihabal3amri/DiPlay), formerly xcertplay. Its supported product is Android phone plus car browser. Preserve original copyright, license and provenance notices; see [third-party notices](Third-party-notices.md).

## Tracked components

| Upstream | Role and baseline |
| --- | --- |
| [DiPlay](https://github.com/shihabal3amri/DiPlay) | CarPlay/shared Android source; full merge ancestry through `c30d3f0df18dd132739d864a9e054c73b3d57d8c` (0.2.19 plus main fixes). |
| [Video.js](https://github.com/videojs/video.js) | Browser controls/media adapter; [pinned inputs and update procedure](../site/play/vendor/videojs/README.md). |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | URL demuxing/WebCodecs, with SoundTouch and hls.js helpers; [provenance/licenses](../site/play/vendor/mediabunny/README.md). |
| [FDK AAC](https://github.com/mstorsjo/fdk-aac) | Third-party modified AAC-ELD browser fallback; [source, modifications and license](../site/play/vendor/aac-eld/README.md). |
| [UxPlay](https://github.com/FDH2/UxPlay) | Ordinary AirPlay protocol reference and native transport-key modules; `ec203121355220dd90278a369eeabb0b8ba4f14a`, [native provenance](../shared/src/main/jni/airplay/README.md). |

Review security, protocol, playback and lifecycle changes since each baseline. Update adopted code, pins, provenance, licenses and validation together. Source ancestry and the runtime identity selected for an APK are separate; see [Build](Build.md#runtime-identity).

## Preserve merge compatibility

- Updates flow from DiPlay into TiPlay only: no upstream patches/PRs; disable upstream pushes and tag fetching.
- Prefer new files for TiPlay features and small hooks in inherited files. Do not rename, move, reformat or delete inherited source/identifiers. Remove unused TiPlay-owned code.
- Keep packages/classes/resources, preference and browser-storage keys, log/thread names, intent actions, `DIPLAY_AUTH_ASSETS_DIR` and `rootProject.name`. This includes `com.shilapi.xcertplay`, `com.shihab.diplay.action.EMBED_MAP` and `com.shihab.diplay.DISCONNECT`. Application ID remains `com.ujzk.tiplay` (`.hudtest` for debug).
- User-facing names use TiPlay; retain DiPlay in credits, historical records and source comments. Keep numbered upstream issue/PR/commit links on their original repository. Current project links use `https://github.com/uJZk/TiPlay` and `https://ujzk.github.io/TiPlay/`.
- Preserve phone/browser session, media, permission and connection contracts. Gate retained native behavior and hide its settings. The page is hosted over HTTPS; do not restore APK page assets or a local `/play/` route.
- Keep TiPlay strings separate and translated in every locale. Browser HEVC, AirPlay and VPN titles intentionally omit experimental suffixes; retain inherited locale text unless explicitly changed.

## DiPlay merge procedure

Configure the one-way remote once:

```sh
git remote add upstream https://github.com/shihabal3amri/DiPlay.git
git remote set-url --push upstream DISABLED
git config remote.upstream.tagOpt --no-tags
```

At releases or short regular intervals, start from a clean worktree, fetch origin/upstream, review the changelog and changes since the common base, then create an integration branch from `origin/main` and merge `upstream/main` with `--no-ff`.

Keep upstream improvements and reapply TiPlay hooks. Inspect configuration, preference/resource collisions, teardown, product gates, branding and locales even without conflicts. Preserve TiPlay's root documentation, application identity and hosted browser delivery. Record the adopted version and validation in [Changelog](../CHANGELOG.md).

Retain the merge commit and put product adaptations in separate commits. Do not squash, cherry-pick or rebase the upstream merge. After validation, fast-forward `main` to the integration branch and push only to origin.

## Browser and receiver updates

For Video.js and bundled media dependencies, select explicit releases and verify npm integrity using [pinned build inputs](../scripts/videojs/package.json) and lockfile. Rebuild self-hosted bundles, translations and license notices. Keep runtime dependencies pinned without a CDN. Check MP4/HLS, seeks, buffering, subtitles, authenticated resources, iPhone controls and offline assets.

For UxPlay, port relevant protocol fixes into Android adapters, preserving native licenses and reply-table provenance. Exclude desktop/GStreamer rendering. Verify pairing, transport keys, discovery, mirroring/audio, HTTP video and CarPlay borrow/return isolation. Transport-key exchange does not supply FairPlay Streaming licenses or DRM support.

Run [required source checks](Build.md#check-the-source-build), applicable [browser/device checks](Testing.md), and `python3 scripts/test_airplay_native.py` for native AirPlay changes. Regenerate changed site outputs. Record actual iPhone/car evidence and untested behavior separately.
