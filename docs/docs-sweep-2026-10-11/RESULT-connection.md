# Connection documentation result

Reviewed all ten `connection` files in `groups.json` on 2026-10-11. No application
or configuration changes, commits or pushes were made. Android and browser CI are
owned by the coordinator; this result reports documentation review only.

## Changes and evidence

| Document | Outcome and evidence |
| --- | --- |
| `ANDROID9_WIFI_DIRECT.md` | Marked as retained backend guidance, since `DiPlayActivity.wirelessLinkControls` offers only MANUAL and EXISTING_WIFI. Android 9 channel/cleanup limits match `WifiP2pGroupManager` and `WifiP2pLegacyChannels`; no physical BYD acceptance claim added. |
| `CONNECTION_RELIABILITY.md` | Fixed BUILD anchor to `#build-a-standalone-car-test-apk`, confirmed by the browser-scope owner. Queue claims match `UsbReadQueuePolicy` (one 16 KiB retry after explicit false, remembered only after success) and `BluetoothRfcommDuplexStream` consumption notification. Preserved dated 2026-10-06 results and untested vehicle rows. |
| `CONNECTION_SETUP.md` | Scoped car-install instructions to the retained head-unit workflow, linked current browser setup, corrected settings categories, ADB hotspot eligibility, Android 9 unverified-channel distinction and cluster automatic-setup location. Evidence: `BrowserSettingsPolicy.activate/hiddenSections`, `DiPlayActivity.SettingsInformationArchitecture`, `bydAdbSettings`, `renderBydAdbControls`, `advancedVehicleDataSettings`, CLUSTER_MAP block and `CarHotspotSetup`. |
| `EXISTING_WIFI.md` | Corrected current category path and removed the nonexistent Wireless subpage. Selection, redacted SSID fallback, address families, no route mutation and callback close match `ExistingWifiManager` and wireless backend integration. Preserved the contributor's bounded BYD acceptance report. |
| `HOTSPOT_ADDRESS.md` | No verified defect requiring an edit. Keeper refusal/cleanup/backoff and VPN consent/revoke behavior match the retained implementations; Shizuku 13.1.5 matches `gradle/libs.versions.toml`. External/current-version claims remain limited as below. |
| `HOTSPOT_JOIN_VALIDATION.md` | Dated software results as the historical snapshot recorded 2026-10-05, the last document commit (`2d4e367`), rather than implying current test totals. Preserved all counts, observations and remaining acceptance boundaries. |
| `LOCAL_HOTSPOT_TEST.md` | Preserved already-labelled historical notes, old product/settings labels and dated parked-car measurements. Internal reservation/radio implementation remains; this is not current product setup. |
| `SMOOTH_WIRELESS.md` | Marked measurements and hidden controls as retained head-unit guidance. Corrected Advanced category paths and documented rotation's next-connection application and smooth-video reconnect behavior. Numerical pacing description matches `FramePacer`, `PacingDelay`, `AndroidMediaSink` and `VideoStats`. |
| `WIRELESS_DIAGNOSTICS.md` | Corrected rendered-video handoff fallback: Bluetooth is preserved for iAP2 until a later ready tunnel releases it. Evidence: `CarPlayController.handleWirelessHandoffTimeout`, `maybeCompleteWirelessHandoff`, status strings, and 45-second watchdog constant. Saved-history proof still requires authenticated tunnel and rendered frame. |
| `WIRELESS_HOTSPOT_JOIN.md` | Marked the repair UI workflow as earlier guidance: the current activity declares/closes `hotspotJoinControls` but never attaches it. Preserved experiment/rollback limits. Transaction, journal, shell UID, permissions, deadline, cancellation and framework identity claims match `HotspotJoinRepair*`, `HotspotJoinTransaction`, `HotspotJoinJournal`, `HotspotJoinPlatform` and `HotspotJoinFirmware`. |

## Checklist outcomes

- [x] Current product names use TiPlay; historical DiPlay observations and internal identifiers were preserved.
- [x] Assigned numbered upstream issue/PR references remain on `shihabal3amri/DiPlay`. No assigned current project URL required retargeting; no assigned link-policy conflict was found. Other-scope configuration conflicts belong to the coordinator.
- [x] Packages, classes, resources, preferences, actions and environment identifiers were preserved.
- [x] No upstream submission or one-way-sync rule changed.
- [x] Settings category ownership, experimental suffixes, consent and next-connection behavior checked where applicable; current hidden controls explicitly scoped.
- [x] Repository-verifiable claims checked against code/configuration. Historical evidence retained without converting it into current acceptance.
- [x] Relative file targets in all ten documents exist. Fixed the one broken heading reference using the owning agent's confirmation. Overlapping guides now distinguish current browser use from retained head-unit workflows.
- [x] Legal/vendor originals, generated outputs and raw logs unchanged.
- [x] Edits restricted to assigned documents, this result and the connection TASKS section.

## Uncertainty and validation limits

Existing Wi-Fi device observations, the Android 9 Redmi bring-up, Tang smoothness
measurements and the OnePlus add/remove/re-add experiment cannot be independently
reproduced from this checkout. Several observations lack an exact execution date;
no date or new device guarantee was invented. The hotspot-repair snapshot date is
its repository recording date, not an assertion about the hardware experiment date.

The statement that Shizuku 13.1.5 is "latest on Maven Central", Android 16/17
permission/reflection claims, Tesla address reachability and public platform/vendor
requirements require external source or hardware validation. Repository code/config
supports the implementation descriptions, but this sweep does not certify those
external claims. Existing hardware acceptance limits and the untested 169.254 browser
case remain explicit.

Assigned-file `git diff --check` passed. A local relative-link existence scan checked
all ten documents without missing file targets. No application tests were duplicated;
the coordinator will record required Android CI and Node browser results.
