# Testing TiPlay

TiPlay supports an Android phone plus car browser. Follow [installation](Install.md) and [build](Build.md) instructions; use a parked car for physical acceptance.

## Automated checks

The [Android workflow](../.github/workflows/android.yml) defines required tool versions and commands: browser unit tests, public-source credential checks, release-draft tests, Android unit tests, lint and debug builds. Its retained upstream sample checks do not establish a second supported product.

For browser/media changes, use the applicable [Chromium harness](../tests/web-e2e/README.md): browser link and recovery, real shared-server wiring, URL MP4/HLS playback, still photos under production CSP, or ordinary AirPlay audio. Native AirPlay changes also require `python3 scripts/test_airplay_native.py`. Rebuild generated site outputs with [the Pages workflow](../.github/workflows/pages.yml) when their inputs change.

Desktop simulations and codec probes cannot establish Tesla firmware support, iPhone interoperability, autoplay behavior, vehicle sound or sustained performance. Record which checks ran and which physical checks remain.

## Receiver status and browser notices

The full Android CI command passes with 1,967 shared, 1,552 common and 6 home unit
tests, three application lint checks and three debug APK builds. The mobile debug
APK also passes signature verification. All 229 browser unit tests, the Chromium
`run.mjs` and real shared-server `phone-run.mjs` harnesses, static site generation
and assembly, the public-source scan and 9 release-draft tests pass.

Regression checks distinguish receiver preparation, waiting, handshake, readiness,
recovery and failure, and verify that actual display ownership selects CarPlay or
AirPlay waiting copy. Main settings retain short `CarPlay status | AirPlay status`
titles with a consolidated automatic-hint area below. Duplicate causes and routine stage prose are hidden; explicit operation results stay below their source control. All existing copy
is preserved and the 15 additional Android entries are present in all 8 locales.
Browser codec/protocol/takeover errors use persistent closable cards, dismissed
errors stay hidden on rerender, and code/address feedback stays beside Connect.

