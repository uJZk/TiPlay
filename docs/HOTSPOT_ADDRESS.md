# Hotspot address methods

In phone + browser mode the Tesla browser opens TiPlay at an address on the phone’s
own hotspot. The current setup guidance treats the private ranges
(10/8, 172.16/12, 192.168/16) as blocked by the Tesla browser and uses a link-local
extra phone address. Root and Shizuku also support the CGNAT range.
On the TiPlay main page, select **Android hotspot** under **Network configuration**,
then choose **Hotspot address modification**. The chooser explains why the Tesla browser needs this:

| Method | Needs | What TiPlay does | When the driver leaves it |
|---|---|---|---|
| None (default) | nothing | Adds nothing. Shows the hotspot's IPv4 and warns when it is outside the supported link-local and CGNAT ranges. For other car browsers, or an already accessible hotspot address. | — |
| Root | root (Magisk, KernelSU …) | `ip -4 addr replace <address>/32 dev <iface>` through `su`, again after every hotspot restart | `ip -4 addr del …`: the address goes at once |
| VPN | Android's VPN permission (asked once); no other VPN at the same time | A VPN that holds the address and nothing else | The VPN closes |
| Shizuku | Shizuku (ADB) or Sui (root), running and allowing TiPlay; without root, Shizuku must be started again after every phone restart (wireless debugging needs Wi-Fi, or a computer over USB) | `INetworkManagementService.setInterfaceConfig("<iface>:tp", <address>/32)`, again after every hotspot restart | The address stays until the hotspot restarts: the shell user cannot remove it. A toast says so, except when the driver switches to Root, which takes the address over and removes it when left |

Method changes apply at once without reconnecting CarPlay. With Root, Shizuku or VPN
selected, tap **Hotspot address** to edit `address:port`. Root/Shizuku edits require
169.254.0.0/16 or 100.64.0.0/10; VPN edits require 169.254.0.0/16.
The default address is defined in [the address policy](../shared/src/main/java/com/shilapi/xcertplay/network/HotspotExtraAddress.kt);
both phone and browser use it.
Ports must be 1024–65535. An empty address uses the default while preserving the
saved port. An address without a port also preserves the saved port. Saving a changed address moves
the selected method to it; changing the port restarts the browser listener. An active authenticated
browser learns the new endpoint before the address/listener moves and keeps the same session;
a disconnected browser needs the updated endpoint entered manually. Connection settings apply immediately and reconnect
automatically when needed. None shows the live hotspot endpoint without an edit row.
The stored address is shared between methods. VPN uses the default link-local address when
the saved address is outside its supported range, without overwriting the saved value.
Switching back to Root or Shizuku restores the saved address.
The first root prompt, Shizuku permission request and VPN consent come only from
a tap in the chooser or its buttons; building the settings search index touches none of them.

Hotspot credential import uses only the selected Root or Shizuku method. Root reads
the system Wi-Fi configuration through a read-only `app_process` helper after an
explicit tap; opening settings never launches `su`. Shizuku reads through its already
authorized binder. Neither path changes the hotspot or persists/logs the returned
credentials outside the editable settings. Ordinary app Wi-Fi APIs and local ADB
are not credential-import fallbacks. A refused or timed-out read leaves the existing
fields intact, and a missing password never clears a manually entered one.

Code: `shared/src/main/java/com/shilapi/xcertplay/network/` (`HotspotExtraAddressKeeper`, `HotspotAddressBackend`,
`ShizukuHotspotAddress.kt`, `HotspotAddressVpn`, `HotspotAddressVpnService`) and
`common/src/main/java/com/shilapi/xcertplay/` (`HotspotAddressMethod`, `HotspotExtraAddressSettings`,
`HotspotExtraAddressCard`).

## Root and Shizuku: the keeper

`HotspotExtraAddressKeeper` watches the tethering and Wi-Fi AP broadcasts and polls every 5 s. When the address is
missing from the hotspot interface it calls its backend, then reads the interface to confirm. Failures back off from
5 s to 60 s. A root refusal, or a ROM that refuses the shell user, stops the session until the driver chooses the
method again in the chooser (an activity resume or a new connection does not retry). Shizuku that is not running, or has not allowed TiPlay yet, is only a waiting state: Shizuku's own events
(binder received or dead, permission answered) trigger a check at once.

The keeper touches only the phone's own hotspot (**Android hotspot** connection; internal `MANUAL` mode), never a joined Wi-Fi network.
The VPN also runs only with that connection: on a joined network the car cannot reach the extra address at all.

## Shizuku

