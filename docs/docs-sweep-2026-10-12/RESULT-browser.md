# Browser documentation sweep result

Reviewed on 2026-10-12 against HEAD `5449de24d399f9e4e1ce1124e7066d906df98813`, with incremental baseline `92cc2efca3a27c87f064f3ea63303dc266226b89`. Model: inherited GPT-6; the requested Sonnet/Opus models were unavailable. Scope: `TESLA_BROWSER.md`, `PRIVACY.md`, `BUFFERED_AUDIO.md`, `VIEW_AREAS.md`, `SIDE_PANEL.md` only, plus this result and the browser task status. No source/configuration changes, commits or pushes.

## Checklist results

| Checklist item | Result | Evidence and action |
| --- | --- | --- |
| Current TiPlay naming; preserve historical/upstream DiPlay | Pass | Current prose uses TiPlay. Preserved upstream numbered PR #295 and internal package/file identifiers. No historical device results or legal notices were renamed. |
| Explicit `uJZk/DiPlay` destination; flag conflicting TiPlay destinations | Open finding | The owned guides add no new repository/site destination. `AGENTS.md` requires `uJZk/DiPlay`, but `TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS` is `https://ujzk.github.io/TiPlay/` and `pages.yml` describes TiPlay as the current deployment while its unset-variable fallback is DiPlay. Preserved source references and did not select a new canonical policy. |
| Phone + car browser scope; native material only compatibility | Fixed | Privacy now identifies the Android phone as the storage device. The three native implementation guides explicitly identify retained upstream compatibility and historical contributor results as outside current support/acceptance. Side-panel future ideas are historical research, outside the product roadmap. Buffered-audio hardware rechecking is qualified as an upstream compatibility claim, not a phone/browser acceptance task. |
| Preserve internal identifiers, legal notices and one-way upstream sync | Pass | No code, configuration, packages, resources, preferences or intent actions changed; retained `com.ujzk.tiplay` and `.hudtest`, internal Kotlin filenames and upstream PR link. No upstream submission or altered licensing/sync workflow. |
| Settings names, reachable controls, presentation, translations and consent | Pass within scope | Read `BrowserMainSettingsMenu`, `BrowserAdvancedPage`, `BrowserSettingsPolicy`, `DiPlayActivity.showsSection` and native settings blocks. Main/Advanced controls and explicit Return and apply remain current; legacy advanced-section sets do not override the policy filters. Buffered audio is hidden and disabled in phone configuration; native split/rotation/side-panel controls remain hidden, with their legacy consent descriptions preserved. No labels or locale requirements changed. |
| Connection, browser media/debug/resize, permissions, endpoints and boot claims | Fixed/verified within scope | Added WebCodecs/codec capability qualifications, removal of HTML video/MSE and phone decoder/surface paths, exact Debug fields and the five-second window, and `link.js` resolution plus one session per Connect. Verified retained-wireless replacement, pending viewport behavior and unavailable timing semantics. Privacy explains local network permission, address-repair VPN conflict, endpoint query disclosure to the static host, and no encryption on an open network. No boot behavior changes or new device support claims. |
| Date historical results; identify superseded behavior without rewriting evidence | Pass | Existing native hardware result sections explicitly state the contributor test date was not recorded; kept these unknown dates and original Tang/iOS observations. Added compatibility/product boundaries without inventing dates. Added a dated Debug validation reference. |
| Local links/headings; duplicated instructions; English/Chinese consistency | Pass within scope | All local file and heading links in all five owned files resolve. Shared browser lifecycle remains the reference for browser resizing rather than native view-area instructions. No Chinese counterparts or translated UI labels were edited in this task. |
| Task ownership; preserve meaning/generated/legal/raw originals; no code or publishing | Pass | Edits restricted to the five owned guides and browser sweep records. No raw evidence, generated/legal/upstream originals, code/configuration, commits or pushes changed. Unverifiable hardware/host policy facts remain qualified below. |

## Source evidence

