# Recovered entry documentation sweep — 2026-10-13

The environment restart lost the earlier unpushed documentation work. Restored the entry changes from this task's conversation evidence against the recovered source at 1db90a7c, incorporating the user's later decisions. Owned targets: README.md, README.zh-CN.md, AGENTS.md, CHANGELOG.md, docs/INSTALL.md and docs/RELEASE-NOTES-NEXT.md. Parent owns code, verification, TASKS and delivery. No code/configuration edits, tests, commits or pushes by this worker.

## Checklist review and recovery evidence

| Checklist item | Evidence and restored outcome |
| --- | --- |
| Current product and historical identity | Current guides use TiPlay; historical DiPlay release entries, upstream numbered references, credits and internal names remain untouched. Application identity/minimum SDK remain com.ujzk.tiplay / Android 9. |
| User entry content and bilingual alignment | READMEs retain purpose, requirements, installation, connection/use, limitations, help and credits. Restored All / Wireless / USB, immediate settings application, Android car telephone/microphone prerequisites and AirPlay companion-audio guidance in English and Chinese. Removed stale no-release claim; no build/delivery implementation section added to entry pages. |
| Official destinations | Changed current owned guide/AGENTS issue, release and download destinations to https://github.com/uJZk/TiPlay and linked https://ujzk.github.io/TiPlay/play/. User-confirmed policy replaces the earlier destination conflict; historical upstream and dated release URLs remain. |
| Concise browser labels | AGENTS explicitly states that HEVC, AirPlay and VPN titles intentionally omit experimental suffixes, preserving retained upstream labels. No obsolete suffix conflict remains. Current BrowserAdvancedPage and localized strings support concise labels. |
| Immediate settings and enabled recovery | BrowserMainSettingsMenu, BrowserSettingsChanges, BrowserAdvancedPage and CarPlayHostActivity.applyBrowserSettings support valid immediate edits and automatic reconnect while keeping the page open. Restored current labels and removed Save and reconnect / Return and apply / nonexistent Advanced settings → Video guidance from current instructions. AGENTS now allows valid enabled idle edits to resume preparation and requires disabled CarPlay to block startup/retry. |
| Product scope | Phone + car browser only; native/BYD paths remain documented as hidden upstream compatibility. No second native product or acceptance requirements added. |
| Boot, permissions, buffering and voice | BrowserBootConnectionSettings, BrowserPermissionsPage, BrowserCarPlayAudioSettings, BrowserAudioMediaSink and AndroidBluetoothVoiceChannel support Start on boot, optional audio opt-out, browser music and demand-switched car telephone capture/playback. BluetoothVoiceMixer applies 0.25 navigation gain. Docs preserve device/background restrictions and no browser/handset microphone fallback. |
| AirPlay media and limits | Restored compatible AAC-ELD mirror companion audio and browser URL-video soundtracks, authenticated proxy/direct resource playback, and HEVC mirror source support when enabled (ReceiverCapabilities exposes enabled HEVC). Standalone audio-only, unsupported mirror formats and DRM remain excluded. Physical-device acceptance is not claimed. |
| Endpoint user contract | All current owned instructions now require immediate phone address/port application without notifying/migrating browser addresses. User taps Disconnect, edits Android address and Connects, or opens the updated pairing link; pairing code remains. AGENTS labels earlier handoff history and forbids proactive notification/bookmark migration. Parent restores matching code; this worker does not treat the old delayed BrowserEndpointChanges implementation observed during recovery as final behavior. |
| Historical evidence and links | Added unreleased CHANGELOG supersession while preserving beta.1 and every historical entry. Current Debug description matches site/play/fps-window.js: codec/current FPS/two signed presentation-offset averages, not generic jitter/decoder fields. AGENTS dates older profiles/settings evidence and retains the latest remote docs/sweep-2026-10-13 Bonjour/media/concurrency handoff references intact. Added recovered docs-sweep TIE-UP handoff link. No historical hashes, counts, device measurements or dates changed. Parent owns final link/reference verification. |
| Scope and verification | Only six assigned docs plus this RESULT restored. TASKS deliberately left to parent. No runtime/device, network, publication, installation or test result claimed from this recovery. Prior test results remain dated evidence rather than new guarantees. |

## Material changes

- Restored original current-label, automatic-apply, audio-route, AirPlay and Debug corrections.
- Incorporated all later user decisions: canonical TiPlay destinations, concise labels, enabled idle recovery, manual browser endpoint editing with no notification/migration.
- Added explicit endpoint instructions to both READMEs, INSTALL and NEXT.
- Preserved updated remote Bonjour/media-retirement references and historical release evidence.

## Remaining limits

Physical iPhone/car CarPlay, HFP/SCO switching/capture, mirror AAC-ELD/HEVC compatibility and URL-video playback still need device validation. Model Y codec/hotspot probes remain historical measurements. Parent must run recovered source checks and verify links after all concurrent recovery tasks complete; no test was run by this worker.
