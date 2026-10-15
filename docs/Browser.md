# Car browser

TiPlay shows CarPlay from an Android phone in the car browser. The iPhone
connects by wireless CarPlay or USB; the browser reaches Android through its hotspot
or shared Wi-Fi that permits communication between devices.

## Connect and recover

1. Configure the Android connection and permissions in TiPlay.
2. Open <https://ujzk.github.io/TiPlay/>. First visit and updates require the host;
   subsequent visits can use the Service Worker cache.
3. Enter **Android address** and pairing code, or open Android's **Copy link**.
   Allow browser local-network access when requested, then choose **Connect**.
4. Bookmark after code import removes the URL fragment.

Address/code stay visible and editable while disconnected. Connect appears above
Disconnect; pairing-code and address errors stay beside the action. The CarPlay TiPlay icon opens the portal, preserving the session. Re-entering resumes it.
**Disconnect** stops the session and automatic retries.

The waiting surface shows short connection or picture states. Receiver phases and
the video producer are reported separately: waiting for a CarPlay frame must not
say AirPlay is connecting, and a missing session alone does not prove that TiPlay
is waiting for an iPhone. Older apps without receiver phases use a neutral waiting
message. AirPlay URL video, photos and audio have their own playback states.
Browser capability/codec failures, protocol mismatches and browser takeover use
the existing notification-card style with a Close button. These explanations have
no timeout, and rerenders cannot reopen a dismissed error; explicitly starting a
new connection resets dismissal. Location guidance keeps its separate persistent
card. Receiver fault details stay on Android, below its short status title.

Network failure retries with a countdown; rejected codes stop retries and require the
current code. Another paired browser can take over, and the displaced page can use
Connect to reclaim the display. Wrong-code [lockout](../shared/src/main/java/com/shilapi/xcertplay/web/BrowserPairingGate.kt)
also blocks correct requests during that interval. Network errors are not code errors;
local-network denial needs browser settings, not more retries.

Android copies `?t=address:port#c=code`, including defaults. The fragment keeps the
code out of static-host requests. Import stores the pair and removes the fragment;
bookmarks depend on browser storage and cannot replace invalidated codes.
[link.js](../site/play/link.js) defines legacy/default parameter handling.

Android endpoint edits apply immediately and preserve the code, without notifying or
migrating the browser/bookmark. Disconnect, edit Android address and Connect, or open
a newly copied link. See [hotspot address setup](Hotspot-address.md) for Tesla private-address
restrictions and Root/Shizuku/VPN behavior. Existing Wi-Fi uses the current attachment;
saved credentials do not prove attachment, create an AP or change the default route.

## Playback and security

HTTPS, WebCodecs and the negotiated codec are required. Android relays encoded CarPlay
video; the browser decodes/draws Canvas in a worker or main thread. An HTML video/MSE
fallback is excluded because car browsers can pause it while driving. Codec probing
does not prove a particular vehicle/browser's compatibility. Experimental mirroring,
URL video, photos and ordinary audio follow [AirPlay.md](AirPlay.md).

The APK neither bundles nor serves the page. Protocol routes are `/hello`, `/video`,
`/audio`, `/airplay-resource`, `/control` and `/bye`; `/`, `/play` and `/play/*` return
404. Ordinary AirPlay `/play` is separate. Static assets/discovery are
public; media/control require authentication. Local HTTP is unencrypted: page HTTPS
enables WebCodecs and protects static delivery, not the phone transport. Protect the
shared Wi-Fi and pairing link.

[TeslaBrowserPageLinks](../common/src/main/java/com/shilapi/xcertplay/TeslaBrowserPageLinks.kt)
and [pages.yml](../.github/workflows/pages.yml) must agree on the public page base.
Custom saved HTTPS hosts remain usable. The [Service Worker](../site/play/sw.js)
caches only page assets, never phone media/unrelated downloads. Asset changes require
a complete manifest/new cache identity; old-location forwarders preserve pairing
parameters and retire old workers.

## Audio and microphone

Idle CarPlay AAC/Opus/LPCM is decrypted on Android and decoded/output in the browser.
Separate authenticated audio transport and semantic epochs prevent navigation/video
resets clearing music. Live queues are bounded; buffered music applies backpressure.
Sound-enabled sessions always offer `mainBuffered`; only negotiated type 103 uses it.
There is no product buffer switch or Android two-minute reservoir. Artwork/song text
are not requested; playback state/progress/controls remain.

