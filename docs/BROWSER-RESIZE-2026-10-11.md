# Browser resize delivery — 2026-10-11

The browser profile now suppresses Android audio and microphone processing. Window resize reports the newest
viewport on the next animation frame, then replaces the iPhone display session by reopening only Bluetooth control.
Hotspot, Bonjour, AirPlay listener and MFi resources remain owned by the existing controller. Automatic timed and
request-unavailable full-stack resize fallbacks are disabled at the user's request.

The required Android CI command completed successfully; browser tests passed 67/67. The final debug APK was
installed with data preserved as `com.ujzk.tiplay.hudtest`. Automated ADB tests used Android Edge and a connected
iPhone. Final replacement browser-rendered first-frame timings were 2.605, 1.596 and 1.620 seconds, with zero
full-stack rebuilds. Rapid five-size bursts coalesced into one negotiation; initial handshakes can exceed two seconds.
Physical viewport overrides were cleared and playback restored. These results do not establish Tesla vehicle behavior.

Repeatable measurements are encoded in `scripts/measure_browser_resize.mjs`; Node 22 and a Chromium DevTools
socket are required. Updated modes temporarily load the checkout's browser code and save structured timings,
including failed trials. The lifecycle contract is maintained in `docs/TESLA_BROWSER.md`.

Remaining validation: Tesla browser window transitions, audio/Siri behavior on the car Bluetooth route, and failed
renegotiation recovery. The fit button may be unavailable after new dimensions are accepted; no manual browser
recovery guarantee is made. A signed release APK and release attachment are outside this debug iteration's delivery.

Tie-up runs on `main`, so no branch merge is needed. Source, tests and these records are delivered by normal push;
the existing Publish site workflow publishes the browser changes. Deployment acceptance is checked against the
workflow and public asset contents rather than assuming a successful push means the site is live.
