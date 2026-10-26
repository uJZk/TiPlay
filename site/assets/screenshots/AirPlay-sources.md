# AirPlay screenshot sources

`browser-airplay-mirror.png` and `browser-airplay-cast.png` are illustrative
documentation captures. Their illustrative status and source credits are recorded
here rather than overlaid on the pictures. They use the production browser
renderer and media controls, with local sample inputs. They do not document an
actual iPhone AirPlay session or physical vehicle test. Both browser content areas
are 854 × 480 (480p); the decorative browser address bar shows TiPlay's official site,
<https://ujzk.github.io/TiPlay/>.

## iPhone screen mirroring

The complete, unframed iPhone home-screen screenshot is from GSMArena's
[iOS 18/18.1 feature walkthrough on iPhone 16](https://www.gsmarena.com/ios_18_feature_walkthrough_on_iphone_16-news-64723.php).
Original JPEG (1080 × 2346):
<https://fdn.gsmarena.com/imgroot/reviews/24/apple-iphone-16/sshots/-1080/gsmarena_048.jpg>.
Retrieved 2026-10-17. Screenshot credit: GSMArena; depicted iOS interface and
Apple app icons belong to Apple Inc. This third-party reference is not offered
under TiPlay's GPL license, and no endorsement is implied.

The reference contains no phone case, bezel or hardware frame. Its original
status bar, Dynamic Island, app grid and dock remain visible. The image is
encoded as one temporary H.264 frame, decoded by the browser's actual
`VideoDecoder`, and drawn with production `createRenderer` and `letterbox`.
It is scaled proportionally to the browser's height, with black side areas as
expected for a portrait screen inside a landscape browser. The only outer
frame added to the finished image is the browser window.

## AirPlay media casting

The picture is the official **Big Buck Bunny** splash image, 1920 × 1080:
<https://peach.blender.org/wp-content/uploads/bbb-splash.png>.
Retrieved 2026-10-17. Credit: **© 2008 Blender Foundation / www.bigbuckbunny.org**.
The film's [official copyright and sharing page](https://peach.blender.org/about/)
licenses the movie and related production artwork under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

The still is temporarily encoded into a local eight-second MP4 solely so the
then-current `createAirPlayControls`, Video.js and Mediabunny/WebCodecs rendering path could
show its normal playback controls. The final deliverable is a single screenshot,
not a video. The original image is fitted at its native 16:9 ratio; the production
controls are visible. No additional demo text or attribution overlays are added;
the source content and original marks are preserved while scaling to 480p.

The final images are 940 × 602, including scaled browser chrome and background.
The 854 × 480 browser content captures are embedded without further resizing.