Physical phone/vehicle checks of status timing during permissions, USB enumeration,
reconnection, AirPlay pause/buffering and browser notification dismissal remain
open in [Todo](Todo.md#connection-settings-and-browser). Desktop harnesses establish
software behavior only.

## Location and notification verification

The implemented [location flow](geolocation.md) uses precise Android GPS until the
browser datum is confirmed, refined GCJ-02 conversion and browser-local datum caching.
The latest source checks passed: 1,967 shared, 1,552 common and 6 home unit tests,
229 browser tests, the CI lint/debug-build command, the public-source scan and all
9 release-draft delivery tests. The debug APK contains geocoordinates and JNA native
libraries for arm64-v8a, armeabi-v7a, x86 and x86_64; the library checksum matches its
pinned release. This source-only APK contains no runtime MFi identity.

The Chromium `run.mjs`, `phone-run.mjs` and `geolocation.mjs` harnesses passed.
They cover reconnect/offline behavior, the production shared server, browser-owned
location permission, datum persistence across reload, opt-out, persistent notification
close behavior, upper-left notifications and the lower-left waiting-screen action.
The GPS provider tests verify precise permission, GPS subscription, initial Android
forwarding and cleanup. The decision tests cover immediate GCJ-02 confirmation,
WGS84 movement evidence, stale/duplicate fixes and source fallback.

These checks establish software behavior, not vehicle sensor accuracy or native loading
on a physical phone. Next, run the [location device checks](Todo.md#location), including
cold-start drift, GPS loss/recovery, screen-off operation, geographic boundaries and
actual iPhone navigation. Do not mark those acceptance items complete from simulation.

## Phone and browser acceptance

`BrowserMainPageTest` checks centralized hint placement, cleared stale failures, structured USB consent and automatic persistence without a reconnect button. `BrowserConnectionHintsTest` covers unknown/redacted SSIDs, mismatch and actual absence of Wi-Fi. `HotspotOperationFeedbackTest` checks method-versus-authorization placement, card rebuilds, consecutive clicks and late asynchronous results after a superseding fact. Real Android authorization/VPN and network transitions still require the device checks below.

`BrowserSpacingTest` measures control/description gaps and page edges, checks that opt-outs leave no extra gap, and exercises buttons and network options at 320 dp with large text. System permission dialogs and actual OEM font rendering still require device acceptance.

Automated coverage for this flow lives in `FirstUseActivityTest`,
`BrowserCarPlayReadinessTest`, `BrowserMainHostTest`, `BrowserMainPageTest`,
`CarPlayHostBrowserLinkTest` and `BrowserLinkServerTest`: setup completion/recreation, legacy-guide migration, wireless validation, missing-only
permission requests, permanently denied permission settings and uniform navigation spacing,
current-page readiness, authenticated heartbeat/disconnect, startup gating, waiting title
and browser-selected HEVC independent of the old preference.

1. Install/update the intended signed `mobile` APK; confirm settings survive an update. On first launcher open, check connection and sound choices, missing-only permission requests, Back, rotation and completion. Check uniform button spacing on narrow screens and with large text. Deny a permission, deny it permanently, return from app settings, and verify current grant status. Check Bluetooth, battery settings and USB VPN consent. Continue with missing grants only through the explicit confirmation. The next launch should enter Main settings directly, and its guide action should reopen setup. Before opening the browser, verify **Waiting for browser connection** and no iPhone connection attempts, including USB attachment, boot and Bluetooth events. Open the hosted HTTPS page from TiPlay's pairing link. Check first-use network permissions, pairing-code entry, saved address and fragment removal. Deny a permission once and confirm the explanation and retry path work.
2. Connect via each affected USB/wireless mode. Confirm CarPlay picture, touch alignment, keyboard/controls and audio. Close/reopen the browser, interrupt Wi-Fi, sleep/wake the screen and reconnect. A replacement browser must take ownership without the old page stealing it back; disconnect must release the session.
3. Check both phone settings menus. Valid edits apply immediately and negotiate a reconnect when required while keeping settings open. Invalid drafts show errors. Disable CarPlay and confirm startup/retry stops; enable it and verify recovery. Verify **Start on boot** only when enabled, subject to Android background restrictions.
4. Resize the browser, change fullscreen/orientation and open/close browser panels. Check stable layout, accurate touch mapping, negotiated resolution and recovery after rapid changes. Verify HEVC is selected only when reported supported, H.264 is selected otherwise, and there is no manual codec switch. Settings and diagnostics must remain usable while disconnected.
5. Change Android's address/port: the pairing code stays valid, but the browser requires a manual endpoint change or new link. **New code** must invalidate the old code and terminate its session. Test a stale code and interrupted connection without exposing credentials in logs.
6. With CarPlay sound enabled, check browser music/navigation, Siri and calls. Verify microphone permission denial still permits playback; microphone demand must use a verified car HFP/SCO route and release it afterwards. The browser must never request microphone access. With CarPlay audio disabled, verify the intended iPhone-to-car Bluetooth path. Check echo, navigation attenuation, timing and route restoration on the actual car.
7. Export diagnostics, review redaction, then use **View** and **Share**. Confirm Downloads output, distinct filenames and cancellation of **Choose save location**. Test unavailable-picker/storage fallbacks on an emulator; verify the displayed path and retention of the newest eight fallback reports.

## Ordinary AirPlay acceptance

Use unprotected content from an actual iPhone. Check discovery and device approval, mirroring, audio-only playback, JPEG/PNG photos, and URL MP4/HLS playback with seeking, subtitles, buffering and iPhone controls. Test stopping/replacing a cast and returning the browser display to CarPlay while retained CarPlay audio continues as designed. Exercise authentication/resource expiry and recovery after network loss.

Check advertised audio codecs in the actual browser; unsupported WebCodecs formats must fail clearly. HDR content is subject to TiPlay's SDR policy. DRM services and apps that prohibit AirPlay are outside acceptance. See [AirPlay](AirPlay.md) for receiver boundaries.

Record Android/device, browser/vehicle firmware, iPhone/iOS, app version, transport, exact steps and remaining failures. Share reviewed diagnostics without pairing codes, keys or personal data. Track outstanding physical validation in [Todo](Todo.md).
