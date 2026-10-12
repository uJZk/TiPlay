# Android lifecycle, address and action review

Reviewed the incremental phone/browser host hooks, browser settings cards, hotspot address state helpers, local hotspot import, and associated resources/tests. Preserved upstream files, resource IDs, preference keys, method eligibility, VPN conflict checks, asynchronous probe ownership, and reconnect consent.

## Authorized repairs

- Address and browser-link rows added during a refresh already belong to an attached window. Previously their attach listeners were installed after attachment, so no probe or state subscription started. Both cards now initialize immediately when already attached, retain normal attach initialization, and cancel/unsubscribe on detach. Returning from About/Advanced can refresh the address and `t` link parameter instead of remaining at the lookup placeholder; subsequent method status changes reach the rebuilt rows.
- VPN consent now uses `startActivityForResult` with a dedicated request code, giving Android's VPN confirmation activity a result recipient/requesting package. The existing host resume synchronization starts the tunnel after authorization. Conflict checks still prevent replacing another VPN; permission denial still leaves consent available for another explicit tap.
- Hotspot import now gives immediate busy feedback, disables duplicate taps during a read, and distinguishes a complete read, name-only read, and unavailable access. Name-only reads retain the manual password; typing during a read remains protected. The import still uses existing platform/Shizuku/ADB access and does not request extra privileges automatically.
- Simplified Chinese lookup text is consistently `正在查找本机热点地址…`, including rebuilt rows. Updated corresponding lookup translations in all locales and added all import-feedback translations. Chinese read actions now name local hotspot information.
- The host now marks only genuine idle state as idle, allowing the main page to derive readiness from its draft (including missing iPhone selection). Shutdown and active-session stages retain their own status. Coordinated with the layout agent's main-page readiness changes.
- Applied the theme agent's small host callback guard: browser theme delivery updates only phone/browser sessions that are not shutting down.

## Verification

- `git diff --check`: passed at review time.
- Parsed every common strings XML file successfully.
- Added `BrowserSettingsLifecycleTest`: address/link refresh inside an already-attached page, import progress, saved-field protection, concurrent typing, partial credentials, and unavailable access.
- Added a host regression for idle readiness without a selected iPhone; strengthened VPN tests to require launch-for-result.
- Coordinator owns Gradle execution; relevant classes: `BrowserSettingsLifecycleTest`, `BrowserMainHostTest`, `HotspotExtraAddressSettingsTest`, `TeslaBrowserLinkSettingsTest`, `LocalHotspotSettingsTest`, and `SettingsTranslationsTest`. Final Android CI result is recorded by the coordinator.

## Limits

Hotspot credentials remain inaccessible on devices without the necessary existing platform/Shizuku/ADB access; the UI reports this and preserves manual entry. Physical-device VPN authorization and hotspot credential acquisition still require device validation. No performance improvement is claimed: network/credential reads remain off the UI thread through the existing bounded latest-request probe. No unrelated cleanup was justified in the reviewed helpers.
