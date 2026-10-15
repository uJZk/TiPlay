# TiPlay

Use CarPlay in your car's browser, powered by an Android phone.

TiPlay runs on the Android phone, connects to your iPhone over USB or wireless CarPlay, and sends the picture to the car browser. You control CarPlay by touching the browser screen.

[Download APK](https://github.com/uJZk/TiPlay/releases) · [Open browser player](https://ujzk.github.io/TiPlay/) · [简体中文](README.zh-CN.md)

## What you need

- An Android 9+ phone and an iPhone with CarPlay enabled.
- A car browser with WebCodecs support and network access to the Android phone.
- An Android hotspot or shared Wi-Fi network. Tesla browsers may need an [additional hotspot address](docs/Hotspot-address.md).

TiPlay is experimental and is not Apple-certified. Full iPhone/vehicle compatibility is still being tested. It supports Android phone + car browser use; native Android head units are outside its scope.

## Get connected

1. While parked, install the APK on the **Android phone**, open TiPlay and allow the requested permissions.
2. For wireless CarPlay, pair the iPhone with the Android phone over Bluetooth. For USB, use a data-capable cable.
3. In **Main settings**, select the iPhone and connection mode, then configure **Android hotspot** or **Existing Wi-Fi**. Enable the hotspot in Android settings if using one.
4. Connect the car to that network. Open the link shown by TiPlay in the car browser, enter the pairing code and select **Connect**.

See [Install and connect](docs/Install.md) for audio setup, permissions and troubleshooting. If the phone's address or port changes, reconnect using the updated link or edit **Android address** on the browser page.

## Everyday use

Settings save automatically; TiPlay reconnects CarPlay when needed. Tap the **TiPlay** icon in CarPlay to open the browser portal. Advanced settings contains video options, audio routing and diagnostic reports.

Music normally plays in the browser. Calls and Siri need the Android phone paired with the car's Bluetooth telephone profile and microphone permission. Alternatively, **Disable CarPlay audio** lets you use the iPhone's direct Bluetooth connection to the car. Both routes still need vehicle acceptance testing.

Experimental [AirPlay](docs/AirPlay.md) also supports mirroring, photos and compatible unprotected media. It starts by default and can be disabled in Advanced settings.

## Help and development

Save a report from **Advanced settings → Save diagnostic report**, review it for private information, and attach it to a [TiPlay issue](https://github.com/uJZk/TiPlay/issues). Include your phone, iOS, car/browser versions and steps to reproduce. Reports are not uploaded automatically.

[Documentation](docs/README.md) · [Build from source](docs/Build.md) · [Privacy](docs/Privacy.md) · [Changes](CHANGELOG.md)

TiPlay builds on [DiPlay](https://github.com/shihabal3amri/DiPlay) and [xcertplay](https://github.com/shilapi/xcertplay) (GPL-3.0), with UI and website work adapted from [DiAuto](https://github.com/shihabal3amri/DiAuto) (AGPL-3.0). See [credits and licenses](docs/Third-party-notices.md). It is not affiliated with Apple, Tesla or BYD.
