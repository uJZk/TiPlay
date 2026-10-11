# Privacy and diagnostics

TiPlay's product flow uses local authentication and a direct USB/Wi-Fi connection to the iPhone. No account, remote authentication service or automatic diagnostic upload is used. The iPhone's CarPlay apps have their own internet and privacy behavior.

The head unit stores app preferences, paired-device selections, pairing data and bounded diagnostic logs in app storage. Authentication and pairing material are kept out of Android backup. Uninstalling removes app-private data; exported reports in Downloads remain until you delete them.

Diagnostic export is initiated by you. Reports include app/device versions, display settings and negotiation, connection transitions, Wi-Fi band/channel and state, and decoder recovery events. The exporter filters protocol payloads, credential-bearing lines and common identifiers. Redaction cannot promise to recognize every vendor-specific string: review reports before posting them publicly. A GitHub issue is public.

When the document picker or Downloads storage is unavailable, reports save under `Android/data/<package>/files/diagnostic-reports/` on primary external storage without requesting storage permission. The confirmation shows the actual TXT file path. The release package is `com.ujzk.tiplay`; debug builds use `com.ujzk.tiplay.hudtest`. File managers on newer Android versions may restrict access to `Android/data`; use **View** or **Share** in TiPlay instead. If external storage is also unavailable, reports save in private app storage. Each fallback location retains its newest eight exports, and uninstalling removes them. Sharing grants read access to the selected report only; nothing is sent automatically. On Android 9 and older, other apps with storage permission may be able to read the external reports.

The current browser profile leaves Siri/call audio and microphone on the iPhone-to-car Bluetooth route. The retained Android microphone path supports Siri and calls in head-unit configurations. Bluetooth/Nearby devices and Wi-Fi/Location permissions support discovery and transport. The optional local VPN permission supports the USB link; it does not provide a remote internet VPN.

The retained DiLink 5.1 head-unit cluster profile optionally uses Android Usage Access to follow theme and mini-map-card visibility. This permission exposes app-activity history. TiPlay filters the results to four stock BYD cluster activities, processes them locally, and logs only inferred cluster theme/visibility changes. Unrelated activity events are not retained or uploaded. Automatic mode is opt-in; disabling it stops these queries. Usage Access can also be revoked as described in [BYD navigation](BYD_NAVIGATION.md#dilink-51-theme-profile).

The browser page stores the pairing code and phone address in browser storage and removes the code from the link fragment after opening. The fragment is not sent to the static host; authenticated requests send the code to the phone over HTTP. Video and controls are not encrypted by TiPlay on the local network; the hotspot WPA password protects that link. **New code** invalidates the old code.

The static website has no analytics script or account. GitHub Pages and GitHub apply their own policies when you use those services.
