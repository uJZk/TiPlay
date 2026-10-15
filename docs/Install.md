# Install and connect

TiPlay runs on an Android 9+ phone and displays CarPlay in a compatible car browser. Keep the car parked during setup.

## Install

Download the APK from [TiPlay releases](https://github.com/uJZk/TiPlay/releases) and install it on the Android phone. Open TiPlay and allow permissions for the features you use: Bluetooth/Nearby devices, Wi-Fi/Location, notifications and any system local-network request.

On the first launcher open, **Permission checklist** shows the current Android grants and required system settings directly. **Allow missing permissions** requests only applicable missing runtime grants; individual rows open Bluetooth, battery optimization and app settings, and USB modes also offer VPN consent. Returning from system settings refreshes the actual state. Microphone permission is omitted when CarPlay sound is disabled; location permission is omitted when location forwarding is disabled. USB-device consent is requested by Android when the device is attached.

The checklist does not start a receiver or configure the iPhone, network, sound or startup. Set those options in Main settings or Advanced settings. Missing permissions or system settings require an explicit **Continue for now** confirmation; TiPlay does not treat that choice as a grant. Back exits without marking completion, and rotation rechecks the current permissions. Completing the checklist opens Main settings; later launcher opens go there directly. Reopen it from **Main settings → Permission checklist**. Advanced settings has no duplicate permission list. Existing setup-completion preferences remain valid. USB attachment and authorized automatic startup keep their existing entry paths.

TiPlay installs separately from DiPlay. To keep settings and pairing records when updating TiPlay, install over the same application variant using the same signing key. Close other projection apps before connecting.

## Connect the iPhone and browser

1. In **Main settings**, choose your iPhone and **CarPlay connection mode**: All (USB first), Wireless or USB. Wireless needs Bluetooth pairing with the Android phone; USB needs a data-capable cable and approval of the requested USB/Trust/VPN dialogs.
2. Choose **Android hotspot** or **Existing Wi-Fi** and enter the network name, security and password. Turn on the hotspot in Android system settings, or join the existing network yourself. TiPlay does not do this for you.
3. Connect the car to the same network. For Tesla address restrictions and root/Shizuku/VPN options, follow [Hotspot address](Hotspot-address.md).
4. Open [the browser player](https://ujzk.github.io/TiPlay/) using the pairing link/code shown in TiPlay, then select **Connect**. First loading the HTTPS page requires internet access; a cached page may work offline. The browser needs WebCodecs and permission to reach the phone locally.

TiPlay applies valid settings automatically. When CarPlay is enabled, it waits for the car browser to connect and report screen size and decoder support before attempting to connect the iPhone. It selects HEVC automatically when supported, otherwise H.264. Before the browser is ready the status reads **Waiting for browser connection**. Automatic problems appear below the status; results from an explicit setting action appear below that control. If the phone's address or port changes, select **Disconnect** in the browser, change **Android address**, then **Connect**, or open the updated pairing link. The pairing code stays the same.

See [Connection setup](Connection-setup.md) for network and USB details, and [Browser](Browser.md) for pairing and browser restrictions.

## Set up sound

Music normally plays through the browser. For calls and Siri through TiPlay, pair the Android phone with the car's Bluetooth telephone profile and grant Android microphone permission. The browser does not capture microphone audio.

Alternatively, enable **Advanced settings → Disable CarPlay audio**, pair the iPhone directly with the car, and select it for audio/calls. Both audio routes still need real-vehicle validation.

## Settings and help

**Main settings** holds connection controls; **Advanced settings** holds video, audio, AirPlay and diagnostics. Valid edits save immediately and reconnect when necessary. **Disable CarPlay** stops startup and retries. **Start on boot** is subject to Android background restrictions and does not turn on the hotspot.

For a failure, update TiPlay, reproduce it and select **Advanced settings → Save diagnostic report**. Review the report before attaching it to [an issue](https://github.com/uJZk/TiPlay/issues). Include device/software versions, connection method, failure time and reproduction steps. Reports do not upload automatically; never include your hotspot password. See [Diagnostics](Diagnostics.md) and [Privacy](Privacy.md).
