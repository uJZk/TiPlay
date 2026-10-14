# Tesla browser

TiPlay runs on an Android phone and shows CarPlay in the car browser. The iPhone uses wireless CarPlay or USB;
the browser reaches the Android device through its hotspot or an existing Wi-Fi network. These are separate choices:
USB does not remove the browser's network configuration. CarPlay music plays through the browser;
when CarPlay requests microphone input, Android routes speech, navigation and capture to the car HFP/SCO channel
while browser music continues;
advanced settings can disable CarPlay audio and leave all sound and calls on the iPhone-to-car Bluetooth connection.

## Hosting and playback

The hosted page needs HTTPS because WebCodecs requires a secure context. For CarPlay, the phone relays the iPhone's encoded video
without re-encoding it and receives browser touch input. The app does not bundle or serve the browser page. It
provides `/hello`, `/video`, `/audio`, `/airplay-resource`, `/control` and `/bye`; GET `/`, `/play` and `/play/*` return `404`. Plain HTTP at a LAN
address cannot provide the secure context needed for playback; localhost is a browser exception. Do not restore a video/MSE
fallback: vehicle browsers can pause that path while driving.

Playback requires WebCodecs and support for the negotiated codec. The remaining paths use a worker or the main
thread for decoding and canvas drawing, depending on browser capabilities. CarPlay and ordinary AirPlay mirroring keep canvas drawing; AirPlay URL
video uses a hidden HTML video decoded by Video.js and presents frames on Canvas, with Android resource proxying. Do not add an HTML video fallback to CarPlay.
These capability checks do not establish support for a particular vehicle or browser version. In the phone profile,
CarPlay encoded video bypasses the Android decoder and local video surface; the phone retains its native settings and status UI.
Ordinary AirPlay mirroring also forwards encoded H.264 or enabled HEVC to the browser; still photos use an Android
Surface/encoder bridge. Mirror companion audio uses Android AAC-ELD decoding and browser PCM output, while URL-video
audio and video are decoded by the browser player. See [AirPlay implementation](AIRPLAY.md#实现与开源依据).

## Audio and microphone

CarPlay negotiates media, navigation, telephone and assistant streams independently. These format declarations
alone do not select Bluetooth devices. Android receives all enabled CarPlay audio and makes the routing decision
locally: browser playback without an iPhone microphone demand; during demand, HFP/SCO carries telephone,
Siri and navigation while media, buffered music and other audio outside the SCO mix remain in the browser.

The browser AudioWorklet only plays PCM. The page never requests microphone permission, opens capture tracks,
or runs AEC. Android requests RECORD_AUDIO while connecting in the foreground, and the existing connection
service declares microphone foreground access when permission is granted and sound is enabled. Actual recording
opens only on demand. Regranting permission requires a CarPlay renegotiation; playback works without that grant.
Browser autoplay restrictions still use the next page touch or key gesture to resume sound. Some browsers still
request local-network access for the Android endpoint; removing microphone capture does not remove that network requirement.

On demand, Android selects the unique available HFP device. Browser music, ordinary AirPlay mirror audio and
URL-video audio continue throughout connection, failure and release; these route transitions do not clear their
queues or restart their decoders. Android 12+ uses setCommunicationDevice; older releases use the HEADSET profile and SCO
connection broadcasts. Both AudioRecord and AudioTrack must actually route to Bluetooth before speech/capture
flows. Existing communication sessions and ambiguous headsets are refused, not preempted. There is no handset
or browser microphone fallback. Lost permission, focus or route stops the devices and produces an audio error.

During microphone demand, telephone, Siri and navigation/default guidance are excluded from browser output and
use only SCO. Navigation without microphone demand still plays in the browser. The SCO mix accepts only these
speech/guidance streams; navigation always has 0.25 gain, even when it is the only SCO sound. Media, alerts and
unknown-purpose audio stay in the browser. Bounded mono mixing runs in 20 ms blocks;
Android converts the playback rate to the negotiated SCO rate. RTP/nonce counters survive resuming the same
microphone demand. The car's telephone audio processing owns echo cancellation; TiPlay adds no software AEC.

Releasing SCO is asynchronous. Keep the routed speech/guidance streams out of browser output until the owned
communication route is actually gone; timeout produces a persistent error while release remains pending.
Browser music and AirPlay output continue independently. Route revisions in status and empty type-5 audio
records reject delayed state without replacing the music HTTP body. Route ownership survives an AirPlay display takeover.

Audio has its own authenticated HTTP stream so it cannot block video writes. Live queues are bounded;
buffered music applies backpressure instead of dropping ordered frames, including during voice routing.
The obsolete `/microphone` API, browser microphone status and upload diagnostics are removed. Full vehicle behavior, microphone quality, phone-screen-off capture and car-side AEC require
an actual car test. See [the current media implementation](BROWSER-MEDIA-2026-10-13.md).

The App's page address and the deployment's public base URL must agree. Their authoritative sources are
[TeslaBrowserPageLinks](../common/src/main/java/com/shilapi/xcertplay/TeslaBrowserPageLinks.kt) and
[the Pages workflow](../.github/workflows/pages.yml). A repository redirect is not proof of the deployed site address.
The official page address is `https://ujzk.github.io/TiPlay/`, with the project at `https://github.com/uJZk/TiPlay`.
Previously saved custom HTTPS addresses remain supported; former default addresses resolve to the build default.

The first visit and page updates require access to the static host. Later visits can use the Service Worker's cache.
A worker must intercept only its own page assets, preserving download pages and other content on the same host.
Asset changes must update the cache revision in [the Service Worker](../site/play/sw.js); removed assets must leave
its precache list. Forwarders from old page locations must preserve endpoint and code parameters and retire old workers.

## Displayed and copied links

The App displays the concise HTTPS page address, pairing code and Android endpoint separately. Manual entry uses those
separate values. **Copy link** instead copies a complete URL with an explicit `t=address:port` query and `#c=code`
fragment, including when the address or port equals its default. This makes the copied link self-contained instead of
depending on a browser's saved address or fallback endpoint.

The copied endpoint names the live extra address when available, otherwise the detected network address, with the
configured address as a fallback. Endpoint edits require 169.254.0.0/16 for VPN and allow both
169.254.0.0/16 and 100.64.0.0/10 for Root/Shizuku, with ports 1024–65535. An empty address uses the
default and preserves the saved port. Changing the method never rewrites the saved address;
VPN uses the default when the saved address is outside its supported range. The editor checks the
currently selected method before saving. Address modification and endpoint changes apply immediately on Android,
preserving the pairing code. The phone does not notify the browser of the new endpoint or automatically migrate
its connection, saved address or bookmark. In the browser, choose **Disconnect**, update the **Android address**
and choose **Connect**, or open a newly copied pairing link. An old bookmark continues to name its old endpoint.

The code belongs in a URL fragment so it is not sent to the static page host. The page imports and saves it, then
removes the fragment. Bookmark only after import; a bookmark does not contain the code and cannot replace a new code
after the phone invalidates the old one. Legacy parameter forms remain compatibility inputs, not the App's copy format.

The hosted page uses [link.js](../site/play/link.js) to resolve one phone/code pair: `?t=` takes precedence over the legacy
`#h=` endpoint, and a valid `#c=` supplies the code. A code without an endpoint names the page's default phone;
a bookmark without a code retains the saved code. **Connect** starts one browser session, and returning from the portal resumes that session. Importing a link does not create a parallel
connection. Browser storage must remain available for a code-free bookmark to recover the saved pairing.

## Pairing and network boundaries

Only one browser presents CarPlay at a time; a newly paired browser can take over. Wrong-code throttling also affects
otherwise correct requests during its lockout, so repeated retries are not a recovery strategy. The limits are defined
by [the pairing gate](../shared/src/main/java/com/shilapi/xcertplay/web/BrowserPairingGate.kt), rather than duplicated here.

Network failures retry automatically while the browser session is active. The portal's countdown updates each
second even without a phone heartbeat. A rejected code stops the session and requires a current code; a browser
takeover stops it and allows **Connect** to claim the display again. **Disconnect** cancels pending retries.
Local-network permission denial or unsupported browser policy still needs attention in the browser's settings;
the HTTPS page and retry loop cannot grant that access.

The separately hosted static page and the phone's discovery response are reachable without a pairing code; video and control require authentication.
The local video transport is not encrypted. An HTTPS page protects static-page delivery and enables WebCodecs; it does
not turn the HTTP connection to the phone into TLS. Protect the shared network with its Wi-Fi security.

Tesla browser restrictions can block ordinary private hotspot addresses. Address modification provides an alternative
without changing the iPhone's transport. Root and Shizuku add an address to the hotspot; Shizuku cannot remove that
address, so it survives a method change until the hotspot restarts. VPN holds its own address and must not
replace another VPN, including TiPlay's wired connection VPN. Some Android ingress rules discard hotspot traffic
to non-link-local VPN addresses; a link-local address avoids that rule but still depends on the car's routing behavior.
See [hotspot address setup](HOTSPOT_ADDRESS.md) for permission and cleanup contracts.

Existing Wi-Fi attachment does not create an AP, join a network or change the default route. The phone, browser and
wireless iPhone must be on a network that permits device-to-device traffic. Saved SSID/password fields alone do not
prove network attachment. The selected open/WPA2/WPA3-transition/WPA3 type controls validation and iAP2 advertisement;
transition mode accepts either PSK or SAE negotiation. Redacted system network information must preserve the manually
configured fallback rather than falsely reporting a disconnected network.

## Picture and settings

The browser reports its available video area and theme. Native head-unit display settings do not govern the browser
canvas. The phone fits the existing picture while negotiating a replacement display; this can briefly interrupt
CarPlay. Frame rate and codec controls belong to the App's Advanced settings. Settings apply immediately and
reconnect a running session automatically when required. With CarPlay enabled, idle edits may resume connection
preparation; disabling CarPlay blocks startup and retries. Endpoint edits require the browser steps above.
Returning from Advanced settings is navigation only.

CarPlay has no product header over its canvas. Its TiPlay icon returns to the portal while preserving the session;
the portal returns to the picture without creating a second connection. Connect appears above Disconnect on the portal.
Disconnect explicitly stops both the connection and automatic retries; returning to settings does not.

The **Performance monitor** shows four fields: codec, current FPS, current Delta and explicit dropped
frames, for example `HEVC · 60 fps · -40 ms · 3 drops`. Its overlay is outside the video surface;
enabling it must not affect viewport negotiation or touch mapping.
Current FPS counts frames actually drawn in the last second, including during startup; it becomes zero when
no frames have been drawn for a second. Coalesced or dropped source frames do not add to the draw count.
Delta is the most recent drawn frame's browser canvas submission time minus the iPhone's synchronized
scheduled presentation time. After a second without a new draw it displays `—`.
Negative values mean the browser submitted the frame early; positive values mean it submitted it late.
This measures presentation scheduling, not capture-to-display latency or physical screen illumination.
The dropped-frame count covers explicit input rejection, scheduler discards, frame transfer replacement
and presentation failure in the current video configuration. It cannot measure loss inside a decoder or
before browser input. New configurations, producer idle and reconnection reset the monitor's counters.
The five-second presentation distributions remain in diagnostics.
Unavailable source synchronization is labelled explicitly; it never displays arrival time as the source time.
Screen headers omit the NTP epoch present in timing-port timestamps; video clock mapping restores that epoch
before applying the synchronized offset. Missing or expired synchronization, or timestamps outside the ten-second
window in either direction, display `—`. Transport arrival time never substitutes for source presentation time.
The App's Standard/Debug diagnostic log detail is independent of monitor visibility.
See [the diagnostics contracts](DIAGNOSTICS.md).

The recording calibration path submits decoded video immediately, without extra browser video buffering or rejecting
pictures against an uncalibrated source-time deadline. Video never waits for audio readiness. The monitor derives
Delta from the same drawn frame's expected presentation time and actual submission time.
PCM retains its sample timeline across reordered packets and missing data.
CarPlay live audio follows the receiver-owned sample/latency anchor reported to the sender;
buffered music follows its SETRATE anchor and retains backpressure. Neither path substitutes each packet's arrival
time for its scheduled presentation. Audio resets are per semantic stream, so navigation cannot clear music.
Video configurations do not clear audio received independently over HTTP. See [media timing contracts](AIRPLAY.md#音画时间与播放策略)
for mirroring, URL video, clock fallback and discontinuity handling. This scheduling does not compensate physical
display or speaker output latency. Source presentation to canvas submission is observable; capture to physical
display latency requires device measurements. A source timestamp describes expected playback, not a known capture
time. Independent playback-control state updates are unsuitable for measuring media latency.

## Browser session lifecycle

Stopping the active video producer leaves the authenticated browser connection open. Pages opt in with
`lifecycle=1` on `/video` to receive the empty kind-6 idle record, release the decoder and retained frame,
and show the waiting surface. A subsequent configuration resumes on the same response. Queued frames from
the stopped producer are discarded; a replacement configuration supersedes an idle record not yet sent.
Cached pages without that opt-in continue receiving the older record set. Producer idle is distinct from
the kind-4 end record, which retires the browser response.

Changing the browser's native CarPlay canvas requires a new iPhone display session: its negotiated dimensions cannot
change during a stream. The page fits the existing picture while reporting the new canvas on the next display frame.
The phone closes the old display and reopens the paired iPhone's Bluetooth control channel to negotiate the replacement,
retaining its hotspot, Bonjour advertisements, AirPlay listener and MFi connection. A small resize tolerance prevents
browser rounding from repeatedly replacing the session. Closing the old display alone, or repeating StartSession through
its existing iAP2 tunnel, does not reliably make the iPhone establish a replacement.

Viewport notifications share one pending animation-frame callback, which reads the latest dimensions without
waiting for a quiet period. Returning to the portal or stopping cancels that callback so it cannot report into a
new session. The phone dispatches viewport notifications to the main thread and checks the fit immediately, without
another settling delay. During display replacement it updates the latest offered dimensions until the new TCP session
accepts them. Later viewport changes wait for the replacement's first frame before requesting another display session.
The next video stream uses the new canvas metadata; the old stream keeps its existing metadata until it closes.
Resize does not trigger a timed full-stack fallback. A failed renegotiation can leave the display pending;
the browser's fit button is not a reliable retry once the replacement dimensions have been accepted.

Returning to the portal retains the video connection. The status revision is a signal to show the portal, not a
request to reconnect; a newly opened page treats its first revision as a baseline. Older phones without this signal
remain compatible with the page.

During full-stack shutdown, Bonjour cleanup must finish before a replacement stack advertises its services. Independent address instances
can send their goodbye records concurrently, but cleanup still waits for every instance. Starting the replacement
early risks stale discovery records; reducing the shutdown timeout is not an equivalent optimization.
The old AirPlay listener closes before Bonjour cleanup so the iPhone can detect the lost connection while goodbye
records are being sent; this does not permit replacement advertisements before cleanup completes.
With the unified AirPlay entry enabled, CarPlay shutdown releases only its protocol context and control discovery.
The shared listener and receiver advertisement stay alive while the ordinary AirPlay service holds its lease.
Disabling ordinary AirPlay instead keeps any active CarPlay lease and switches the shared advertisement to CarPlay's
profile. The final lease closes the entry; keeping a lease does not keep a separately owned hotspot running.

While connected, TiPlay keeps the CPU awake and requests low-latency Wi-Fi operation so the browser can retain its
picture with the phone screen off. Platform-required local network permissions govern access from both the iPhone and
car browser. Permission rows must read actual system state again after returning from system settings; opening an
authorization screen alone is not evidence of a grant.
