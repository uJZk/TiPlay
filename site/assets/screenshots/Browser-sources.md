# Browser screenshots

`browser-connect.png` presents a Chromium screenshot of the current production
`site/play/` connection page, captured locally at 1920 × 1080 in English. The empty
pairing field and default phone address are the application's real initial state.

`browser-carplay.png` is an **illustrative composite**, explicitly labelled in
the picture. The production page's display canvas contains an upstream LIVI
CarPlay reference image. It is not evidence of a real iPhone, Android phone,
vehicle connection, supported iOS version or successful media playback.

The CarPlay reference comes from the [LIVI project](https://github.com/f-io/LIVI),
at commit [`a76553fc941dcf378dd55c04da56aaf3d6911e08`](https://github.com/f-io/LIVI/blob/a76553fc941dcf378dd55c04da56aaf3d6911e08/docs/media/cp.png).
Original asset: <https://raw.githubusercontent.com/f-io/LIVI/a76553fc941dcf378dd55c04da56aaf3d6911e08/docs/media/cp.png>.
Retrieved 2026-10-17 as a 2100 × 1260, 16-bit RGBA PNG. The capture uses the complete 1920 × 1080 display
rectangle at source coordinates (90, 70), without scaling or stretching. Only
upstream presentation padding is removed; every clock, dock and app icon remains.
The reference retains its original German interface labels.
The display fills the entire browser content area. Small system-rendered outer
corner shapes remain; no artificial device shell or surrounding black margin is
added. A small composite label overlays empty wallpaper in the bottom right.

LIVI is by f-io and contributors and distributes its repository under
[GPL-3.0](https://github.com/f-io/LIVI/blob/main/LICENSE). Apple owns the depicted
CarPlay interface and trademarks; individual app icons belong to their respective
owners. The screenshot is attributed as an upstream third-party reference, not
as TiPlay output or proof that TiPlay supports every depicted app. No Apple or
LIVI endorsement is claimed.

## Browser window presentation

Both images embed the 1920 × 1080 page captures at their original pixel size
inside decorative browser windows, giving final dimensions of 2112 × 1352.
The address bar shows the official player website,
<https://ujzk.github.io/TiPlay/>. The connection form's Android device address
is a separate field and retains the application's default value.

The light blue-gray background is image-generated presentation artwork. The
HTML/CSS window frame preserves the original page copy, reference pixels and
composite label without generative redrawing.
