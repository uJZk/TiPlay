# Install and connect

1. Park the car. Download the latest `TiPlay-<version>.apk` from [TiPlay releases](https://github.com/uJZk/TiPlay/releases). You can also [build the APK from source](BUILD.md).
2. Install on the Android device that shares its hotspot with the car. The current TiPlay profile displays CarPlay in the car browser; head-unit features remain in source for upstream compatibility. Do not install on the iPhone. TiPlay uses the package `com.ujzk.tiplay`, so it installs next to DiPlay and does not update it or keep its settings. For an in-place TiPlay update that preserves settings and pairing records, use the same package/variant and a matching signing certificate.
3. Open TiPlay. Grant the permissions requested for the features you use: Bluetooth/Nearby devices, Wi-Fi/Location on older Android, and Android 17 local-network access when requested. Grant Android microphone permission for calls/Siri, and connect the Android phone to the car Bluetooth telephone profile. The browser does not ask for microphone permission; it may still require local-network access to reach Android. Idle audio plays in the browser; recording demand switches to the Android-to-car telephone channel, with navigation at fixed 25% gain. The complete route still needs vehicle validation. Allow notifications for connection controls.
4. Close other phone-projection apps before connecting. Follow [Tesla browser setup](TESLA_BROWSER.md) to open and pair the car page. To send all sound and calls through the iPhone-to-car Bluetooth connection, enable **Advanced settings → Disable CarPlay audio** and select the iPhone for car audio/calls. Both audio routes still need vehicle validation.

## Connection mode

On the TiPlay main page, choose **CarPlay connection mode → All (USB first) / Wireless / USB** above the iPhone chooser. Valid changes save and apply automatically; use **Reconnect CarPlay** for a manual retry. All mode tries USB first and falls back to wireless. When CarPlay is enabled, valid idle edits may resume connection preparation. **Start on boot** saves immediately and starts TiPlay when Android starts; Android or OEM background launch restrictions can prevent it. **Advanced settings → Disable CarPlay** independently stops CarPlay startup and retries. The retained connect-on-open preference has no main-page switch. Advanced settings includes the system battery-optimization settings entry, with system settings as fallback.

## Wireless

Select **Android hotspot** on the TiPlay main page, turn on the Android hotspot at 5 GHz if available, and save its exact name and credentials. Choose security before entering the password; Open hides the password field. Keep Bluetooth and Wi-Fi enabled on the iPhone and pair it with the Android device. TiPlay continuously attempts CarPlay when enabled; use **Reconnect CarPlay** when needed. On compatible firmware, the Bluetooth handshake supplies hotspot credentials for automatic joining; core CarPlay does not require ADB. If the iPhone does not join automatically, record whether manual joining starts CarPlay. The retained [experimental join repair](WIRELESS_HOTSPOT_JOIN.md) requires eligible firmware and is not exposed on the current browser pages. **Choose iPhone** changes the selected paired device.

**Existing Wi-Fi** connects through an external router or portable Wi-Fi: connect the Android device, car browser and iPhone to the same network, disable router client isolation, and save that network on the TiPlay main page. Keep Bluetooth enabled. TiPlay does not join the network or change the default route for you; see [Existing Wi-Fi setup](EXISTING_WIFI.md). USB remains available.

Wi-Fi Direct and its preferred-channel implementation remain in source, but the current browser connection chooser exposes only the manual hotspot and Existing Wi-Fi backends. A previously saved Wi-Fi Direct choice is displayed as manual hotspot. The retained Android 9 compatibility and channel checks in [Android 9 Wi-Fi Direct](ANDROID9_WIFI_DIRECT.md) and [testing](TESTING.md) apply to builds that expose that backend.

Automatic BYD car-hotspot startup is retained in source, but its head-unit ADB controls are hidden by the current browser profile. Enable the Android hotspot using its system settings.

## USB

Connect the iPhone to the Android device's USB **data** port with a data-capable cable and select **CarPlay connection mode → USB**. TiPlay applies the mode immediately; use **Reconnect CarPlay** when needed. Approve USB access, Trust/CarPlay and the local VPN permission if requested. The local VPN carries the USB network link; it is not an internet VPN service. Charge-only ports/cables cannot work.

## Settings

Open **Main settings** from the app or swipe down in CarPlay with the saved gesture finger count (three by default). The browser product has only **Main settings** and **Advanced settings**; the current pages do not expose a gesture-finger chooser.

The browser reports its canvas size. In **Advanced settings**, choose frame rate (30–60 fps, 60 by default on a fresh install) and **HEVC (H.265)**. HEVC defaults on when no codec choice has been saved; turn it off for H.264 compatibility. Valid video, audio and driving-side changes save and apply immediately; TiPlay reconnects automatically when negotiation is needed and keeps the settings page open. Main settings also applies valid connection edits automatically; incomplete or invalid network fields remain drafts until valid.

The browser picture follows the window immediately; once its size settles, CarPlay automatically reconnects to match the native resolution. **Apply and reconnect** on the browser portal remains available for manual retry. Tap the **TiPlay** icon inside CarPlay to open that portal without disconnecting the session.

The current profile uses browser audio by default, demand-switched Android-to-car Bluetooth telephone audio/capture, browser light/dark appearance and no Android location reporting. **Disable CarPlay audio** instead leaves sound and calls on the iPhone-to-car Bluetooth connection. Head-unit display scaling, BYD navigation, vehicle data, wheel keys and audio-output controls are hidden. Their retained implementation and vehicle checks do not establish browser support.

The app and release website offer seven languages, including Traditional Chinese (Taiwan). Android 13+ app-language selection is synchronized with Android settings; Android 9–12 retain a saved context override. Hong Kong/Macao and Hant use the Taiwan app translation, not separate regional editions.

Open [the browser page](https://ujzk.github.io/TiPlay/play/) or the pairing link shown by Android. Hotspot address/port edits apply immediately on the phone and do not notify the browser. After editing them, tap **Disconnect** on the browser page, change **Android address** and tap **Connect**, or open the updated pairing link. The pairing code remains; browser addresses and bookmarks are not migrated automatically.

## Connection recovery and reports

Updating in place is preferable to uninstalling. Wi-Fi Direct group reset remains an upstream compatibility control and is not exposed on the current browser pages.

Please reproduce unresolved problems on the latest TiPlay build and export a fresh report, even if you already sent older logs. Capture from the first connection attempt through the failure; for boot/auto-start problems, reboot and then open TiPlay manually to export. Use **Advanced settings → Save diagnostic report**. Android 10+ saves to **Downloads/TiPlay**; Android 9 uses a document picker. If the picker or Downloads storage is unavailable, the fallback TXT file is saved under **Android/data/com.ujzk.tiplay/files/diagnostic-reports/**; the confirmation shows its exact path. If external storage is also unavailable, TiPlay saves the report privately. Both fallbacks offer **View report** and **Share**; select/copy text in the report view when no sharing app is available. Review the `.txt` file, then attach it to your existing [GitHub issue](https://github.com/uJZk/TiPlay/issues) or [create a new issue](https://github.com/uJZk/TiPlay/issues/new/choose), with Android device/version, car/browser version, iPhone/iOS, connection method (USB, Android hotspot or Existing Wi-Fi), relevant settings, expected/actual behavior, reproduction steps and approximate failure time. Never include your hotspot password. Nothing is uploaded automatically.

The additional wireless/media/theme/own-app-exit records help identify the failing stage; they do not establish Qin Plus startup, Wi-Fi Direct stutter, Siri, iOS 15 or day/night firmware reports as resolved. See [DiPlay 0.2.13 release notes](RELEASE-NOTES-0.2.13.md).

APK installation restrictions are controlled by the Android device. ADB installation is optional, not an app runtime requirement:

```sh
adb install -r TiPlay-<version>.apk
```

Only use a trusted computer. A different signing certificate cannot update this build; do not uninstall until you have saved any reports you need.

## BYD navigation

BYD navigation controls are hidden in the current browser profile. The retained head-unit implementation is documented in [BYD navigation displays](BYD_NAVIGATION.md), including firmware scope, map metadata and authorized-ADB requirements.