Type 103 uses authenticated AAC-LC and bounded relay/browser reservoirs. SETRATE
starts at an RTP anchor, GETANCHOR reads it, rate zero pauses, and FLUSHBUFFERED
resets output. Compressed preload may survive pause, isolated from retired sessions.
Stalled browsers retire instead of dropping ordered music. Feedback estimates position,
not physical speaker time. Lossless/spatial audio is not advertised. Upstream rationale: [buffering #308](https://github.com/shihabal3amri/DiPlay/pull/308)
and [pacing #484](https://github.com/shihabal3amri/DiPlay/pull/484).

On iPhone call/Siri microphone demand, Android routes speech and navigation to the
unique car HFP/SCO route while browser music and ordinary AirPlay audio continue.
Route transitions retire only the affected speech/guidance streams, preserving
music queues, decoders and the audio HTTP connection. Both AudioRecord input
and AudioTrack output must actually confirm Bluetooth. Busy routes and ambiguous headsets are refused; there is no handset/browser microphone fallback.
Permission/focus/route loss stops devices and reports failure. Android's Bluetooth
stack owns mSBC/CVSD; TiPlay supplies PCM.

SCO retains telephone/Siri gain and fixed 0.25 navigation/default guidance gain, even
when guidance plays alone. Media/alerts/unknown audio stay in the browser.
Bounded 20 ms mono mixing resamples to the negotiated route. Resuming the same demand
preserves RTP/nonce counters. Actual route release must precede fresh browser
speech/guidance output; a release timeout keeps those streams held with an error.
Browser music continues independently. Revisions reject delayed route state without
replaying old speech. Route ownership survives AirPlay takeover. Car HFP owns echo cancellation;
TiPlay adds no software AEC.

The browser never captures microphones. Android requests RECORD_AUDIO while connecting
in the foreground; permitted sound-enabled foreground service access supports later
on-demand capture. Permission changes require CarPlay renegotiation. Playback works
without that grant; browser autoplay may need a gesture. Disabling CarPlay audio leaves
the iPhone responsible for direct car Bluetooth sound/calls. Vehicle voice quality,
AEC and screen-off behavior require physical tests.

## Display, settings and lifecycle

The browser reports viewport/theme. Valid Android settings apply immediately and
reconnect when negotiation requires it, retaining the settings page. Enabled idle
CarPlay can resume preparation; disabling it blocks startup/retries. Endpoint edits
use the explicit browser steps above.

The performance monitor cannot alter viewport/touch mapping. It shows codec,
last-second drawn FPS, latest frame Delta and explicit drops. Delta is Canvas submission
minus synchronized scheduled presentation: negative is early, positive late. Missing sync
shows unknown. This is not capture-to-screen latency or proof of hardware decode.
See [Diagnostics.md](Diagnostics.md).

Live video submits without waiting for audio or adding uncalibrated buffering. Live
audio follows its receiver sample/latency anchor; buffered music follows SETRATE.
Arrival playback is an explicit synchronization fallback. Physical output latency
requires device measurement; acceptance remains in [Todo.md](Todo.md).

### Browser session lifecycle

Producer stop retains the authenticated response. `lifecycle=1` opts into kind-6 idle:
release decoders/frames and wait for the next configuration on that response. Old
queued frames are discarded; replacement configuration supersedes unsent idle. Kind-4
end retires the response; clients without lifecycle opt-in retain compatibility.

CarPlay dimensions are fixed per stream. Resize fits the current picture and reports
latest dimensions on the next animation frame; Android negotiates a replacement by
reopening paired Bluetooth control, retaining hotspot/discovery/AirPlay/MFi resources.
Closing only the display or reusing StartSession on its iAP2 tunnel is insufficient.
Rounding tolerance avoids repeat negotiation. One pending viewport callback is canceled
on portal/stop; Android uses its main thread without another settling delay.
Replacement offers update until TCP acceptance; later changes wait for its first frame.
Old metadata remains fixed. There is no timed full-stack fallback, and Fit is not a
guaranteed recovery once replacement dimensions are accepted.

Portal revisions request portal display, not reconnection; the first is baseline.
Shutdown retires sessions/listeners before Bonjour cleanup, which completes before new
advertisements. Ordinary AirPlay survives CarPlay detach, independently of hotspot ownership.
Connected sessions hold CPU/Wi-Fi locks subject to Android restrictions. Permission rows reread actual system state on resume;
opening authorization alone is not a grant.

## Location notifications

The Android Advanced page owns the location permission button. Browser permission failures
show a card in the upper left, sharing the AirPlay notification style. It explains how to
allow browser location or enable **Disable browser location** on Android. The card stays
until **Close** is pressed. The waiting screen's **Setting** action is in the lower left.
See [geolocation](geolocation.md) for GPS fallback, coordinate detection and local caching.
