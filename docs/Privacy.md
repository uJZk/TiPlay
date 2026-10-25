# Privacy and diagnostics

TiPlay uses local pairing and direct USB/Wi-Fi connections. It has no account, remote authentication service or automatic diagnostic upload. iPhone apps, sender media services and GitHub services have their own privacy policies.

## Stored data and reports

Android stores preferences, paired-device selections, pairing data, bounded metadata logs and opt-in raw traffic captures in app storage. App data is excluded from Android backup. Uninstalling removes app-private data; reports exported to Downloads remain until deleted.

You initiate diagnostic export. Standard records redacted Android and webpage logs,
and reapplies redaction to retained historical messages before exporting TXT. Debug
records incoming CarPlay/webpage streams and full Android/web diagnostic messages
without redaction; these may contain private media, credentials and identifiers.
Debug is opt-in and persists while enabled. Restarting resumes capture and opens
its log dialog. Minimize hides the dialog while recording continues. Advanced
settings provides a Debug switch and View logs button. Enabling does not open the
dialog. Both modes share the same bottom button bar.

Ordinary logs offer Save/Share/Close. Debug offers End and export/End and share/Discard/
Minimize. Ending, Discard or turning off the switch stops capture and clears raw journals.
Export/share creates an independent file before cleanup; failed writes retain the
stopped capture for recovery. Saved files and redacted metadata are unaffected.
Capture and report compression use Zstandard level 3. ZIP entries are STORED,
without recompressing captured media. Review files before sharing; issues are public.

Exports normally use Downloads/TiPlay. If unavailable, TiPlay uses `Android/data/<package>/files/diagnostic-reports/`, then private app storage. The confirmation shows the TXT or ZIP path; **Share** works when file managers restrict `Android/data`. Each fallback directory retains its newest eight exports and is removed on uninstall. Sharing grants read access only to the selected report. On Android 9, apps with storage permission may read external reports. Release uses `com.ujzk.tiplay`; debug adds `.hudtest`.

## Media and permissions

CarPlay and ordinary AirPlay encoded video are forwarded to the browser. Ordinary AirPlay audio and original JPEG/PNG photos are also decoded in the browser. URL playback fetches resources from the iPhone or sender's media service through Android’s authenticated proxy or supported direct resource URLs. While Debug mode is enabled, all resources pass through Android so the capture includes them; the browser receives no direct iPhone URL or redirect.

With CarPlay sound enabled, Android requests microphone permission while connecting in the foreground. Capture opens only when the iPhone requests Siri/call input, using a verified car HFP/SCO Bluetooth route; denial still permits playback. There is no handset or browser microphone fallback. The browser never requests microphone permission. Advanced settings can leave audio/calls on the iPhone-to-car Bluetooth link. See [audio routing](Browser.md#audio-and-microphone) for route-release and physical-validation limits.

Bluetooth/Nearby devices, Wi-Fi/Location and platform local-network permissions support discovery and transport. Local VPN permission supports the USB link or optional hotspot address repair, not a remote internet VPN. Address repair cannot replace an existing VPN, including the USB-link VPN.

Retained upstream DiLink cluster code, hidden from the phone/browser product, can optionally query Usage Access for four stock BYD activities to infer theme/visibility locally. Unrelated activity events are not retained/uploaded; disabling automatic mode stops queries. Usage Access can be revoked in Android settings.

## Browser and network

Browser storage retains the pairing code, phone address and confirmed coordinate-system type (plus browser UA and record version). Location coordinates are not persisted. When enabled, browser positions travel only over the paired local control channel to Android and onward to the iPhone. High accuracy Android GPS supplies the initial position and coordinate-system comparison; it stops when a known browser position is available and resumes if browser fixes expire. See [geolocation](geolocation.md) for permissions, caching and the opt-out.

Browser storage retains no position history. TiPlay removes the code from the link
fragment after opening; fragments are not sent to the static host, but the endpoint
in `?t=` is. Local HTTP carries SRP challenge/proof messages and SDP, never the
four-digit pairing code. Mutual SRP proofs and a session-key transcript binding
authenticate the DTLS fingerprints before the connection is used. Established
DataChannels encrypt media and control. The short code still requires online-guess
limits, and the HTTPS page must remain trusted. AirPlay HTTP resources use random
active-session bearer tokens delivered only after encrypted control admission;
HTTP pairing finish never returns them. HTTP bye uses the same random token; those HTTP bodies
and tokens retain local-network confidentiality limits. The Android product disables
old code-authorized HTTP media/control routes. No public STUN/TURN or Internet media
relay is configured.

**New code** invalidates the old code and ends the browser session. Changing Android address/port preserves the code but requires a manual browser address update or new pairing link; no endpoint migration is sent. The static site has no analytics script or account.
