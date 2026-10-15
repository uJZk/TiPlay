# Phone settings and session contracts

TiPlay supports an Android phone with a car browser. See [Connection setup](Connection-setup.md) for driver instructions and [browser lifecycle](Browser.md#browser-session-lifecycle) for browser ownership and shutdown.

## Settings ownership

The launcher opens the session-owning host directly. Legacy main-page intents return to the same page. Main settings reuse that host's connection, permissions and recovery; opening settings does not suspend recovery. The phone creates no local projection Surface or native multi-finger settings gesture.

Main settings show separate CarPlay and AirPlay status, with configuration, selected iPhone and permission requirements below. Only Main settings and Advanced settings are product navigation. Manufacturer, model, OEM label and MFi controls stay hidden. Upstream category APIs remain for merging, not as additional product screens. Native controls adapt to narrow windows and large text, with system-bar, cutout and keyboard insets preserving access to actions.

Before a live paired browser reports its viewport and decoder capabilities, the title reads **Waiting for browser connection**. Afterwards it uses `CarPlay status | AirPlay status`. Preparation,
waiting, connection, recovery and failure are distinct CarPlay phases; USB mode or
an idle controller alone cannot claim readiness. Only an actual wireless listener
reports CarPlay ready. AirPlay ready requires the receiver's `listening` state;
startup, mirroring, media playback, photos, permission failure and stopped/error
states have separate titles. Receiver events refresh the title without waiting for
a CarPlay event. Detailed connection stages, requirements and error guidance appear
below the title.

`BrowserConnectionDraft` retains incomplete edits through window recreation and Advanced settings navigation. Valid text saves after 400 ms without typing; leaving Main settings applies valid pending edits. Choices apply immediately. Invalid fields remain editable without replacing saved connection parameters. Drafts contain connection parameters only, so they cannot overwrite independently saved video settings. Existing-Wi-Fi credentials and security are separate from hotspot credentials; legacy external-network selections restore to Existing Wi-Fi.

Settings requiring new negotiation notify the host through `BrowserSettingsChanges`. The host reloads current preferences and reconnects while leaving the settings page open; edits during recovery must reach the next attempt. Back performs navigation. There is no Save and reconnect action. Debug logging applies immediately without reconnecting; its policy is in [Diagnostics](Diagnostics.md). Address and port edits follow the separate [hotspot endpoint contract](Hotspot-address.md).

## Connection policy

CarPlay starts and recovers only after a live authenticated browser has reported a valid viewport and usable decoder capabilities, and while **Disable CarPlay** is off. Saved viewports cannot authorize a connection. USB attachment, boot launch, Bluetooth events, permission callbacks and manual retries use this same gate. Browser control heartbeats expire after five seconds without contact; explicit disconnect clears readiness immediately. This blocks new connection attempts without tearing down an already active session. Disabling cancels retries and closes the controller; enabling or saving a valid idle configuration can resume preparation. **Reconnect CarPlay** explicitly rebuilds the session. System background-launch policy can still block boot launch. The boot switch controls app launch only; `BootReceiver` supplies `CONNECT_AFTER_BOOT` and respects saved transport and CarPlay opt-out.

`BrowserCarPlaySettings` stores All, Wireless or USB independently of the current transport. All prefers an attached Apple USB device and returns to wireless after removal. USB uses the ordinary Android permission prompt; Root and Shizuku do not grant USB permissions in this product.

USB and selected-iPhone Bluetooth ACL events trigger checks. Without a controller, saved configuration and existing permissions are checked every 16 seconds. Bluetooth arrival gives failed attempts a 1/2/4/8/16-second retry sequence, then 16 seconds; repeated ACL events cannot restart that burst. Checks do not interrupt a handshake or active session or repeatedly request missing location, Bluetooth or VPN permission. No extra scan or wake lock is added by this retry policy; radio and service power use still needs measurement.

CarPlay audio is enabled by default. `BrowserCarPlayAudioSettings` independently controls opt-out; `phoneBrowserAirPlayConfig()` enables buffered music and available microphone support when audio is enabled. Disabling leaves audio to the iPhone's vehicle Bluetooth route. It does not reuse upstream `car_bluetooth_audio`. Ordinary AirPlay starts by default and has its own disable control; media and screen ownership follow [AirPlay](AirPlay.md).

## Location and video controls

Advanced settings offers **Disable browser location**, off by default. Enabling it hides
the Android location permission button, stops browser/Android location forwarding and renegotiates
CarPlay to use the iPhone's location. When enabled, browser location is detected/converted
on Android; until confirmation, Android supplies high accuracy GPS fixes. See
[geolocation](geolocation.md) for quality gates and local browser caching.

The browser probes and reports its decoder capabilities automatically. CarPlay and AirPlay
select HEVC only when reported supported, otherwise H.264. The former manual HEVC opt-out
and its saved value no longer control browser negotiation. Reported decoder limits also
constrain the negotiated canvas.

## Source entry points

The implementation lives in `common/src/main/java/com/shilapi/xcertplay/`: `BrowserMainSettingsMenu`, `BrowserConnectionDraft`, `BrowserAdvancedSettings`, `BrowserSettingsChanges`, `BrowserCarPlaySettings`, `BrowserCarPlayRetry`, `BrowserCarPlayWatch`, `BrowserCarPlayReadiness`, `FirstUseActivity`, `CarPlayHostActivity` and `BootReceiver`. Keep product behavior in dedicated files with small shared-session hooks.
