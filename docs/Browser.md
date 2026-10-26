# Car browser

TiPlay shows CarPlay from an Android phone in the car browser. The iPhone
connects by wireless CarPlay or USB; the browser reaches Android through its hotspot
or shared Wi-Fi that permits communication between devices.

The settings footer links the shared **TiPlay product version** to the project releases. Android Main
settings shows the same product version; playback has no corner version overlay.

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
Successful connections and healthy playback show no status text. Waiting,
recovery, pause, buffering and actionable faults remain visible when relevant.
The current producer, including an explicit absence, takes precedence over an old
decoder configuration. A pending screen request keeps the still-authorized picture;
a replacement video epoch waits for its own first frame.
AirPlay preparation and screen-return waits suspend the foreground CarPlay status;
a background CarPlay disconnect must not appear as a failed casting attempt.
When AirPlay ends and ownership returns, the page resumes the actual CarPlay phase.
Browser capability/codec failures, protocol mismatches and browser takeover use
the existing notification-card style with a Close button. These explanations have
no timeout, and rerenders cannot reopen a dismissed error; explicitly starting a
new connection resets dismissal. Location guidance keeps its separate persistent
card. Receiver fault details stay on Android, below its short status title.

Normal setup shows a short connecting message; retries keep an actionable reason
and countdown. The default-collapsed **Diagnostics** section contains candidate
gathering, Android contact, authentication and channel-readiness detail, the cache
revision and the Performance monitor switch. Opening it does not enable Android
Debug capture. Failure reports preserve the stage and bounded anonymous
candidate/state counters without SDP, addresses or pairing secrets. The retry
countdown describes the next attempt, not Android response time.
The complete gathered SDP snapshot is covered by the authenticated transcript;
no fictitious candidate or end-of-candidates marker is invented.

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

The Android phone screens follow the system's rotation preference, including the
connection host and icon cropper. Disabling automatic rotation in Android locks their orientation.

