# Install and connect

TiPlay runs on an Android 9+ phone and displays CarPlay in a compatible car browser. Keep the car parked during setup.

## Install

Download the APK from [TiPlay releases](https://github.com/uJZk/TiPlay/releases) and install it on the Android phone. Open TiPlay and allow permissions for the features you use: Bluetooth/Nearby devices, Wi-Fi/Location, notifications and any system local-network request.

TiPlay installs separately from DiPlay. To keep settings and pairing records when updating TiPlay, install over the same application variant using the same signing key. Close other projection apps before connecting.

## Connect the iPhone and browser

1. In **Main settings**, choose your iPhone and **CarPlay connection mode**: All (USB first), Wireless or USB. Wireless needs Bluetooth pairing with the Android phone; USB needs a data-capable cable and approval of the requested USB/Trust/VPN dialogs.
2. Choose **Android hotspot** or **Existing Wi-Fi** and enter the network name, security and password. Turn on the hotspot in Android system settings, or join the existing network yourself. TiPlay does not do this for you.
3. Connect the car to the same network. For Tesla address restrictions and root/Shizuku/VPN options, follow [Hotspot address](Hotspot-address.md).
4. Open [the browser player](https://ujzk.github.io/TiPlay/) using the pairing link/code shown in TiPlay, then select **Connect**. First loading the HTTPS page requires internet access; a cached page may work offline. The browser needs WebCodecs and permission to reach the phone locally.

TiPlay applies valid settings automatically and keeps trying to connect when CarPlay is enabled. Use **Reconnect CarPlay** for a manual retry. If the phone's address or port changes, select **Disconnect** in the browser, change **Android address**, then **Connect**, or open the updated pairing link. The pairing code stays the same.

See [Connection setup](Connection-setup.md) for network and USB details, and [Browser](Browser.md) for pairing and browser restrictions.

## Set up sound

Music normally plays through the browser. For calls and Siri through TiPlay, pair the Android phone with the car's Bluetooth telephone profile and grant Android microphone permission. The browser does not capture microphone audio.

Alternatively, enable **Advanced settings → Disable CarPlay audio**, pair the iPhone directly with the car, and select it for audio/calls. Both audio routes still need real-vehicle validation.

## Settings and help

**Main settings** holds connection controls; **Advanced settings** holds video, audio, AirPlay and diagnostics. Valid edits save immediately and reconnect when necessary. **Disable CarPlay** stops startup and retries. **Start on boot** is subject to Android background restrictions and does not turn on the hotspot.

For a failure, update TiPlay, reproduce it and select **Advanced settings → Save diagnostic report**. Review the report before attaching it to [an issue](https://github.com/uJZk/TiPlay/issues). Include device/software versions, connection method, failure time and reproduction steps. Reports do not upload automatically; never include your hotspot password. See [Diagnostics](Diagnostics.md) and [Privacy](Privacy.md).
