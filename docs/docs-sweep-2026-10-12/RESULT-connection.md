# Connection documentation review — 2026-10-12

Reviewed the ten connection documents assigned in TASKS.md against current source at
`5449de24d399f9e4e1ce1124e7066d906df98813`, with incremental baseline
`92cc2efca3a27c87f064f3ea63303dc266226b89`. GPT-6 inherited available model was used;
requested Sonnet/Opus models were unavailable. No sub-agents, code/configuration
changes, commits, pushes or physical-device runs were performed by this task.

## Checklist results

1. **Product naming — corrected.** Current guide prose uses TiPlay and the live
   **Android hotspot** label. Historical DiPlay versions, package identities,
   raw log tags and upstream references remain unchanged. `ANDROID9_WIFI_DIRECT.md`
   no longer calls the current option Phone hotspot.
2. **Repository destinations — passed within scope.** Existing numbered issue/PR
   links remain on `shihabal3amri/DiPlay`; no new project/site destinations were
   introduced. No conflicting current project destination was found in these targets.
3. **Phone + browser scope — corrected.** Strengthened retained-compatibility notices
   in Android 9, built-in car hotspot, reliability, smooth wireless, local-hotspot,
   automatic-join and repair validation documents. Historical native BYD/head-unit
   acceptance remains evidence, not a current release requirement or second product.
   Existing Wi-Fi now explains Android phone + iPhone + car browser topology.
4. **Internal identity/upstream/legal preservation — passed.** Package names,
   classes, preference keys, platform APIs, protocol IDs, literal evidence and
   upstream credits were preserved. Edits were limited to prose and task records.
5. **Settings names/presentation/consent — corrected, one source-policy flag.**
   `BrowserMainSettingsMenu.kt`, `BrowserConnectionDraft.kt`,
   `BrowserExistingWifiSettings.kt`, `BrowserSettingsMenu.kt`,
   `HotspotExtraAddressCard.kt`, `BrowserEndpointSettings.kt`,
   `HotspotAddressMethod.kt` and English resource XML confirm native controls,
   Open/WPA2/WPA3 transition/WPA3 choices, hidden Open password, draft persistence
   and explicit Connect phone/Save and reconnect. Hotspot address guidance now uses
   main-page Network configuration → Android hotspot → Hotspot address repair,
   **None** rather than Unprivileged, editable `address:port`, ranges by method,
   ports 1024–65535 and immediate method/listener updates. Permission prompts still
   require taps. Source-policy flag: current VPN chooser says **VPN**, while its
   enum/KDoc calls it experimental and AGENTS.md requires experimental title
   suffixes. The guide mirrors the actual chooser and preserves the experimental
   section/limitations; no source change was made. English labels verified;
   this task did not audit every translation file.
6. **Connection/media/permissions/endpoints/boot — reviewed and corrected.**
   `ExistingWifiManager.kt` and `ExistingWifiSecurity.kt` now implement WPA3-only
   advertisement and observed-security validation on API 31+; transition accepts
   PSK/SAE, unknown types remain unverifiable. Updated the guide’s obsolete WPA3-only
   exclusion. Existing dual-family discovery/listener and network-loss contracts
   remain documented. `TeslaBrowserLink.onPortChanged()` restarts the browser
   listener without reconnecting CarPlay; changing methods does not migrate the
   shared CGNAT address to link-local automatically. Added diagnostics for retained
   browser-display replacement, viewport coalescing, replacement first-frame proof
   and socket/stream/channel cleanup. Evidence: `CarPlayController.kt`,
   `BrowserDisplayReconnect.kt`, `RetainedBluetoothBootstrap.kt`,
   `BrowserDisplayReconnectHost.kt`; inspected source tests
   `ExistingWifiManagerTest`, `BrowserMainPageTest`, `BrowserEndpointSettingsTest`,
   `BrowserDisplayReconnectStateTest`, `RetainedBluetoothBootstrapTest`.
   Wi-Fi Direct ownership/cleanup verified against `WifiP2pGroupManager.kt`,
   `WifiP2pLegacyChannels.kt`, `P2pOwnership.kt`; address lifecycle against
   `HotspotExtraAddressKeeper.kt`, `HotspotAddressVpn.kt` and its service.
   API 28 minimum is explicit in `mobile/build.gradle.kts`. Retained head-unit boot
   instructions remain explicitly outside current product guidance. Repair controls
   are declared/closed but not instantiated in `DiPlayActivity.kt`; current
   main-page code attaches no repair UI.
