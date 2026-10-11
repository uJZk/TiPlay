# Vehicle documentation review — 2026-10-11

Status: completed for the eight files in the vehicle group. Documentation changes only; no application/configuration changes, commits or pushes. Android and browser test execution belongs to the coordinator.

## Corrections

- `BUFFERED_AUDIO.md`, `BYD_NAVIGATION.md`, `DILINK4_CLUSTER.md`, `LAUNCHER_INTEGRATION.md`, `SIDE_PANEL.md`, `VIEW_AREAS.md` and `COMPATIBILITY.md` now distinguish retained head-unit implementation and contributor results from the current phone + browser product profile. `BrowserSettingsPolicy.activate()` forces phone + browser mode, Bluetooth audio, system day/night mode, location reporting off and split-screen adaptation on. Hidden display/audio/navigation/vehicle sections are not presented as currently reachable product controls.
- Corrected retained settings ownership: dock under Display; experimental display and buffered audio under Advanced; cluster maps and their automatic setup under Advanced; wheel zoom/joystick under Vehicle; BYD guidance/calls under Navigation; vehicle data under Advanced → Vehicle; ordinary location reporting under Navigation → Location.
- `VIEW_AREAS.md` separates live view-area transitions from changing negotiation options: split-screen/rotation choices and transitions to/from Automatic dock need the next connection and expose the consent-controlled Reconnect now bar. `SIDE_PANEL.md` records the same next-connection behavior for enabling the panel and describes the driver's side for either driving side.
- `BYD_NAVIGATION.md` no longer claims the cluster-map control requires a visible physical display: the retained control supports the virtual stream. Its hang-up/menu-key instructions now retain the explicit call-key opt-in while distinguishing it from the wheel key service.
- `LAUNCHER_INTEGRATION.md` describes the negotiated embedded-map aspect, 8:3 physical or 16:9 virtual, instead of claiming every map is 8:3. Updated the dashboard control label consistently.
- Converted bare upstream references in buffered audio and DiLink 4 guidance to the recorded upstream PR URLs (#295 and #187), preserving attribution and internal DiPlay actions/package/log identifiers.
- `UPSTREAM_SYNC.md` section 9 now requires preserving the forced browser product profile and hidden sections and replaces the obsolete user-facing mode-switch check. Its one-way merge, small-hook, naming, package, resource and no-upstream-contribution rules remain intact.
- Buffered-audio, view-area and side-panel contributor tests explicitly remain historical results whose test dates are not recorded in those guides.

## Read-only verification

| Claim reviewed | Repository evidence |
| --- | --- |
| Current profile and settings visibility | `BrowserSettingsPolicy.kt`; activation in `DiPlayActivity.onCreate()` and `CarPlayHostActivity.onCreate()`; `CarPlaySettingsNavigation.additionalSections()`; `DiPlayActivity.showsSection()` |
| Retained category ownership and connection consent | `SettingsInformationArchitecture.sectionsByCategory`; `advancedSettings()` / `advancedVehicleDataSettings()` / `wheelKeysSettings()`; experimental toggle callbacks; `carPlayDockControl()` / `reconnectingToggle()`; English string resources |
| BYD firmware/default/lifecycle scope | `BydOutputSettings.kt`, `BydStandaloneHudOutput.kt`, `BydNavigationOutputs.kt`, retained cluster/map controls and DiLink 3 recovery implementation; existing regression test sources |
| DiLink 4 selection, private launch and recovery scope | `AdbClusterRouter.kt`, `DiLink4ClusterDisplay.kt`, cluster Activity/output state and OEM hold implementation; exact XDJA-owned 1920×720 launch target and separate recognized 1280×480 public surface |
| Launcher protocol/widget/aspect | `MapEmbedService.kt`, `MapMirrors.kt`, `CenterMapOverlay.kt`, `NavigationWidget.kt` and sample launcher/map-host files |
| View-area/side-panel claims | `CarPlayViewAreas.kt`, `SidePanel.kt`, retained display controls and relevant lifecycle/layout test sources |
| Buffered music bounds/timing | `BufferedAudioStream.kt`, buffered session/stream regression sources; existing documented contributor attribution retained |
| Upstream workflow references | Existing source/config/test paths, internal package/action/preference identifiers, `TeslaBrowserPageLinks.kt`, `.github/workflows/pages.yml`, `scripts/build_site.py` |

Checked all 11 relative-file/heading links across the eight assigned documents: no missing files or headings. Scoped `git diff --check` passed. No new tests were written for prose changes; no hardware or external-network validation was performed.

## Flags and limits

- The checklist/AGENTS naming policy requires current project links on `uJZk/DiPlay`. `TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS` and the site generator default still use the DiPlay Pages address, while `.github/workflows/pages.yml` comments describe a current TiPlay Pages deployment configured through `SITE_BASE_URL`. The deployment variable cannot be verified from local source. Preserved the mandated repository links and implementation constant; did not choose a new URL policy or edit configuration.
- Firmware captures and contributor claims in the head-unit guides remain attributed historical evidence. Several BYD, DiLink 4, buffered-audio and display reports have no exact test date/build provenance in their respective guide. No date was invented and none was upgraded to current hardware acceptance. On-car firmware, rendering, call/microphone, restoration, tunnel dead-reckoning and music-interruption acceptance remains explicitly unverified where already identified.
- Upstream merge instructions now record the current code profile. The architectural instructions to preserve head-unit compatibility remain applicable to retained source and do not imply that current TiPlay offers a user-facing head-unit mode switch.
