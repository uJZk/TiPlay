# Notices documentation review

Reviewed on 2026-10-11 against [CHECKLIST.md](CHECKLIST.md). Scope: all 12 `notices` paths in `groups.json`. No assigned source document, license, attribution, upstream copy, application or configuration file was changed. Required full Android and browser checks belong to the coordinator.

## Verified references and counterpart consistency

- `docs/THIRD_PARTY_NOTICES.md` keeps TiPlay as the current name and retains DiPlay/xcertplay/DiAuto attribution. The current repository URL matches the explicit AGENTS.md policy; upstream credit URLs remain upstream URLs.
- Root `LICENSE`, both upstream README copies, the DiAuto AGPL text, four dependency-license texts, `docs/HOTSPOT_ADDRESS.md`, and the BYDMate asset license are present. Repository-root paths quoted in the credits resolve to existing files.
- Bouncy Castle 1.79, JmDNS 3.6.3 and Shizuku API/provider 13.1.5 match `gradle/libs.versions.toml` and `shared/build.gradle`. `DiPlayActivity.kt` retains `SPDX-License-Identifier: AGPL-3.0-only`, consistent with the UI notice. This is attribution consistency checking, not a legal compatibility assessment.
- `shared/BYD_HUD_ICONS_NOTICE.md` and the packaged asset `NOTICE.txt` are byte-identical; their Required Notice and PolyForm Noncommercial terms match the adjacent asset license. No donor/provenance uncertainty was removed.
- The SpeexDSP README's local source files, replacement config header, adjacent `COPYING`, and `../Android.mk` exist. Android.mk uses `FLOATING_POINT` and `USE_KISS_FFT` and lists the described sources. Vendored-source equality to upstream SpeexDSP 1.2.1 was not independently established.

## Preserved limitations

1. Both upstream README copies retain inherited `README.md`, `README.zh-CN.md` and `LICENSE` relative links. Under their present `docs/` location all six links resolve to missing paths. The local counterpart files are `docs/UPSTREAM-README.md`, `docs/UPSTREAM-README.zh-CN.md` and root `LICENSE`. Preserve-original rules prevent rewriting these archived copies; the defect is recorded here.
2. The copied `shared/BYD_HUD_ICONS_NOTICE.md` says `See LICENSE-BYDMate.txt`, which exists beside the packaged notice under `shared/src/main/assets/byd-hud-icons/`, rather than beside the copied Markdown notice. The exact original notice is preserved.
3. Upstream README usage, build/module names and authentication claims describe the upstream receiver. They are not current TiPlay instructions; in particular their `automotive` target differs from this fork's current targets. Preserve-original rules prevent updating their technical claims.
4. Apple asset provenance, public-firmware experimental certificate/key provenance, unresolved credential acceptance/distribution, BYDMate donor provenance, and upstream license/source identity cannot be independently established from a local reference check. Existing qualifications remain intact; no private key or credentials were opened. External URLs were inspected as references, not fetched or certified reachable.

## Preservation evidence

SHA-256 values of all assigned files at review time:

```text
289af9a16165aa315e9ab00e25c0fb752734c8ad10540519a9f5c8641ddd674b  docs/THIRD_PARTY_NOTICES.md
3ba5a61151105ecdaafee9fd9d73e62bc92dd45c84ea7542f35fb27c810ff692  docs/UPSTREAM-README.md
f253ce7c66390b1cb082f09f0a6ed04f342c10e510214dc8180499b1bcc26578  docs/UPSTREAM-README.zh-CN.md
76a97c878c9c7a8321bb395c2b44d3fe2f8d81314d219b20138ed0e2dddd5182  docs/licenses/DiAuto-AGPL-3.0.txt
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  docs/licenses/dependencies/Apache-2.0.txt
782703fcd39c06fcfba0e23d1cdc65c3f219d58b5a5ffa632a5b37008cfec956  docs/licenses/dependencies/Bouncy-Castle-LICENSE.txt
cac34505131988f93ff1b21aae610f01500f478dc2bfe7f055c442ff301fd61e  docs/licenses/dependencies/SLF4J-LICENSE.txt
64870037f294b6f2b75c8ebe77cc0702acb3b64f86b4b0e58bf8558525303686  docs/licenses/dependencies/Shizuku-API-LICENSE.txt
03c876801e8c1413e01fdc212f7e82293103890b115cfdecdd1eb0bd16bc474b  shared/BYD_HUD_ICONS_NOTICE.md
07150ad80eb424e971e26ef1ba5dab2b707009cfb487a4254d59460392362cc7  shared/src/main/assets/byd-hud-icons/LICENSE-BYDMate.txt
03c876801e8c1413e01fdc212f7e82293103890b115cfdecdd1eb0bd16bc474b  shared/src/main/assets/byd-hud-icons/NOTICE.txt
fbc9dedb463017b0baaa5b3fb5662ac137940b42398dde7efad265e992756a0e  shared/src/main/jni/speexdsp/README.md
```

Verification used local path checks, relative Markdown/HTML link extraction, byte comparison of the duplicate notices, manifest/code reference inspection, and SHA-256 reads. No network or hardware validation was performed by this task.
