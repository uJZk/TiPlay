# README presentation

## Current content

The English and Simplified Chinese root READMEs share the same structure:
overview, feature list, screenshots, installation, usage, help, contributing and
license credits. Edit both languages together.

The feature list prioritizes browser location with coordinate-system detection
and conditional GCJ-02 → WGS84 conversion, resilience to network jitter, and
browser-side audio/video decoding without an extra transcoding stage. USB and
wireless CarPlay, browser touch control, adaptive display and audio/call support
complete the list. Implementation references are [Geolocation](geolocation.md)
and [Browser](Browser.md).

Credits retain DiPlay/xcertplay receiver lineage and link component license
notices. The README has no separate upstream-components list or UI-origin
description. Detailed provenance remains in [Upstream](Upstream.md) and
[Third-party notices](Third-party-notices.md).

The maintainer confirmed both audio routes and AirPlay have been validated.
The README therefore omits pending audio-acceptance wording and the experimental
AirPlay label. This documentation change did not perform new physical-device
tests or assert compatibility with every vehicle/browser combination.

## Screenshot sources

Four presentation PNGs live in `site/assets/screenshots/`:

| Image | Presentation |
| --- | --- |
| `android-home.png` | Main settings, simulated normal connection |
| `android-settings.png` | Advanced settings |
| `browser-connect.png` | Actual browser connection page |
| `browser-carplay.png` | Attributed illustrative CarPlay composite |

Android images use actual product Views rendered with Robolectric. Their phone
frames and status bars are presentation artwork. Browser windows show the
official player address, `https://ujzk.github.io/TiPlay/`. The CarPlay reference
fills a 1920 × 1080 content area at its original pixel size, retaining the source
interface's small corner shapes.

Keep the [Android source note](../site/assets/screenshots/Android-sources.md),
[browser source note](../site/assets/screenshots/Browser-sources.md), composite
label and image descriptions consistent when replacing artwork. These images
are not evidence of a live TiPlay vehicle session.

## Verification and maintenance

The README-only update passed local Markdown file/anchor and image-dimension
checks, whitespace checks, site generation/assembly and all four site tests.
The earlier browser suite passed 340 tests. Full Android checks were stopped
and waived by the maintainer for this documentation-only change; no completed
Android CI result is claimed for this update.

No application code, build configuration or runtime behavior changed. Future
README edits should retain the approved feature priorities, update both
languages and verify image/source links. Screenshot assets use the existing
GitHub Pages publication path; pushing them to `main` triggers that workflow.
