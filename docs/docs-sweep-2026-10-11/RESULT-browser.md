# Browser documentation result

Date: 2026-10-11. Reviewed all nine browser documents listed in groups.json. Documentation changes only; no application/configuration changes, commits or pushes.

## Corrections

- BUILD and INSTALL now describe the current Android phone browser receiver profile, rather than instructing users to enable hidden head-unit features.
- INSTALL host-menu routes use the actual More Diagnostics/More Connection settings buttons, direct Connection backend controls and bottom gesture button.
- INSTALL scopes Wi-Fi Direct and preferred-channel guidance to retained implementations; the current chooser exposes manual hotspot and Existing Wi-Fi.
- INSTALL and next release notes match BrowserSettingsPolicy: phone + browser, standard car Bluetooth sound, browser theme, location disabled, split-screen enabled, no run-mode/audio-route switch. The retained head-unit test matrix is explicitly scoped in TESTING instead of presented as current visible controls.
- TESLA_BROWSER documents Normal/Root/Shizuku/VPN hotspot address methods, shell-test scope and remaining vehicle checks. Corrected Android VPN version scope and removed the unverified Tesla link-local-access guarantee.
- TESLA_BROWSER and todo now use the actual fresh-install 30 fps default, with 60 fps selectable in the CarPlay menu and explicit save/reconnect behavior.
- Privacy and pairing copy distinguishes the fragment withheld from the static host from pairing credentials sent to the phone in authenticated HTTP requests; corrected lockout scope.
- Chinese todo marks the implemented phone/browser mode complete, distinguishes the hidden earlier audio choice, fixes main-thread video fetch and relative references, and scopes unimplemented WheelPlay import ideas separately from existing implementations.
- E2E README distinguishes the recorded Chromium codec limitation from conditional native H.264 MSE checks. Shell tool README documents its working directory, usage-error output and the narrower meaning of successful shell address insertion.

## Evidence and verification

Reviewed BrowserSettingsPolicy.kt, DiPlayActivity.kt, CarPlaySettingsNavigation.kt, AirPlayPersistence.kt, CarPlayHostActivity.kt, TeslaBrowserLinkCard.kt, TeslaBrowserPageLinks.kt, TeslaBrowserCanvas.kt, CarBluetoothAudio.kt, browser server/pairing gate and page fetch/cache implementation, E2E scripts, AddAddr.java, Android/Pages workflows and build settings. All relative Markdown file targets in assigned documents exist; assigned-document diff whitespace check passed. Coordinator owns required Android CI and Node browser tests; no independent test-pass claim is made here.

## Remaining findings

- Explicit link-policy conflict: AGENTS requires current project links on uJZk/DiPlay, and code/static-site fallbacks still use /DiPlay/, while Pages configuration comments and the dated deployment record identify /TiPlay/. Preserved mandated links/default examples and surfaced this conflict beside the deployment record; changing code/config or link policy is outside this assignment.
- Historical Tesla probe IDs, Carlinkit disassembly offsets, Android source/hidden-API claims and remote Shizuku issue status cannot be independently reproduced from the repository. Preserved their dated evidence and existing limits; no current vehicle guarantee inferred.
- Complete Tesla video/audio, hotspot restart, Shizuku authorization on Android 17 and VPN/link-local reachability remain vehicle acceptance work. Head-unit checklists require a build exposing the retained controls.
