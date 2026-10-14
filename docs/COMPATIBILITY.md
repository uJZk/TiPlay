# Compatibility

This public preview is an independent receiver, not an Apple-certified CarPlay accessory. The experimental bundled accessory identity is extractable and its future acceptance is not guaranteed.

| Area | Current scope |
| --- | --- |
| Current TiPlay profile | Android phone + car browser. Enabled CarPlay audio plays in the browser; Siri/call microphone demand uses verified car Bluetooth HFP/SCO for capture, voice and navigation while browser music and AirPlay audio continue. Head-unit-only display/audio/navigation/vehicle controls are hidden. |
| Retained upstream head-unit code | Compatibility files and historical evidence only; not a supported TiPlay product or current acceptance requirement. The legacy Android 9 Wi-Fi Direct path has unverified requested frequency; Android 10+ can verify frequency. |
| Phone | Standard, non-jailbroken iPhone with CarPlay enabled; device/iOS compatibility varies |
| Historical physical evidence | Previous private native-head-unit builds: wired and wireless picture, touch and audio confirmed on the development car with iPhone XS / iOS 18.7.10; this does not validate the current browser media path. |
| Other cars | Mixed community reports across DiLink generations; not a certified model support list |
| 0.2.13 evidence | Automated source/build validation and attributed contributor tests; no new complete-release vehicle test or universal model support is claimed. Earlier DiLink5.1 HUD/hotspot results remain historical evidence. |
| Wi-Fi | Auto uses eligible saved/aligned channels; beside a 5 GHz station, explicit 2.4 GHz precedes other 5 GHz/unpinned default fallbacks. Manual channels stay explicit; no band/performance guarantee. |
| Video | Fresh phone + browser CarPlay settings default to HEVC / 60 fps; saved preferences remain effective. The shared frame-rate setting also applies to mirror negotiation; mirror codec and device limits are in [AirPlay](AIRPLAY.md). The browser must support the negotiated WebCodecs decoder. URL video uses Video.js/browser decoding and its source frame rate. |
| Buffered music | Enabled CarPlay audio always offers `mainBuffered`; AAC-LC buffering starts only if the iPhone negotiates type 103. No buffered-music product toggle. Standalone ordinary AirPlay audio casting is unsupported. |

Head-unit features below describe retained upstream-compatible code and historical tests. Current TiPlay forces the phone + browser profile and disables BYD outputs, cluster maps, wheel-key integrations, ADB vehicle data and automatic car-hotspot startup.

## BYD HUD and car hotspot

See [BYD navigation](BYD_NAVIGATION.md) for the exact verified firmware and lifecycle limits. Earlier car-hotspot builds started CarPlay on the development car using scoped IPv6. Current access-point endpoints prefer usable IPv4 and retain scoped IPv6 fallback. The phone must join the configured car hotspot. Neither result guarantees support on every firmware.

## Android 9 Wi-Fi Direct and experimental features

The Android 9 path creates or reuses a persistent system profile with the public legacy group API, reads generated credentials and uses the firmware channel setter where available. It serializes pinning/cancellation, avoids foreign groups and removes only its owned active group; persistent profiles are not deleted. Unknown setter outcomes stop startup, and unreliable pinning/cleanup should use the manual car hotspot. See [legacy limits](ANDROID9_WIFI_DIRECT.md); the contributor's Redmi K20 Pro result does not validate every BYD Android 9 firmware.

Historical native-head-unit DiLink 3 call controls/dashboard cards and AAC-LC buffered-music opt-in were independent default-off experiments. Their source regression coverage does not establish current phone + browser acceptance. Browser buffered music is offered whenever CarPlay audio is enabled; physical pause/resume, interruption and HFP/SCO route checks remain pending. See [buffered music](BUFFERED_AUDIO.md) and [browser media](BROWSER-MEDIA-2026-10-13.md). DiLink 4 casting/picture fixes describe the tested 2022 Seal setup, not a Qin/Seal-wide guarantee. The Android 13+ hotspot join helper requires strict user-configuration/5 GHz/API/ADB gates and explicit confirmation. See [0.2.13 release notes](RELEASE-NOTES-0.2.13.md).

## Known limitations

References to native head units, BYD firmware and vehicle automation below retain
upstream compatibility and contributor evidence. They do not add a supported
head-unit product or new head-unit acceptance work for TiPlay. Current phone +
browser limits include network reachability, browser codec support and physical
HFP/SCO verification.

- If the iPhone leaves its current Wi-Fi network but does not join the car hotspot, check that Auto-Join is enabled for that hotspot. If selecting it manually starts CarPlay without a password prompt, record that distinction in the diagnostic report. AP broadcast information elements can affect automatic joining even when credentials and the subsequent CarPlay transport work. See [automatic hotspot joining](WIRELESS_HOTSPOT_JOIN.md) for Apple's documented requirements and a controlled comparison; this does not establish a supported fix for every head unit or iOS version.
- Some units stutter, particularly under higher video load. A 2.4 GHz link alone does not prove the cause: interference, firmware and decoder stalls can all contribute. Try Default icons, 30 fps and a lower resolution, then attach a report.
- For the Wi-Fi channel and the picture size that gave the smoothest result on a BYD Tang, and why, see [Smooth wireless CarPlay](SMOOTH_WIRELESS.md).
- A contributor reported periodic wireless CarPlay stutter on a 2023 Han with GCC DiLink 3 when the car's Wi-Fi client was disconnected: scans every 10 s took the radio off the CarPlay channel for 3-6 s. On Android 10, with network ADB already authorized and the framework transaction available, TiPlay pauses connectivity scans for hotspot/P2P sessions. Same LAN is excluded so station reconnect and roaming remain available. Controller leases share one serial worker; scans restore after the last lease closes. A durable marker precedes suppression, failed restores retry every 30 s while the app runs, and app startup recovers an interrupted restore. A force-stop can delay restoration until the app is opened again. Missing approval or transaction support leaves scans alone. The retained native lifecycle follow-up was a parked vehicle retest; it is not a current TiPlay head-unit acceptance requirement. Without ADB, joining the car to a hotspot also slowed scans in the contributor's test.
- Some iOS/head-unit combinations do not visibly apply icon and text size. Reconnection is implemented; that does not guarantee the iPhone chooses the requested layout.
- A radio that supports joining a 5 GHz network may still reject a 5 GHz Wi-Fi Direct group. The capability flag is diagnostic, not proof of group-owner support.
- Automatic startup depends on the car's firmware and startup permissions.
- USB requires a data port and correct host/device-role behavior.
- Calls, Siri, background reconnection, long journeys and future iOS releases need broader testing.

Reports record requested frequencies, station association state, fallback failures and remembered-configuration events. Android 10+ can verify the actual group frequency; Android 9 reports its accepted channel request as unverified and system-default as channel 0. Wi-Fi credentials and protocol payloads are excluded. A successful hotspot is not itself a successful CarPlay session.

Android references: [SupplicantState](https://developer.android.com/reference/android/net/wifi/SupplicantState), [explicit P2P operating frequency](https://developer.android.com/reference/android/net/wifi/p2p/WifiP2pConfig.Builder#setGroupOperatingFrequency(int)).
