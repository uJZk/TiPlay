# Entry documentation review

Completed 2026-10-12 with inherited available GPT-6. Scope: `92cc2efca3a27c87f064f3ea63303dc266226b89..5449de24d399f9e4e1ce1124e7066d906df98813`; corresponding changed source was checked read-only, including assigned unchanged documents. No code/configuration changes, commits or pushes.

User steering additionally required `README.md` to contain only user-needed content. The English and Chinese READMEs now have matching overview, status/requirements, setup, use/settings, limits/help and essential credits. Developer architecture, internal package IDs, private delivery records, release packaging and native head-unit feature catalogs were removed from these entry points; existing detailed/historical records remain intact.

## Item-by-item checklist

| Checklist item | Result and evidence |
| --- | --- |
| Current product names and historical DiPlay | Checked all eight assigned documents. Current text uses TiPlay; CHANGELOG's DiPlay release history and upstream credits remain unchanged. Current CarPlay default icon/label corrected against `CarButtonDefaults.kt` (packaged TiPlay PNG, label TiPlay, custom choices retained). |
| Canonical project/upstream destinations | Explicit AGENTS.md `uJZk/DiPlay` links retained. Historical todo Pages URL retained as dated 2026-10-09 evidence. Conflict remains below; no policy selected or links migrated. |
| Phone + browser scope | READMEs now explicitly support only phone + car browser. Removed native mode support invitation/catalog; INSTALL distinguishes unavailable legacy group-reset/join-repair controls. UPSTREAM_SYNC README instructions now preserve user-facing scope instead of restoring a head-unit feature section. |
| Internal names/legal/upstream contracts | No internal identifiers, source, licenses or remote configuration edited. Essential GPL-3.0/AGPL-3.0 and attribution preserved. UPSTREAM_SYNC remains one-way merge with small hooks and unchanged upstream identifiers. |
| Settings, native UI, draft/apply/reconnect | Checked `BrowserMainSettingsMenu.kt`, `BrowserAdvancedPage.kt`, `BrowserSettingsMenu.kt`, `BrowserConnectionDraft.kt`, `BrowserSettingsPolicy.kt`, `CarPlaySettingsNavigation.kt`, `DiPlayActivity.kt`, `CarPlayHostActivity.kt` and English/Chinese browser string resources. Corrected two-menu navigation, CarPlay connection mode, advanced FPS/HEVC/driving-side/report/permissions controls, hidden authentication and absence of current gesture chooser. Main draft submits only on Connect/Save and reconnect. Advanced choices save immediately; Return and apply reconnects an active host via APPLY intent, ordinary Back does not. |
| Connection/media/permissions/endpoint/boot | Checked `AirPlayPersistence.kt`, `AirPlayDisplaySettings.kt` (fresh default 60; saved choice retained), `BootReceiver.kt`, `BrowserBootConnectionSettings.kt`, `BrowserPermissionsPage.kt`, `BrowserEndpointSettings.kt`, `TeslaBrowserPageLinks.kt`, `AirPlayInfoPlist.kt`, `AirPlaySession.kt` and transport policies. Corrected boot connection request, battery settings fallback, advanced defaults, listener-port wording and method-specific address ranges. Confirmed audio stream refusal and retained Bluetooth/USB recovery qualifications. Corrected local SurfaceView description for smooth-video and browser-only renderer scope. |
| Historical evidence and limits | Dated Tesla probe reports, static Carlinkit analysis, old Pages layout, historical CI todo and DiPlay changelog entries retained. Current code completion remains separate from pending vehicle validation. No claim of complete Tesla CarPlay/audio success added. |
| Links/duplication/English-Chinese consistency | Local Markdown file targets exist for all eight assigned docs (Python scoped check). Readmes aligned. INSTALL and NEXT obsolete navigation/defaults reconciled, todo current defaults updated without rewriting raw evidence. `git diff --check` for assigned files passed. |
| Owned scope and unverifiable claims | Only seven owned guides plus this result and the entry task status were edited; AGENTS.md reviewed unchanged. Broader CI/browser/public-tree checks are coordinator-owned. Unresolved conflicts and device limits are below. |

## File results

- `AGENTS.md`: reviewed unchanged; CI command agrees with `.github/workflows/android.yml` (workflow adds `--stacktrace`), Node 22 requirement agrees, current two-menu default matches source. Its explicit destination policy remains authoritative for this sweep.
- `README.md`, `README.zh-CN.md`: restructured per user steering; current setup/help, advanced defaults/apply semantics and boot behavior aligned; removed developer/private-delivery/native feature material; retained essential notices and uncertainty.
- `CHANGELOG.md`: changed only current TiPlay unreleased section: logo and current two-menu/default/boot/endpoint/resize behavior. Historical DiPlay sections untouched.
- `docs/INSTALL.md`: corrected connection label, USB action, boot behavior, current advanced settings/report path and reconnect semantics; qualified unavailable legacy controls, battery settings fallback and unverified audio; diagnostic report request now asks for Android device/car-browser context.
- `docs/RELEASE-NOTES-NEXT.md`: corrected default TiPlay logo/label; replaced stale menu-order/hidden-boot/authentication/Display claims with current two-menu behavior and exact apply boundary; qualified retained local rendering.
- `docs/todo.md`: updated current 60 fps advanced controls, configurable listener port/method-specific ranges and current hotspot row placement and None/无 method label; preserved dated research/probe results and unresolved vehicle tasks.
- `docs/UPSTREAM_SYNC.md`: preserve new user-only README scope during merges; record saved-FPS/default and phone boot-intent contracts; release-version checklist now uses CHANGELOG/NEXT rather than requiring implementation history in root README.

## Unresolved findings

1. **Destination-policy conflict:** AGENTS.md explicitly requires project links to `https://github.com/uJZk/DiPlay`; actual origin is `https://github.com/uJZk/TiPlay.git`, and `TeslaBrowserPageLinks.DEFAULT_PAGE_ADDRESS` is `https://ujzk.github.io/TiPlay/`. `scripts/build_site.py` still defaults to `/DiPlay/` and `REPO = https://github.com/uJZk/DiPlay`. Current READMEs link the detailed browser guide for the page address and retain mandated project issue/release destinations. Coordinator/user policy resolution is needed; no canonical policy changed.
2. Historical private Tesla probe reports and Carlinkit binary-analysis offsets are not independently reproducible from this public tree. They remain dated evidence with stated limits. No physical device or live Release/Pages state was tested during this review.
3. Full Tesla CarPlay/audio operation, Shizuku/VPN vehicle reachability, and platform/OEM boot behavior remain device validation tasks. No current guide treats source/unit checks as device acceptance.

Coordinator spot-check clarified the setup sequence and distinguished the Android **Connect phone** action from the browser **Connect** button in both READMEs. Removed firmware identity implementation detail from root guides while retaining user-relevant certification and compatibility limits and the notice link.