TiPlay calls `network_management` from its own process through `ShizukuBinderWrapper`, so the call runs as the user
Shizuku runs as: the ADB shell user (uid 2000), or root with Sui. It never uses a Shizuku UserService (Shizuku 13.6.0's
`bindUserService` hangs on Android 17, RikkaApps/Shizuku#2180).

- The shell user holds `CONNECTIVITY_INTERNAL`, which `NetworkManagementService.setInterfaceConfig` accepts. Checked
  on Android 16 with [`tools/shell-address`](../tools/shell-address/README.md); the Android 17 source has the same chain.
- The interface name carries the alias `:tp` (`wlan2:tp`, at most 15 characters). Without an alias netd first clears
  the interface's IPv4, which cuts every device off the hotspot. The call itself (`NetworkManagementCall`) refuses any
  other name and any prefix but /32 before it reaches the binder, whoever calls it.
- `IllegalStateException` "File exists" means the address is already there and counts as success. A
  `SecurityException` after Shizuku has allowed TiPlay means the ROM blocks the shell user.
- Removing needs `NETWORK_STACK`, which the shell user lacks; the address goes when the hotspot restarts.
- Android lists a labelled address as a virtual interface of its own (`wlan2:tp`, libcore `NetworkInterface.getAll`),
  so the keeper and the settings also read the alias and the sub-interfaces.

Dependencies: `dev.rikka.shizuku:api` and `:provider` 13.1.5 (latest on Maven Central). `rikka.shizuku.ShizukuProvider`
is declared in `shared/src/main/AndroidManifest.xml` as Shizuku's documentation requires (authority
`${applicationId}.shizuku`, exported, `INTERACT_ACROSS_USERS_FULL`, not multiprocess).

### Non-SDK interfaces (targetSdk 37)

The call reaches hidden classes by reflection. Their status in the Android 17 lists (`frameworks/base` and
`packages/modules/Connectivity` at `android-17.0.0_r1`):

| Member | Status | Allowed at targetSdk 37 |
|---|---|---|
| `INetworkManagementService$Stub.asInterface(IBinder)` | `boot/hiddenapi/hiddenapi-unsupported.txt` | yes |
| `INetworkManagementService.setInterfaceConfig(String, InterfaceConfiguration)` | `@UnsupportedAppUsage`, no `maxTargetSdk` | yes |
| `InterfaceConfiguration()`, `InterfaceConfiguration.setLinkAddress(LinkAddress)` | `@UnsupportedAppUsage`, no `maxTargetSdk` | yes |
| `ServiceManager.getService(String)` (used by Shizuku's `SystemServiceHelper`) | `@UnsupportedAppUsage`, no `maxTargetSdk` | yes |
| `LinkAddress(InetAddress, int)` and the other constructors | `@SystemApi` only | no |

So TiPlay needs no exemption from the non-SDK interface restrictions. The one member apps may not call, the
`LinkAddress` constructor, is avoided: TiPlay builds the `LinkAddress` with the public `LinkAddress.CREATOR` from a
`Parcel` in the layout `LinkAddress.writeToParcel` uses, and checks the result with the public getters, so a future
layout change fails cleanly instead of sending a wrong address. The transaction code always comes from the device's own
`Stub.Proxy`; TiPlay never hard-codes one.

## VPN

`HotspotAddressVpnService` is separate from the wired path's `CarPlayVpnService`. Its tunnel:

- `addAddress(<address>, 32)` and no routes and no DNS servers, so TiPlay's own traffic finds no route in the tunnel and
  falls through to the hotspot (`local_network` rule) and the default network as before;
- `addAllowedApplication(<TiPlay>)`, so no other app's traffic is affected;
- `allowFamily(AF_INET6)`, so TiPlay's IPv6 is not black-holed; `setBlocking(false)`; `setMetered(false)` (metered only
  when the network underneath is);
- the file descriptor stays open and is never read or written.

The service never calls `startForeground`, so it needs no `foregroundServiceType` on Android 14 and later: while the
tunnel is up, Android binds the service itself (`BIND_FOREGROUND_SERVICE`) and shows its own VPN icon. It has no
`android.net.VpnService` intent filter and declares `SUPPORTS_ALWAYS_ON=false`, so it cannot be an always-on VPN.

Android ingress protection can drop packets that arrive on another interface for a VPN address
(CVE-2024-49734). Link-local addresses (169.254.0.0/16) are exempt, so VPN requires that range.
A previously saved CGNAT address stays saved for Root/Shizuku; VPN uses the default link-local address instead.

TiPlay does not fight other VPNs:

- Another app's VPN on (Android shows a VPN's owner only to the owner): TiPlay reports it and does not ask for consent,
  which would switch that VPN off. An always-on VPN of another app shows up the same way while it runs.
- The wired CarPlay VPN of TiPlay itself (an IPv6-only tunnel): one package has one VPN slot, and a second `establish`
  would replace the wired tunnel, so TiPlay waits. If the wired path takes the slot while the hotspot tunnel is up,
  Android drops the hotspot tunnel's binding without a revoke (only this package can replace it, and the new tunnel's
  addresses may not be visible yet): TiPlay closes it and starts it again at the next resume or connection once the
  wired tunnel is gone.
- The driver turns the VPN off in Android settings, or another VPN app takes over (`onRevoke`): TiPlay closes it and
  does not restart it by itself, neither on an activity resume nor on a new connection (`VpnService.prepare` there
  would also switch off another app's VPN that is still connecting). Only choosing VPN again or the "Allow the VPN"
  button starts it, after the same check for other VPNs. A TiPlay restart forgets the revoke.

Consent comes from `VpnService.prepare`, opened only from the chooser or the "Allow the VPN" button. The answer needs no
result handler: when the driver comes back, the activity's `onResume` starts the tunnel if Android allowed it.

## Diagnostics

The diagnostic report includes method, method in effect, keeper backend and state, VPN state,
and whether the address is the default or link-local. Never the address.
