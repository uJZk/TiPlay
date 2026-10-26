# Phone settings and session contracts

TiPlay supports an Android phone with a car browser. See [Connection setup](Connection-setup.md) for driver instructions and [browser lifecycle](Browser.md#browser-session-lifecycle) for browser ownership and shutdown.

## Settings ownership

After first-use setup, the launcher opens the session-owning host directly. Legacy main-page intents return to the same page. Main settings reuse that host's connection, permissions and recovery; opening settings does not suspend recovery. The phone creates no local projection Surface or native multi-finger settings gesture.

Main settings show separate CarPlay and AirPlay status, with configuration, selected iPhone and permission requirements below. Main settings lists missing runtime permissions, battery access and USB VPN consent in an actionable hint pointing to the Permission checklist. The same requirements drive the checklist; audio opt-out and USB-only/location-off choices omit permissions they do not use. Bluetooth, Wi-Fi and hotspot broadcasts refresh visible hints immediately; a one-second visible-page check catches delayed platform state and permission changes without waiting for connection recovery. Observers stop when the page detaches. Main settings links to the single-page Permission checklist; Advanced settings has no duplicate permission list. Only Main settings and Advanced settings are product settings navigation. Manufacturer, model, OEM label and MFi controls stay hidden. Upstream category APIs remain for merging, not as additional product screens. Native controls adapt to narrow windows and large text, with system-bar, cutout and keyboard insets preserving access to actions.

The Permission checklist, Main settings, Advanced settings and About share one spacing policy: 16 dp page edges, 24 dp between sections, 16 dp before field groups, 8 dp between ordinary rows and 4 dp between a control/label and its related text/input. Buttons and switches have at least 48 dp touch height and wrap to fit their text. Hidden rows and empty groups add no gaps; rebuilding a hotspot, browser-link or permission section reapplies the same policy. Network options and utility buttons stack in narrow windows or at large font scales. System dialogs retain Android’s standard spacing.

Main, Advanced and About reuse `BrowserNativeSettingsUi.page` and its button helper.
Both phone activity hosts use `TiPlayNativeUi.applyWindow` for visible system bars,
including focus changes, so inherited fullscreen preferences cannot hide Advanced's
status bar. Their scroll containers share background, padding and inset handling.
The Debug switch has no inline description; its privacy notice appears only in the
Debug log dialog. Log and export-result windows share `DiagnosticDialogUi`.

Before a live paired browser reports its viewport and decoder capabilities, the title reads **Waiting for browser connection**. Afterwards it uses `CarPlay status | AirPlay status`. Preparation,
waiting, connection, recovery and failure are distinct CarPlay phases; USB mode or
an idle controller alone cannot claim readiness. Only an actual wireless listener
reports CarPlay ready. AirPlay ready requires the receiver's `listening` state;
startup, mirroring, media playback, photos, permission failure and stopped/error
states have separate titles. During AirPlay preparation/playback and the screen-return
wait, its status comes first and CarPlay is shown as waiting for AirPlay. A background
CarPlay failure is retained internally without a misleading failure hint; after
release its actual state is shown again. Independent permission requirements and
AirPlay errors remain visible. Receiver events refresh the title without waiting for
a CarPlay event. All automatic instructions, current requirements and problems appear together immediately below the title. Independent causes remain visible, each once, with browser permission/service blockers before connection requirements and network uncertainty. Normal stage logs and success confirmations stay out of this area. A button-triggered result appears below that button or the control that needs correction; field validation stays at the edited field after typing settles or focus leaves. Explicit operation feedback survives a card rebuild, but a newer click or superseding background fact invalidates an older asynchronous result.

Wi-Fi observations distinguish no Wi-Fi, unreadable SSID and a readable mismatch; missing permission or a redacted SSID never becomes “wrong network”. A missing hotspot address never proves that its switch is off. Source tokens prevent rebuilt cards from accepting stale probe results. Browser readiness clears speculative address-reachability hints, while independent permission/service failures remain. Actual host transport and permission differences determine session requirements: All using USB must not be blocked by a wireless draft; a controller object alone is not a connected session. Unknown failures use neutral diagnostic guidance, without guessing their cause from text or promising a retry that is not scheduled.

`BrowserConnectionDraft` retains incomplete edits through window recreation and Advanced settings navigation. Valid text saves after 400 ms without typing; leaving Main settings applies valid pending edits. Choices apply immediately. Invalid fields remain editable without replacing saved connection parameters. Drafts contain connection parameters only, so they cannot overwrite independently saved video settings. Existing-Wi-Fi credentials and security are separate from hotspot credentials; legacy external-network selections restore to Existing Wi-Fi.

Settings requiring new negotiation notify the host through `BrowserSettingsChanges`. The host reloads current preferences and reconnects while leaving the settings page open; edits during recovery must reach the next attempt. Back performs navigation. There are no manual Connect, Reconnect or Save and reconnect actions on the product page. Debug mode applies immediately without reconnecting; its policy is in [Diagnostics](Diagnostics.md). Address and port edits follow the separate [hotspot endpoint contract](Hotspot-address.md).

## Connection policy

CarPlay starts and recovers only after a live authenticated browser has reported a valid viewport and usable decoder capabilities, and while **Disable CarPlay** is off. Saved viewports cannot authorize a connection. USB attachment, boot launch, Bluetooth events, permission callbacks and automatic retries use this same gate. Browser control heartbeats expire after five seconds without contact; explicit disconnect clears readiness immediately. This blocks new connection attempts without tearing down an already active session. Disabling cancels retries and closes the controller; enabling or saving a valid idle configuration can resume preparation. System background-launch policy can still block boot launch. The boot switch controls app launch only; `BootReceiver` supplies `CONNECT_AFTER_BOOT` and respects saved transport and CarPlay opt-out.

`BrowserCarPlaySettings` stores All, Wireless or USB independently of the current transport. All prefers an attached Apple USB device and returns to wireless after removal. USB uses the ordinary Android permission prompt; Root and Shizuku do not grant USB permissions in this product.

USB and selected-iPhone Bluetooth ACL events trigger checks. Without a controller, saved configuration and existing permissions are checked every 16 seconds. Bluetooth arrival gives failed attempts a 1/2/4/8/16-second retry sequence, then 16 seconds; repeated ACL events cannot restart that burst. Checks do not interrupt a handshake or active session or repeatedly request missing location, Bluetooth or VPN permission. No extra scan or wake lock is added by this retry policy; radio and service power use still needs measurement.

CarPlay audio is enabled by default. `BrowserCarPlayAudioSettings` independently controls opt-out; `phoneBrowserAirPlayConfig()` enables buffered music and available microphone support when audio is enabled. The switch is labelled **Play audio through iPhone Bluetooth**. Enabling it stops TiPlay from receiving and forwarding CarPlay audio and leaves audio to the iPhone's vehicle Bluetooth route. Its hint asks the driver to check that iPhone-to-car connection, which Android cannot verify; it replaces Android car-Bluetooth warnings while opted out. It does not reuse upstream `car_bluetooth_audio`. Ordinary AirPlay starts by default and has its own disable control; media and screen ownership follow [AirPlay](AirPlay.md).

## Location and video controls

Advanced settings offers **Disable browser location**, off by default. Enabling it hides
the checklist location permission entry when no other selected feature needs it, stops browser/Android location forwarding and renegotiates
CarPlay to use the iPhone's location. When browser location is enabled, it is detected/converted
on Android; until confirmation, Android supplies high accuracy GPS fixes. See
[geolocation](Geolocation.md) for quality gates and local browser caching.

The browser probes and reports its decoder capabilities automatically. CarPlay and AirPlay
select HEVC only when reported supported, otherwise H.264. The former manual HEVC opt-out
and its saved value no longer control browser negotiation. Reported decoder limits also
constrain the negotiated canvas.

## Source entry points

The implementation lives in `common/src/main/java/com/shilapi/xcertplay/`: `BrowserMainSettingsMenu`, `BrowserConnectionHints`, `HotspotOperationFeedback`, `BrowserConnectionDraft`, `BrowserAdvancedSettings`, `BrowserSettingsChanges`, `BrowserCarPlaySettings`, `BrowserCarPlayRetry`, `BrowserCarPlayWatch`, `BrowserCarPlayReadiness`, `FirstUseActivity`, `CarPlayHostActivity` and `BootReceiver`. Keep product behavior in dedicated files with small shared-session hooks.
