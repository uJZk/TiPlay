# Browser appearance repair

## Findings and changes

- Browser theme reports already used the authenticated `st` message with a Boolean `themeDark`, but a theme-only report can be replaced by ordinary stats in the latest-message outbox. The web_debug owner handles complete periodic stats and connection replay; no protocol or preference key changes are required.
- `TeslaBrowserLink` previously cached appearance on server callback threads but delivered it on the main thread. Cache updates and delivery now share the main-thread ordering, and remain independent of the 10-second diagnostic-log throttle. Invalid/missing theme values remain ignored.
- A retained controller previously received no appearance updates after its activity detached. A small `CarPlayController.sendNightMode` hook schedules the command on its existing input/command executor and verifies that the controller is open and the captured session is still current. The fallback applies only to a retained phone-browser session. A newly attached host receives the cached appearance as before.
- The host owner added the requested phone-browser/shutdown gate to the existing theme callback. The ordinary host path still uses its existing night-mode controller, diagnostics and AirPlay command executor.
- `BrowserAppearance`, `CarPlayNightModeController` and `AirPlaySession` need no behavioral changes: the night controller already applies SYSTEM changes while the phone activity is paused, and AirPlay already retains an unsent night command until its event channel is ready.

## Compatibility and performance

This is the explicitly authorized real-time theme repair, including adjacent controller/tests, rather than behavior-preserving sweep cleanup. Existing class names, upstream identifiers, event-channel locking, session ownership and reconnect behavior remain intact. No extra executor, network protocol or dependency was added. Appearance updates run at browser-stats cadence, outside media frame processing; no measured performance claim is made. The controller fallback uses the existing serialized command queue and rejects ended/replaced sessions when its queued work runs.

## Verification

- Added `TeslaBrowserLinkTest` coverage for main-thread delivery of rapid light/dark changes despite stats throttling, malformed reports, detached retained-phone delivery, attachment replay and the retained non-browser-session gate.
- Added `CarPlayNightModeControllerTest` coverage for changes and duplicate reports while the activity is paused.
- Added `CarPlayControllerHeadUnitIntegrationsTest` coverage for active/absent/ended/closed controller delivery and preservation of the existing event-channel pending command.
- `git diff --check` passes. Android tests/lint/build are delegated to the coordinator's single Gradle run to avoid concurrent Gradle processes; see the sweep verification record for final results.
- Real iPhone/vehicle visual theme switching still requires device validation; a successful command write alone is not proof that iOS rendered the new appearance.
