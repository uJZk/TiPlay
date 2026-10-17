# Android image sources

| Image | Actual product view |
| --- | --- |
| `android-home.png` | `BrowserMainSettingsMenu.kt` — Main settings |
| `android-settings.png` | `BrowserAdvancedPage.kt` — Advanced settings |

The app UI was rendered from the current TiPlay Android Views with Robolectric
4.17 native graphics, Android SDK 33 and the `en-w412dp-h892dp-xxhdpi`
configuration. The 1236 × 2676 captures were scaled proportionally into the phone
presentation. Text and controls were not redrawn by image generation.

The capture fixture simulates granted permissions, a configured hotspot, an
available iPhone, and connected CarPlay / ready AirPlay states. These demonstrate
normal use; they are not physical-phone captures or live vehicle verification.

The device exterior and light background are image-generated presentation
artwork. A separate simulated Android status bar shows 9:41, cellular signal,
Wi-Fi and 87% battery, with a centered camera cutout. Its space is reserved above
the app UI, leaving the title and controls unobscured. Final images are
1024 × 1567.