- `site/play/link.js`: `linkFromAddress`, `linkLocation`, `choosePath`; `site/play/app.js`: link loading/import, `start` guard, portal resume, cancellation and animation-frame viewport reporting. Link input resolves one host/code pair, `?t=` precedes legacy `#h=`, and code-only input uses the default or serving phone.
- `site/play/index.html`: five-field Debug aria label, canvas UI and `media-src 'none'`. `site/play/fps-window.js`: five-second rolling interval/latency window and `formatDebugFps`. `site/play/video.js` and `clock-sync.js`: canvas submission endpoint and rejection/expiry of uncertain timing. No HTML video/MSE playback path in `choosePath`.
- `TeslaBrowserLink.tee`, `BrowserOnlyMediaSink`, `PhoneBrowserReceiverUi.configure` and `phoneBrowserAirPlayConfig`: compressed video bypasses the Android sink, no local surface listener, no audio/microphone callbacks, `microphone=false`, `mainBufferedAudio=false`, `audioViaCarBluetooth=true`, no native view areas. `PhoneBrowserReceiverUiTest` explicitly checks the absent listener and invisible local surface.
- `BrowserDisplayReconnectHost`, `BrowserDisplayReconnect`, `TeslaBrowserLink.viewportChanged/updateCanvas` and phone host resize hooks: main-thread viewport delivery, replacement ownership, latest offered canvas, later viewport retry after the replacement's first frame, and no phone-rotation-driven reconnect. Existing browser lifecycle guidance retained.
- `CarPlayHostActivity` gates microphone permission resolution and head-unit integrations on phone/browser mode. `BrowserSettingsPolicy` forces the browser/audio profile and hides native sections; `DiPlayActivity.showsSection` combines policy and section filters. `BrowserAdvancedPage` owns the current native Android advanced UI and explicit return/apply tracking.
- `DiagnosticExportStore`: MediaStore Downloads first where available, package-specific external then private fallback, bounded newest-eight fallback retention, distinct read-grant URIs. Backup and data-extraction XML exclude app-private storage. Preserved redaction caveat and user-controlled export.
- `BrowserLinkServer`, `BrowserPairingGate`, `TeslaBrowserPageLinks`, `PhoneBrowserLocks`: pairing boundary, copied-link versus legacy input semantics, default-address migration, screen-off locks and platform-dependent Wi-Fi modes. HTTPS enables browser decoding but the local HTTP transport remains unencrypted.

## Fixes

1. Tesla browser guide now states codec/capability requirements without guessing car/browser version support, describes browser-only media routing, imported pairing resolution and one session, and enumerates all five Debug fields with rolling timing limits.
2. Privacy guide uses the phone as the current data owner, describes native microphone/Usage Access as compatibility, covers both local VPN uses, notes endpoint disclosure through the query string and open Wi-Fi's lack of encryption, and records that New code ends the current browser session.
3. Buffered audio, view areas and side panel keep their protocol details and raw historical contributor observations while explicitly excluding native support and acceptance commitments from the current product.

## Verification

- Scoped local file/Markdown heading link check: passed for all five guides.
- `git diff --check --` the five owned guides: passed.
- Source and existing test evidence inspected read-only. Coordinator owns Node browser tests, Android CI checks and public-tree verification; no duplicate builds were started by this task.

## Open findings and limits

- **Canonical-link policy conflict:** source and deployment comments identify the TiPlay Pages path while AGENTS requires the DiPlay repository/site destination. Pages repository variable and live hosting were not queried. The coordinator should report this conflict; no documentation sweep can infer the owner's intended permanent destination from redirects or comments.
- The native contributor hardware dates remain unknown. Those historical observations are not current support guarantees, and no physical car/device tests were performed.
- WebCodecs capability/codec support, vehicle routing, platform Wi-Fi lock behavior and retained-wireless renegotiation recovery remain platform-dependent. Canvas submission timing does not establish physical display presentation. Existing pending-resize/retry caveats were preserved.
