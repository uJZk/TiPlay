# README presentation

## Current content

The English and Simplified Chinese root READMEs share the same structure:
overview, feature list, screenshots, installation, usage, help, contributing and
license credits. Edit both languages together.

The feature list starts with USB/wireless CarPlay, followed by AirPlay screen
mirroring, photos and compatible unprotected media. Browser location with
coordinate-system detection and conditional GCJ-02 → WGS84 conversion,
bounded buffering and independent live timing, browser-side audio/video decoding without an extra
transcoding stage, and adaptive display complete the list. Browser touch control
and music/calls/Siri are not separate feature-list entries; their usage guidance
remains in the README. Implementation references are [Geolocation](Geolocation.md),
[Browser](Browser.md) and [AirPlay](AirPlay.md).

Credits retain DiPlay/xcertplay receiver lineage and link component license
notices. The README has no separate upstream-components list or UI-origin
description. Detailed provenance remains in [Upstream](Upstream.md) and
[Third-party notices](Third-party-notices.md).

The maintainer confirmed both audio routes and AirPlay have been validated.
The README therefore omits pending audio-acceptance wording and the experimental
AirPlay label. This documentation change did not perform new physical-device
tests or assert compatibility with every vehicle/browser combination.

## Screenshot sources

Six presentation PNGs live in `site/assets/screenshots/`:

| Image | Presentation |
| --- | --- |
| `android-home.png` | Main settings, simulated normal connection |
| `android-settings.png` | Advanced settings |
| `browser-connect.png` | Actual browser connection page |
| `browser-carplay.png` | Attributed illustrative CarPlay composite |
| `browser-airplay-mirror.png` | iPhone screen reference, without phone hardware frame |
| `browser-airplay-cast.png` | Big Buck Bunny still with actual AirPlay playback controls |

Android images use actual product Views rendered with Robolectric. Their phone
frames and status bars are presentation artwork. Browser windows show the
official player address, `https://ujzk.github.io/TiPlay/`. The CarPlay reference
is scaled to an 854 × 480 (480p) content area, retaining the source interface’s
small corner shapes. All four browser images share this content resolution and
a final size of 940 × 602 including the window frame/background. The connection
page uses capture-only zoom of approximately 61% to show its complete form.
The CarPlay and AirPlay images have no added demo or attribution text overlays;
credits and illustrative status remain in the READMEs and source notes.

AirPlay examples use an online iPhone screen reference and a single Big Buck Bunny
still. The mirror has no phone hardware frame; both examples retain the browser
window presentation. They are identified as demonstrations in the README and
source note, without added demo text on the images. See the
[AirPlay source note](../site/assets/screenshots/AirPlay-sources.md).

Keep the [Android source note](../site/assets/screenshots/Android-sources.md),
[browser source note](../site/assets/screenshots/Browser-sources.md) and image
descriptions consistent when replacing artwork. These images
are not evidence of a live TiPlay vehicle session.

## Verification and maintenance

For documentation-only edits, verify local Markdown/image/source links, image
dimensions when artwork changes, and site generation/assembly. Historical test
counts and CI waivers for the original README update remain in Git; they do not
waive checks for later source changes.

No application code, build configuration or runtime behavior changed. Future
README edits should retain the approved feature priorities, update both
languages and verify image/source links. Screenshot assets use the existing
GitHub Pages publication path; pushing them to `main` triggers that workflow.

Repository metadata is managed separately from these files. Suggested description:

> CarPlay and AirPlay in your car’s browser, powered by an Android phone. USB and wireless CarPlay, screen mirroring, photos and media playback.