7. **Historical evidence — qualified, preserved.** Kept 2026-09-27 local-hotspot
   measurements, 2026-10-05 repair suite counts and 2026-10-06 reliability suite
   counts/commands verbatim. Replaced misleading “current build” wording in local
   hotspot observations with the tested build. Dated this documentation review
   and explicitly stated that it adds no device run. Android 9, Tang smooth-video,
   OnePlus joining experiment and BYD Existing Wi-Fi reports lack exact run dates;
   do not infer a date or convert them into HEAD acceptance.
8. **Links/duplicates/English–Chinese consistency — passed within scope.** Local
   file/heading references in all ten targets resolved in a Python Markdown-link
   scan. Current setup links point to TESLA_BROWSER rather than obsolete native
   setup. English current labels match source; these assigned documents have no
   separate Chinese counterpart. New instructions agree with the current browser
   flow and distinguish immediate endpoint updates from saved connection drafts.
9. **Owned scope/no raw rewriting — passed.** Only the ten assigned documents,
   this RESULT file and the connection section of TASKS.md were edited. No raw
   measurement table, log, legal notice or generated source was rewritten.

## Changes by document

| Document | Change |
| --- | --- |
| ANDROID9_WIFI_DIRECT | Correct Android hotspot label; retained-only scope; qualify undated author run and absence of new hardware checks. |
| CONNECTION_SETUP | Android phone/current flow notice; historical test guidance separated from current acceptance. |
| EXISTING_WIFI | Current topology, exact security choices, explicit save/reconnect, API/security validation and historical BYD scope. |
| HOTSPOT_ADDRESS | Current location/None label, per-method address editor and port behavior, shared-address migration caveat, browser reachability qualification. |
| CONNECTION_RELIABILITY | Date/scope notice and historical compatibility acceptance heading; later resize record linked. |
| SMOOTH_WIRELESS | Retained native-media scope and undated historical measurement qualification. |
| WIRELESS_DIAGNOSTICS | Retained display-session/viewport and Bluetooth resource-owner milestones; distinguish bootstrap messages from rendered recovery. |
| WIRELESS_HOTSPOT_JOIN | Retained repair/experiment scope, missing exact date and no new device run. |
| HOTSPOT_JOIN_VALIDATION | Historical repair UI/acceptance scope and earlier BYD-policy qualification. |
| LOCAL_HOTSPOT_TEST | Current browser guide destination, transport migration terminology and tested-build wording. |

## Checks and remaining limits

Scoped `git diff --check` passed. Local link targets and the one referenced heading
resolved. Repository Android CI, browser Node tests and final public-tree checks
are owned by the coordinator; this task inspected tests but did not run or claim
new suite results.

Physical browser access to CGNAT/link-local addresses, OEM hidden API behavior,
Shizuku Android 16/17 platform evidence, the automatic-join experiment, contributor
Tang/BYD measurements and release/device acceptance cannot be re-established by
reading this source tree. Keep their existing platform caveats. WPA3-only,
transition and Open hardware success is not established by synthetic tests.
Repair API/journal behavior was source-reviewed through its documented boundary;
no Apply/Restore, ADB authorization or hotspot restart was attempted. Current
vehicle resize, prolonged recovery, radio interference and long-session acceptance
remain unverified by this documentation task.
