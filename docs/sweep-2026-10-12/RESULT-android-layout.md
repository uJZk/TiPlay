# Android layout and readiness review

Owner: Android UI reviewer 1. Review requires UI/draft judgment.

Reviewed `BrowserMainSettingsMenu.kt`, `BrowserSettingsPresentation.kt`, `TiPlayNativeUi.kt` and their page/native tests against `STANDARDS.md`, `SCOPE.md` and `AGENTS.md`.

## Authorized repairs

- The connection-mode button was attached with default layout parameters, unlike the preceding iPhone selector and following Connect button. On narrow layouts this removed the common 8 dp top spacing and full-width contract. Give it the same width, top spacing and 48 dp minimum touch height; preserve weighted wide-screen arrangement, platform widget appearance and selection behavior.
- The initial page and host idle updates advertised readiness before an iPhone was selected or network fields were valid. Derive idle text from the current draft: wireless without a selected phone asks the user to choose an iPhone; invalid wireless credentials show the existing localized validation message; otherwise Bluetooth permission/radio blockers and already-observed network blockers (known local hotspot off, existing Wi-Fi not matching) use existing localized guidance; ready text is shown only after those checks. USB does not require wireless pairing or credentials. Refresh on edits, page refresh and transport changes. An explicit host-supplied idle flag avoids overwriting connecting, active or stopping statuses. Host hook and host regression coverage are owned by Android lifecycle reviewer 2.
- Initialize action/status presentation after constructing all controls, so a restored unsaved draft immediately exposes the correct action and readiness.

No upstream identifiers, preference keys, persistence, transport validation rules or connection actions changed. Existing translated strings are reused. No adjacent production files beyond this task's owned menu were changed.

## Cleanup/performance review

No proven dead code or safe worthwhile performance rewrite found in presentation/native helpers. These paths construct or refresh settings, not media frames. Native widget restoration preserves control actions, password transformation, selection and insets; existing tests remain applicable. Avoided speculative allocation changes and styling rewrites.

## Verification

- `git diff --check`: passed.
- Added measured-layout regression for equal gaps, full-width bounds and minimum touch height of the first three connection buttons.
- Added state regressions for missing phone, invalid network credentials, Bluetooth off, known hotspot off, unmatched existing Wi-Fi, draft edits during connecting/connected/stopping, returning to idle and USB exemption.
- Existing short-window/large-font, wide-window, input preservation and inset tests retained.
- Coordinator runs the serialized Android CI command, including `BrowserMainPageTest`, `BrowserMainHostTest`, `TiPlayNativeUiTest` and lint. No concurrent Gradle invocation was started by this reviewer. Final execution results belong in the coordinator's verification record.

Remaining limit: no physical-device visual inspection performed by this reviewer.