URL video uses a single tap to toggle the controls; double-clicking or double-tapping
the picture does not seek. Use the visible ±10-second buttons or the time slider to
change position. Seeks clamp to the media bounds. Video.js owns tap recognition and
interactive-target filtering, so slider/menu use keeps its own actions. The buttons
also support keyboard and assistive access.
See [Video.js gestures](https://videojs.org/docs/framework/html/reference/components/gesture).

## Playback and security

HTTPS, WebCodecs and the negotiated codec are required. Android relays encoded CarPlay
video; the browser decodes/draws Canvas in a worker or main thread. An HTML video/MSE
fallback is excluded because car browsers can pause it while driving. Codec probing
does not prove a particular vehicle/browser's compatibility. Experimental mirroring,
URL video, photos and ordinary audio follow [AirPlay.md](AirPlay.md).

The product media path uses [reliable, ordered DataChannels](CarPlay-DataChannel.md),
with webpage-controlled WebCodecs decoding. Encoded source video is never reencoded.
Live CarPlay/mirroring requests hardware decoding without an intentional software
fallback; that hint cannot prove actual hardware use. URL casting retains its
independent media decoder compatibility policy. The [roadmap](WebRTC-roadmap.md) separates
implemented behavior from Shizuku-address ICE, vehicle gear-transition continuity
and physical latency acceptance.

The APK neither bundles nor serves the page. The formal page is
<https://ujzk.github.io/TiPlay/>; its deployment replaces the former root client
and removes the independent `/webrtc/` site without an alias or redirect. The APK
uses the root; custom saved HTTPS hosts remain configurable.

Four-digit SRP-6a pairing uses `/rtc/pair/start` and `/rtc/pair/finish` over local
HTTP. Mutual proofs and a session-key binding authenticate the complete offer/answer
SDP, including DTLS fingerprints, before the browser applies the answer. Pairing
codes are not sent in HTTP signaling. Tesla users can type the address/code;
clipboard and long fingerprint entry are unnecessary. Online-guess limits remain
necessary for a four-digit secret. After proof verification, the encrypted control
channel still admits `{k:'auth',q,s,c}` before media/ownership is released.

After authentication, video/audio/control use reliable ordered DataChannels with
no public STUN/TURN or Internet media relay. Public `/hello` identifies protocol
availability; old code-authorized HTTP media/control routes are not a fallback.
`/video` and `/audio` return 410 in the Android product. `/airplay-resource` uses a
random active-session bearer delivered only by successful encrypted admission;
HTTP finish does not expose it. HTTP bye also uses this random token; the HTTP resource
body retains local-network confidentiality limits. `/`, `/play` and `/play/*` on
Android return 404; ordinary iPhone AirPlay `/play` is a separate server.

[TeslaBrowserPageLinks](../common/src/main/java/com/shilapi/xcertplay/TeslaBrowserPageLinks.kt)
and [pages.yml](../.github/workflows/pages.yml) must agree on the public page base.
Custom saved HTTPS hosts remain usable. The [Service Worker](../site/play/sw.js)
caches only page assets, never phone media/unrelated downloads. Asset changes require
a complete manifest/new cache identity. The removed `/webrtc/` location receives
no compatibility alias or redirect in this deployment.

## Audio and microphone

Bulk audio computation uses [genuine WASM libraries](Browser-wasm.md); browser
decoding, transport and display continue through native browser APIs.

Idle CarPlay AAC/Opus/LPCM is decrypted on Android and decoded/output in the browser.
Separate authenticated audio transport and semantic epochs prevent navigation/video
resets clearing music. Live queues are bounded; buffered music applies backpressure.
Sound-enabled sessions always offer `mainBuffered`; only negotiated type 103 uses it.
There is no product buffer switch or Android two-minute reservoir. Artwork/song text
are not requested; playback state/progress/controls remain.

Real-time CarPlay media can also arrive ahead of its RTP playback anchor. Its timestamped
queue uses the same retention budget as buffered music, while retaining real-time overflow
handling. Retaining those samples does not delay their scheduled playback; a shorter queue
can discard them before their playback time arrives.

Each decoded stream/format epoch owns a continuous source-sample position and a
stateful [libav.js resampler](../site/play/vendor/libav/README.md). Filter state survives
packet boundaries; RTP packet adjacency stays on the nominal sample coordinate rather than
the arrival-clock drift estimate. Distinct CarPlay streams retain separate transport IDs
even when they share a music/guidance semantic type; mixing and ducking use the semantic
type while stop/reset applies only to that transport. Real timestamp gaps, seeks and stream replacement enter bounded
rebuffer/fade recovery. Temporary input shortages never flush the filter as end-of-file.

### Media clocks and synchronization

Authenticated control status supplies the clock exchanges; public `/hello` timing
is not a trusted source anchor. These exchanges estimate both Android/browser time offset and relative clock rate
from a bounded history, filtering high-delay and inconsistent observations. Centered
coordinates avoid deriving rate from enormous absolute timestamps. Ordinary calibration
refines a target; it does not remap queued audio packets. AudioWorklet advances an integer
device-sample counter and relative per-stream anchors. Small drift changes the resampling
ratio smoothly; confirmed clock steps, device discontinuities and substantial network-buffer
target changes use separate recovery reasons. Network readiness and clock correction keep
independent state.

The device/context clock has its own rate relative to the browser performance clock.
Valid output timestamp pairs provide a bounded, robust fit; Android/browser and source-rate
estimates retain their separate meanings. Context-to-performance extrapolation, emitted-content
references and resampling all use the same device-rate conversion. Guidance integrates that
rate without moving its arrival anchor. Genuine timestamp steps, gaps and suspend/resume
reset calibration; ordinary rate fitting does not repeatedly restart audio. Effective output
rate can reflect scheduling as well as an oscillator, so it does not identify a hardware fault.

Actual output references map emitted content through `AudioContext.getOutputTimestamp()`.
That pair already includes the device pipeline. Feature fallback uses reported base/output
latencies once, marks its uncertainty and rejects unbounded mappings. Resampler content
delay is reflected in the source position, so video must not add it again. Live video
and audio have independent sender-relative **+300 ms** ceilings. Output references
measure skew and uncertainty; missing or stale audio evidence does not freeze video.
Touch advances only the video cursor and cannot reset or accelerate audio. The former
45 ms early / 125 ms late audio-versus-video window is superseded for live presentation.
CarPlay navigation, calls, Siri and alerts use
an independent 20 ms arrival-anchored buffer while preserving RTP sample intervals, so a lack
of presentation lead cannot prevent speech from starting. These speech streams do not
constrain the video clock. Source/Android/browser anchors retain their confidence;
arrival fallback is never presented as proof of sender-relative compliance.

Android/browser calibration does not establish the iPhone oscillator's rate. Ordinary
AirPlay timing anchors and realtime source-supply evidence have different confidence;
buffered prefetch must never be interpreted as a faster source clock. Realtime ingress
estimation is bounded and rejects obvious network-queue steps, but cannot distinguish
every slow network-delay trend from sender drift. Keep that uncertainty and recovery
boundary visible in diagnostics. Desktop clock/output tests establish software behavior;
speaker sound, vehicle display latency and sustained iPhone interoperability require
[physical acceptance](Testing.md#media-clock-and-continuous-audio-acceptance).

Resampler impulse calibration runs outside the audio rendering thread. Playback waits for
the matching source/output format and a new node's preparation before connecting output;
queued preparation remains inside the existing audio-memory budget. Preparing a new format
does not prove every vehicle's real-time rendering budget is met.

Type 103 uses authenticated AAC-LC and bounded relay/browser reservoirs. SETRATE
starts at an RTP anchor, GETANCHOR reads it, rate zero pauses, and FLUSHBUFFERED
resets output. Compressed preload may survive pause, isolated from retired sessions.
The decoded buffer covers the producer's lead, startup anchor, permitted output delay and
clock/packet margin. Memory remains bounded; capacity protection preserves the next buffered
sample to play instead of repeatedly evicting it for later arrivals. A processor failure
retires the old node/epoch and permits only bounded reconstruction within one connection.
Stalled browsers retire instead of dropping ordered music. iPhone protocol feedback
estimates position, not physical speaker time. Lossless/spatial audio is not advertised.
Upstream rationale: [buffering #308](https://github.com/shihabal3amri/DiPlay/pull/308)
and [pacing #484](https://github.com/shihabal3amri/DiPlay/pull/484).

On iPhone call/Siri microphone demand, Android uses the unique verified car HFP/SCO
route for microphone capture. Only telephony downlink switches to Bluetooth;
navigation, default guidance and Siri downlink continue through the browser alongside
music and ordinary AirPlay audio. Route transitions retire only telephony decoders,
preserving guidance/music queues, epochs and the audio DataChannel subscription.
Both AudioRecord input and telephony AudioTrack output must actually confirm Bluetooth.
Busy routes and ambiguous headsets are refused; there is no handset/browser microphone
fallback. Permission/focus/route loss stops devices and reports failure. Android's
Bluetooth stack owns mSBC/CVSD; TiPlay supplies PCM.

Resuming the same microphone demand preserves RTP/nonce counters. Actual route release
must precede fresh browser telephony output; release timeouts hold only telephony with
an error. Other browser streams continue. Revisions reject delayed route state without
replaying old speech. Route ownership survives AirPlay takeover. Car HFP owns microphone
echo cancellation; TiPlay adds no software AEC. Browser-rendered Siri/guidance during
microphone capture needs physical vehicle verification for feedback and audibility.

The browser never captures microphones. Android requests RECORD_AUDIO while connecting
in the foreground; permitted sound-enabled foreground service access supports later
on-demand capture. A rejected microphone/location foreground type is recorded and removed
from that service start; eligible foreground access is retried when an app screen resumes.
A system refusal to start any foreground service safely ends that service start. Missing
car Bluetooth or foreground eligibility must not crash the app. Permission changes require CarPlay renegotiation. Playback works
without that grant; browser autoplay may need a gesture. Disabling CarPlay audio leaves
the iPhone responsible for direct car Bluetooth sound/calls. Vehicle voice quality,
AEC and screen-off behavior require physical tests.

## Display, settings and lifecycle

The browser reports viewport, decoder capabilities and theme. New CarPlay connections wait for a live authenticated page with usable capabilities; saved dimensions alone never start an iPhone connection. HEVC is selected automatically from that report. Valid Android settings apply immediately and
reconnect when negotiation requires it, retaining the settings page. Enabled idle
CarPlay can resume preparation; disabling it blocks startup/retries. Endpoint edits
use the explicit browser steps above.

The CarPlay picture fills a rectangular browser canvas, including after viewport
renegotiation. Following [DiPlay #596](https://github.com/shihabal3amri/DiPlay/pull/596),
the main display advertises `cornerMasks=true` and omits `safeArea` from its
`viewAreas`: iOS supplies the unclipped picture and separate corner masks, which
the rectangular browser does not blend. This changes iPhone negotiation rather
than cropping or stretching the received picture with CSS. Saved upstream safe-area
preferences do not override the browser canvas.

The performance monitor cannot alter viewport/touch mapping. It shows codec,
last-second successful Canvas submissions, latest frame Delta and explicit drops.
Delta is measured at the final submission check relative to synchronized scheduled
presentation: negative is early, positive late. Missing sync shows unknown. Multiple
submissions before one display refresh can overstate visible FPS. Debug diagnostics
also report frame-interval P95/max and time since the last successful submission;
a high average FPS alone cannot establish smooth pacing. These values do not measure
physical screen refresh, capture-to-screen latency or prove hardware decode.
See [Diagnostics.md](Diagnostics.md).

Decoded live video is scheduled in the decoder worker without a per-frame
main-thread readiness acknowledgement. Video and audio readiness observations update
their own timing plans; transferred frames retain acknowledgement backpressure and final
presentation checks. When animation callbacks are available, the presenter retains
only the newest eligible frame for the next display refresh. A deadline timer and
measured upload budget bound that wait; the final upload/submission check still
rejects expired frames. The first-frame connection proof is emitted
only after a successful final canvas submission, including transferred frames; decoding or
queue admission alone is insufficient. Workers without a usable animation
source submit immediately. Timer/immediate WebGL submissions explicitly flush queued
GPU commands without waiting for completion; refresh callbacks use their native
frame boundary. See [MDN's flush guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#flush_when_expecting_results).
Superseded pending pictures count as pacing drops.
Four shared profiles control tradeoffs: CarPlay touch favors latency slightly,
ordinary CarPlay favors smoothness, AirPlay mirror favors smoothness slightly,
and URL casting favors smoothness strongly. Live CarPlay/mirror ceilings are 300 ms;
these are limits, not fixed buffers. Touch uses continuous video-only catch-up and a
750 ms interaction hold without restoring the old backlog on release. URL casting
uses a media clock with 750 ms startup / 1500 ms recovery watermarks, bounded by GPU
memory and available content; these values are implementation defaults awaiting vehicle tuning.
Live
audio follows its receiver sample/latency anchor; buffered music follows SETRATE.
Arrival playback is an explicit synchronization fallback. Physical output latency
requires device measurement; acceptance remains in [Todo.md](Todo.md).

### Browser session lifecycle

The launcher hands off to the separate settings/session task and removes its empty root
task, avoiding a black recent-app card. Removing that launcher task must not stop the other
task's CarPlay or AirPlay services; explicitly removing the session task still disconnects.

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
