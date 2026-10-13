# TiPlay

**CarPlay in the car browser from an Android phone.**

TiPlay runs on an Android phone and sends the iPhone's CarPlay picture and audio to the car browser. Touches return through the browser. Microphone demand switches Android to the car Bluetooth telephone channel for capture and call/Siri/navigation playback; other audio is discarded until browser playback resumes. Advanced settings can disable CarPlay audio so that the iPhone uses the car's Bluetooth connection for all sound and calls.

TiPlay supports the Android phone + car browser flow only. Native Android head units are not supported.

[Releases](https://github.com/uJZk/DiPlay/releases) · [Report a problem](https://github.com/uJZk/DiPlay/issues/new/choose) · [中文说明](README.zh-CN.md)

## Status and requirements

TiPlay is experimental and has no publicly published release yet. Check [Releases](https://github.com/uJZk/DiPlay/releases) for available APKs and follow the [installation guide](docs/INSTALL.md).

You need an Android 9+ phone, an iPhone and a compatible car browser. TiPlay installs alongside DiPlay and does not reuse its settings or pairing records. Run one projection app at a time.

On the tested Model Y, probe pages decoded 1080p60 H.264 and HEVC in hardware, and an HTTPS page reached the phone's hotspot at a 100.64 address. These were browser probes: complete CarPlay operation and browser playback and Android-to-car Bluetooth capture/switching in a Tesla remain unverified. Browser and Android behavior can vary with software updates.

## Install and connect

1. Park the car and install TiPlay on the Android phone. Grant the requested permissions for the features you use.
2. Pair the iPhone with the Android phone for wireless CarPlay. To use the car's Bluetooth for audio instead, pair the iPhone with the car, select it for audio and calls, and enable **Disable CarPlay audio** in TiPlay's advanced settings.
3. In TiPlay's **Main settings**, choose the iPhone and **CarPlay connection mode → Wireless / USB**. For wireless, choose **Android hotspot** and enter its name, security and password, or choose **Existing Wi-Fi** with all three devices on the same network. Enable the hotspot in Android settings; TiPlay does not enable it for you.
4. Connect the car to the same network. Tesla browsers need a reachable phone address outside the blocked private ranges; the tested route uses 100.64.0.0/10. See [Hotspot address](docs/HOTSPOT_ADDRESS.md) for root, Shizuku and experimental VPN requirements and limits.
5. The Android app keeps trying to connect CarPlay and applies valid settings automatically. Use **Reconnect CarPlay** when needed. Open the TiPlay page in the car browser, use the link/code shown by the app, then tap **Connect** on the page.

Follow [Install and connect](docs/INSTALL.md) and [Tesla browser setup](docs/TESLA_BROWSER.md) for the page address, USB permissions, pairing and troubleshooting. The page needs HTTPS and a browser with WebCodecs; first load requires internet access, then its cache can support offline use.

## Use and settings

CarPlay fills the browser video area. Tap its **TiPlay** icon to open the portal while keeping the session connected. Window changes fit immediately; after the size settles, TiPlay automatically reconnects CarPlay at the matching resolution. The portal also offers **Apply and reconnect** for a manual retry.

The app has **Main settings** and **Advanced settings**. Main settings holds the connection and browser controls. Advanced settings holds frame rate, HEVC, driving side, diagnostic reports and permissions. Frame rate defaults to 60 fps on a fresh install; saved choices remain. HEVC defaults on without a saved codec choice; turn it off for H.264 compatibility. Advanced video/control changes save immediately for the next connection; **Return and apply** returns to the main page and reconnects a running session.

Experimental [AirPlay mirroring and video casting](docs/AIRPLAY.md) is available from Main settings. It temporarily pauses the CarPlay picture and restores a still-connected session when casting ends. **Advanced settings → Disable AirPlay** defaults off and stops the receiver immediately when enabled. This preview is video-only and still needs real iPhone/car validation.

**Start on boot** is saved immediately and starts TiPlay when Android starts. **Disable CarPlay** in Advanced settings stops CarPlay connections and retries. Android or device background-launch restrictions can prevent it. Enable the hotspot separately.

## Limitations and help

This is an experimental, **non-Apple-certified** product. Compatibility with future iOS versions is uncertain. See the [identity notice](docs/THIRD_PARTY_NOTICES.md#experimental-authentication-data).

For a problem, reproduce it on the latest TiPlay build and use **Advanced settings → Save diagnostic report**. Android 10+ normally saves to **Downloads/TiPlay**; Android 9 uses a document picker. If saving falls back to app storage, the confirmation identifies the location and offers **View report** and **Share**. Reports upload only when you choose to share them. Review the text and never post your hotspot password.

Attach the report to an [existing issue](https://github.com/uJZk/DiPlay/issues) or [create one](https://github.com/uJZk/DiPlay/issues/new/choose). Include Android device/version, car/browser version, iPhone/iOS, connection method, reproduction steps and failure time. Report TiPlay problems here, not to upstream DiPlay.

- [Existing Wi-Fi setup](docs/EXISTING_WIFI.md)
- [Privacy and diagnostic reports](docs/PRIVACY.md)
- [Changes](CHANGELOG.md)

The app and download website offer English, Arabic, Russian, Ukrainian, Spanish, Japanese, Simplified Chinese and Traditional Chinese (Taiwan). Hong Kong/Macao and Hant selections use the Taiwan translation. Choose the app language in Main settings; Android 13+ synchronizes it with Android's per-app language setting.

## Credits and licenses

TiPlay is based on [DiPlay](https://github.com/shihabal3amri/DiPlay) by shihabal3amri and [xcertplay](https://github.com/shilapi/xcertplay), GPL-3.0. Its home/settings UI and website adapt [DiAuto](https://github.com/shihabal3amri/DiAuto), AGPL-3.0. See [credits and licenses](docs/THIRD_PARTY_NOTICES.md). TiPlay is not affiliated with or endorsed by Tesla, Apple or BYD. Tesla and CarPlay are trademarks of their respective owners.
