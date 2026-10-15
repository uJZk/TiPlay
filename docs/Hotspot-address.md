# Hotspot address methods

Use these methods only with the Android phone's own hotspot. Tesla browsers can reject ordinary private hotspot addresses (10/8, 172.16/12 and 192.168/16). TiPlay supports an additional link-local address, or CGNAT with Root/Shizuku. Actual browser and phone firmware reachability still requires a vehicle test.

In Main settings, select **Android hotspot**, then **TiPlay mode**:

| Method | Requirement | Behavior when selected / when left |
| --- | --- | --- |
| Standard (default) | None | Uses the current hotspot address and warns outside supported ranges; adds nothing. |
| Root | Granted `su` access | Adds a /32 address to the detected hotspot interface, restores it after hotspot restart, and removes it when left. |
| Shizuku | Running Shizuku/Sui with TiPlay authorized | Adds a /32 alias through Android network management and restores it after hotspot restart. Shell cannot remove it; it remains until hotspot restart. Root can take ownership and later remove it. Non-root Shizuku needs restarting after phone reboot. |
| VPN | Android VPN consent; free VPN slot | Holds a link-local address in a separate tunnel; leaving closes it. Vehicle reachability depends on Android/browser behavior. |

Root/Shizuku accept `169.254.0.0/16` and `100.64.0.0/10`; VPN accepts only link-local. The shared default is **169.254.111.111:8080**, defined by `HotspotExtraAddress.DEFAULT` and `BrowserEndpointSettings`. No method modifies a joined Existing Wi-Fi network.

## Editing and permissions

Root, Shizuku and VPN show **Hotspot address**, accepting `address:port` with ports 1024–65535. Empty address uses the default; omitted port preserves the saved port. The address is shared across methods. VPN falls back to the default if the saved address is CGNAT without overwriting that saved value.

Method/address changes apply immediately without CarPlay renegotiation; a port change restarts the browser listener. The phone sends no endpoint announcement or browser migration. In the browser, **Disconnect**, edit **Android address**, then **Connect**, or open the phone's newly copied pairing link. The pairing code remains valid; saved browser addresses and bookmarks do not update automatically.

Root, Shizuku authorization and VPN consent start only from an explicit chooser/button tap, never from settings search. Root alone offers hotspot credential import: a read-only helper runs after a tap, without changing the hotspot or logging returned credentials. Refusal, timeout or missing password preserves existing input. Ordinary Wi-Fi APIs and local ADB are not import fallbacks. Shizuku import is hidden because it is not a reliable product function. USB uses ordinary Android consent in every mode.

## Developer contracts

`HotspotExtraAddressKeeper` observes AP/tethering events and polls every 5 seconds, confirms the added address, and backs off failures to 60 seconds. Root refusal or a ROM denial stops retries until the user chooses the method again. Missing Shizuku/permission waits for its binder or permission events and polling. It detects the hotspot interface instead of hard-coding `wlan2`.

Shizuku calls `network_management` through `ShizukuBinderWrapper`, not a UserService. `NetworkManagementCall` requires a `:tp` alias (within Android's 15-character interface limit) and /32: an unaliased `setInterfaceConfig` can erase the hotspot's IPv4 address. Transactions come from the device's proxy; `LinkAddress` uses its public parcel creator rather than a blocked constructor. Shell can add through `CONNECTIVITY_INTERNAL`, but removal requires `NETWORK_STACK`.

`HotspotAddressVpnService` adds one /32, no routes or DNS, restricts the tunnel to TiPlay and allows IPv6 through. It holds the descriptor without forwarding traffic. Link-local is required because Android VPN ingress protection can reject hotspot packets to other VPN address ranges. It cannot be always-on. Another app's VPN is reported without requesting replacement consent. Wired CarPlay owns TiPlay's sole VPN slot while active; the address VPN waits. User/system revocation prevents automatic restart on resume/reconnect until VPN is explicitly selected again (or the process restarts).

Implementation: `common/.../HotspotExtraAddressSettings.kt`, `HotspotExtraAddressCard.kt`, `BrowserEndpointSettings.kt`; `shared/.../network/HotspotExtraAddress.kt`, `HotspotExtraAddressKeeper.kt`, `ShizukuHotspotAddress.kt`, `HotspotAddressVpn.kt` and `HotspotAddressVpnService.kt`. Diagnostic exports include method/backend/state and address class, never the literal address.
