# Privacy and diagnostics

TiPlay uses local pairing and direct USB/Wi-Fi connections. It has no account, remote authentication service or automatic diagnostic upload. iPhone apps, sender media services and GitHub services have their own privacy policies.

## Stored data and reports

Android stores preferences, paired-device selections, pairing data, bounded metadata logs and opt-in raw traffic captures in app storage. App data is excluded from Android backup. Uninstalling removes app-private data; reports exported to Downloads remain until deleted.

You initiate diagnostic export. Reports contain versions, display negotiation, connection transitions, Wi-Fi state/band/channel and recovery events. Standard logging filters common identifiers and credential-bearing messages. Debug mode explicitly records raw protocol and media data, credentials and personal identifiers without redaction; the switch is off on each fresh process start, while captured sessions persist until explicitly cleared from the saved-ZIP dialog or app data is cleared. Standard mode exports a single metadata TXT without raw traffic; Debug mode exports a ZIP containing the log TXT, per-channel raw streams and timestamp/offset indexes, including retained capture history. Saving keeps the original capture. Clear captured data preserves saved ZIPs, settings and metadata logs; active Debug capture begins a new session after clearing. Previously recorded Debug messages remain unredacted in the metadata even after disabling the mode. Review reports before sharing; GitHub issues are public.

Exports normally use Downloads/TiPlay. If unavailable, TiPlay uses `Android/data/<package>/files/diagnostic-reports/`, then private app storage. The confirmation shows the TXT or ZIP path; **Share** works when file managers restrict `Android/data`. Each fallback directory retains its newest eight exports and is removed on uninstall. Sharing grants read access only to the selected report. On Android 9, apps with storage permission may read external reports. Release uses `com.ujzk.tiplay`; debug adds `.hudtest`.

## Media and permissions

CarPlay and ordinary AirPlay encoded video are forwarded to the browser. Ordinary AirPlay audio and original JPEG/PNG photos are also decoded in the browser. URL playback fetches resources from the iPhone or sender's media service through Android’s authenticated proxy or supported direct resource URLs. While Debug mode is enabled, all resources pass through Android so the capture includes them; the browser receives no direct iPhone URL or redirect.

With CarPlay sound enabled, Android requests microphone permission while connecting in the foreground. Capture opens only when the iPhone requests Siri/call input, using a verified car HFP/SCO Bluetooth route; denial still permits playback. There is no handset or browser microphone fallback. The browser never requests microphone permission. Advanced settings can leave audio/calls on the iPhone-to-car Bluetooth link. See [audio routing](Browser.md#audio-and-microphone) for route-release and physical-validation limits.

Bluetooth/Nearby devices, Wi-Fi/Location and platform local-network permissions support discovery and transport. Local VPN permission supports the USB link or optional hotspot address repair, not a remote internet VPN. Address repair cannot replace an existing VPN, including the USB-link VPN.

Retained upstream DiLink cluster code, hidden from the phone/browser product, can optionally query Usage Access for four stock BYD activities to infer theme/visibility locally. Unrelated activity events are not retained/uploaded; disabling automatic mode stops queries. Usage Access can be revoked in Android settings.

## Browser and network

Browser storage retains the pairing code, phone address and confirmed coordinate-system type (plus browser UA and record version). Location coordinates are not persisted. When enabled, browser positions travel only over the paired local control channel to Android and onward to the iPhone. High accuracy Android GPS supplies the initial position and coordinate-system comparison; it stops when a known browser position is available and resumes if browser fixes expire. See [geolocation](geolocation.md) for permissions, caching and the opt-out.

Browser storage retains no position history. TiPlay removes the code from the link fragment after opening; fragments are not sent to the static host, but the endpoint in `?t=` is. Pairing-authorized local HTTP requests send the code and WebRTC offer/answer to the phone. Established DataChannels encrypt video, audio and control with DTLS. HTTP bootstrap, startup/status control and proxied AirPlay URL resources remain unencrypted; Android disables the old HTTP video/audio endpoints. A short pairing code sent over HTTP does not authenticate DTLS fingerprints against an active network attacker; the HTTPS page alone does not fix that trust boundary. Use secured, trusted Wi-Fi. TiPlay configures no public STUN/TURN or Internet media relay.

**New code** invalidates the old code and ends the browser session. Changing Android address/port preserves the code but requires a manual browser address update or new pairing link; no endpoint migration is sent. The static site has no analytics script or account.
