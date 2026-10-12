# Existing Wi-Fi

Connect the Android phone, iPhone and car browser to the same third-party router or
portable Wi-Fi in system settings. On the TiPlay main page, select **Existing Wi-Fi**,
enter the exact SSID, choose the network’s security type and enter its password.
The choices are Open, WPA2, WPA3 transition (WPA2/WPA3 mixed mode) and WPA3.
For Open, the password field is hidden.
Keep Bluetooth enabled and pair the iPhone with the Android phone. Tap **Connect phone**
or **Save and reconnect** to save and start the connection; editing the fields alone
does not change a running session. See [Tesla browser setup](TESLA_BROWSER.md) for
browser address and reachability limits on an existing network.

WPA2-Personal, WPA2/WPA3 transition and WPA3-Personal are represented by distinct
bootstrap security values. On Android 12/API 31 and later, a readable negotiated
security type must match the selection; transition mode accepts either PSK or SAE.
Older Android or an unknown/redacted security type cannot verify that match.
Enterprise authentication and captive portals are outside this mode’s current scope.
Clients must be able to communicate; disable client isolation and allow multicast DNS
for service discovery. Prefer 5 GHz when supported.

TiPlay attaches to the existing connection without creating an AP, joining another
network or changing the default route. The router supplies Internet access.
Existing Wi-Fi credentials are stored separately from car-hotspot settings.
Android cannot expose saved passwords to ordinary apps, so the password is entered
manually. A readable live SSID must match the saved name. The manager tries station
WifiInfo when the network capabilities snapshot hides that name; if both snapshots
hide it, verify the manual configuration in Android settings. Precise location
permission and enabled system location can make network details readable, but are
not required merely to start this mode or tied to optional GPS reporting.

## Implementation

`ExistingWifiManager` implements the wireless backend contract. It selects the single
non-VPN Wi-Fi Network, obtains its interface and addresses from LinkProperties, and
reads channel information from WifiInfo. Internet validation is not required for LAN
communication. Ambiguous Wi-Fi connections and observable configuration mismatches
fail with a configuration error.

The bootstrap endpoint prefers a scoped link-local IPv6 address, falling back to IPv4.
Existing Wi-Fi also retains the other usable address family for discovery and TCP.
Each family has a JmDNS registry and a listener bound to the same selected interface
and port. Port fallback is shared and partially bound listeners are cleaned up.
Discovery probes use a matching source family and local IPv6 interface scope.
JmDNS `getInetAddress()` identifies the registry family; deprecated `getInterface()`
can return another address of the same Android interface. TXT feature bits share the
same source as AirPlay `/info`.

The existing Bluetooth/iAP2 sequence is reused: 0x5703 carries network credentials,
and 0x4301 carries the selected endpoint without a local scope suffix. A readable AP
BSSID is an optional 0x5703 hint, separate from the receiver’s AirPlay identity. Unknown,
placeholder, zero, multicast or malformed AP addresses are omitted. The P2P and car
hotspot backends retain their existing single-address defaults and bootstrap behavior.

Network loss or a change to either selected address restarts the wireless session.
Closing the backend unregisters its callback without disconnecting Wi-Fi. Saved
automatic car-hotspot startup applies only to car-hotspot mode.

Related work: [PR #22](https://github.com/shihabal3amri/DiPlay/pull/22) also implements
external Wi-Fi within an Android 7 port. This feature uses the current architecture
without importing that port or its system network modifications.

## Validation

Tests cover station selection, redacted network information, manual configuration,
address scope and family selection, callback cleanup, settings persistence, dual-family
publication/listening, port fallback, mode transitions and bootstrap encoding. Existing
P2P and hotspot tests run alongside them.

Historical contributor evidence retained from the earlier head-unit implementation:
a successful clean install was reported on a
2022 BYD Han DM-i with DiLink 4.0 / Android 10 (API 29), firmware
21.1.21.2401160.1: the previous test app was uninstalled, the standalone test APK was
installed and configured normally, and Same LAN entered CarPlay with no issues noticed
during use. This validates that setup; it does not establish compatibility with every
receiver, iOS version or router. Open, WPA2/WPA3 transition and WPA3-only networks have not been
separately validated on hardware in this record. This earlier native-head-unit run
is not acceptance of the current phone + browser product; no new device run was
performed for the 2026-10-12 documentation review.
For a device check, confirm that both devices keep the existing Wi-Fi connection,
CarPlay starts, and the iPhone can use online services. For failures, save one diagnostic
report with the attempt time and the iPhone’s actual Wi-Fi connection. An absence of
Bonjour control-service events alone does not prove that CarPlay discovery failed.

## Builds

A source-only debug APK omits runtime accessory authentication. Use the existing
`:mobile:assembleStandaloneDebug` task with the explicit external assets described in
[BUILD.md](BUILD.md), following [SECURITY.md](../SECURITY.md). Authentication inputs and
Android signing material must remain outside Git. The app signing key is separate
from the CarPlay accessory identity.
