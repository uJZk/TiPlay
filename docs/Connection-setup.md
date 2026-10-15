# Connection setup

Install TiPlay on the **Android phone** and open the [TiPlay browser page](https://ujzk.github.io/TiPlay/) in the car. The iPhone supplies CarPlay; the Android phone connects it to the browser. Use [Installation](Install.md) for APK requirements and [Browser setup](Browser.md) for pairing, permissions and browser compatibility. Keep the vehicle parked during setup.

## Android hotspot

1. Turn on the Android phone's hotspot in Android settings. Prefer 5 GHz when available. Connect the car browser to that hotspot.
2. In TiPlay Main settings, choose **Android hotspot**. Enter its exact name, security type and password. TiPlay does not create the hotspot for you. Root mode optionally imports credentials after an explicit tap; other modes use manual entry.
3. Select a **TiPlay mode** suitable for the browser's address restrictions. Standard uses the existing address; Root, Shizuku and VPN have different requirements. Follow [Hotspot address methods](Hotspot-address.md).
4. Choose the CarPlay transport: Wireless, USB, or All (USB priority). For wireless, enable Bluetooth and Wi-Fi on the iPhone and Android phone, pair them in system settings, then use **Choose iPhone**. Accept requested Android permissions and iPhone CarPlay prompts. Normal wireless bootstrap sends the network details to the iPhone; manually joining it first is unnecessary.
5. Open the copied pairing link in the car browser and allow any requested browser permissions. Save a bookmark after the pairing fragment has been consumed. TiPlay maintains CarPlay recovery automatically while enabled and the browser is ready.

USB changes the iPhone-to-Android data connection; the browser still needs its network connection. Android's normal USB permission dialog applies. A source-only development APK lacks accessory authentication; successful iPhone negotiation needs the external runtime identity described in [Build](Build.md).

## Existing Wi-Fi

Join the Android phone, iPhone and car browser to the same router or portable Wi-Fi in system settings. Select **Existing Wi-Fi** in TiPlay and enter the exact SSID, security and password. Keep Bluetooth enabled for wireless bootstrap. Supported choices are Open, WPA2, WPA2/WPA3 transition and WPA3 Personal; secured passwords require 8–63 characters. Open uses no password. Enterprise authentication and captive portals are outside this mode's scope.

Allow communication between clients and multicast DNS; disable router client isolation. The browser must also permit the Android endpoint's address. Hotspot extra-address methods do not apply to joined Wi-Fi. A router's internet access does not prove local reachability, and TiPlay does not require Android's Internet validation for its LAN connection.

Valid changes save automatically and can reconnect CarPlay without closing settings. Incomplete edits stay in the form. If Android hides the current SSID, check it manually in Android settings; location permission and enabled system location can make network details readable, but are not required merely to start this mode.

`ExistingWifiManager` attaches to one non-VPN Wi-Fi Network without joining a network, creating an AP or changing default routing. Readable SSID/security must match the selection; Android 12+ checks readable security, with transition mode accepting PSK or SAE. Unknown/redacted details cannot prove a match. The backend prefers scoped link-local IPv6, retains usable IPv4 too, and shares the actual listener port across discovery/address families. Network, interface or address loss rebuilds the session; closing TiPlay does not disconnect Wi-Fi.

If setup stalls, reproduce once and save a [diagnostic report](Diagnostics.md). Record Android/iPhone versions, exact APK, transport, visible symptom, time and last completed connection step. Automated tests or older native-head-unit reports do not establish compatibility with this phone, iPhone and car browser.

## Android car Bluetooth connection hint

The Android main settings page observes the live A2DP and HEADSET/HFP profiles and their connection broadcasts, excluding the selected iPhone. Pairing and the iPhone RFCOMM link do not establish a car audio connection. A connected device advertising the car-audio Bluetooth class clears the hint; an unclassified audio device asks the driver to confirm it is the car. Two successfully queried empty profiles show the missing-connection hint. Missing permission, unavailable profiles or failed reads show an unknown-state hint. This observation cannot establish the separate iPhone-to-car connection or prove that audio is audible.
