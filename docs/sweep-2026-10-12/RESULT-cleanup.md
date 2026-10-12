# Incremental code/build/tooling review

Reviewed the TiPlay changes between `0f90c0c00f01f9d201a4b49acfd7949a39b7a20b`
and `477801f5e2fde2b48d064bcd06dc2df71f312514`, following `STANDARDS.md` and
`AGENTS.md`. No production or test changes were justified by this review.
Preserved upstream code, identifiers, compatibility entry points and product behavior.

## Reviewed files

Under `common/src/main/java/com/shilapi/xcertplay/`:

- `BrowserConnectionDraft.kt`
- `BrowserDisplayReconnectHost.kt`
- `BrowserAdvancedSettings.kt`
- `BrowserEndpointSettings.kt`
- `BrowserBatteryOptimizationSettings.kt`
- `PhoneBrowserReceiverUi.kt`
- Incremental hunks in `AirPlayPersistence.kt`, `BootReceiver.kt`,
  `BrowserSettingsPolicy.kt`, `CarButtonDefaults.kt`, `CarPlaySettingsNavigation.kt`,
  `CarPlaySettingsPermissions.kt`, `DiPlayActivity.kt` and `TeslaBrowserPageLinks.kt`.

Under `shared/src/main/java/com/shilapi/xcertplay/`:

- `media/BrowserOnlyMediaSink.kt` and incremental `media/VideoTeeMediaSink.kt` hooks.
- `orchestration/BrowserDisplayReconnect.kt` and `orchestration/RetainedBluetoothBootstrap.kt`.
- `network/BonjourMdnsCleanup.kt` and incremental `network/CarPlayBonjour.kt` hook.
- Incremental `network/CarPlayVpnService.kt` reconnect hooks, read-only; VPN repair
  ownership remains with the Android lifecycle task.

Build/tooling: `.gitattributes`, `.github/workflows/pages.yml`,
`common/build.gradle.kts`, `gradle/tiplay-product-tests.gradle.kts`,
`mobile/src/main/AndroidManifest.xml`, `scripts/generate_app_icons.py` and
`scripts/measure_browser_resize.mjs`. Generated icons and generated locale HTML
were excluded. Reviewed changes in related endpoint, battery, receiver UI,
settings policy, car-button, connection-mode, existing-Wi-Fi, phone-browser,
startup-diagnostic and page-link tests; reviewed the existing media, mDNS,
reconnect-state, VPN reconnect and retained-bootstrap assertions.

## Findings

- Browser video forwarding preserves frame-array identity and timestamps. The
  tee helper is inline, retains primary-before-tap ordering, and isolates tap
  exceptions. No added per-frame copies, parsing, blocking I/O or unbounded
  frame collections occur in these wrappers. No performance gain is claimed.
- Retained Bluetooth ownership rejects resources arriving after shutdown and
  closes the finite socket/stream/channel collection in reverse order outside
  the ownership monitor. Existing tests cover failure and concurrent shutdown.
- Display reconnect bookkeeping preserves session identity, acceptance order
  and tunnel-failure suppression. Clearing retired tunnels earlier would change
  lifecycle behavior; no speculative cleanup was applied.
- mDNS cleanup starts independent closes together and joins every worker,
  restoring caller interruption. Its wait has no deadline by design. Introducing
  a deadline or asynchronous return requires a resource-release policy decision
  and falls outside behavior-preserving cleanup.
- Connection draft restoration, legacy page-address migration and test filters
  are compatibility paths, not proven dead code. Preference keys, exception
  fallbacks, reconnect consent and upstream native sources remain intact.
- Icon generation is offline tooling; the runtime car-button path already reads
  packaged PNG bytes without reencoding. No speculative settings/init caching
  or formatting churn was applied.

## Checks

- `node --check scripts/measure_browser_resize.mjs`: passed.
- Python AST parsing of `scripts/generate_app_icons.py`: passed without creating
  generated assets or bytecode files.
- `python3 scripts/check_public_tree.py`: passed.
- `git diff --check`: passed at review time.
- Android unit tests/lint/build are owned by the coordinator; no concurrent
  Gradle invocation was started. Related tests were inspected, not reported as
  executed here. Device resize measurement was not run: it requires an attached
  Android browser and an active iPhone session.
