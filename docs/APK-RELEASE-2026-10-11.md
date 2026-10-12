# TiPlay APK release record for October 11 2026

This records the October 11 build and delivery session at commit `83ec070`; it is
not a release-status check for the current checkout. The APK hashes and test
counts below apply only to that build. A later signed installation is recorded in
[Settings UX](SETTINGS-UX-2026-10-11.md#主设置高级设置和浏览器端口).

The signed TiPlay 0.2.13 APK was built and verified. A GitHub Release draft exists,
but at the end of that session it had no attachments: `uploads.github.com` returned `401 Bad credentials`
while GitHub API authentication worked. The user received the APK through a private
ChatGPT Page with two ZIP volumes. The draft had not been publicly published in that session.

## Build inputs and output

- Source repository: `uJZk/TiPlay`.
- Build commit: `83ec0700243973f5426e3bd4b6dcda42c7ac2791` (main at build time).
- APK: `TiPlay-0.2.13.apk`, application ID `com.ujzk.tiplay`, version code 32,
  minimum API 28 and target API 37.
- APK SHA-256: `b33af1d243cd23174fc21e9eb0d9c7cd24d31592120b60c72740e9a786a12cc5`.
- Matching source ZIP SHA-256:
  `824db9820ae75d84061ee144396c8cb254921e051d2a0a9a14168ba6143c6e04`.
- Android signing input: the user-supplied `release.p12`, kept outside Git.
- Signing certificate SHA-256:
  `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`.
- Runtime identity: extracted unchanged from upstream `DiPlay-0.2.17.apk`.
  Upstream APK SHA-256:
  `6f6a4e797fb32a01a1e30fb6fcf3bc55c15ddcd7ddcaa436f91e9897657b0db0`.
- `identity.pk8` SHA-256:
  `bd50eda2d8dd95a8464440f1aebca7068dcab46a2461ecaf826c7f98f5621a75`.
- `certificate.p7b` SHA-256:
  `634a93dd6c4338080524025411752597ecb828591839cd062a8292fd7e9e844e`.

Runtime input selection did not merge upstream 0.2.17 source into TiPlay.
The [experimental identity notice](THIRD_PARTY_NOTICES.md#experimental-authentication-data)
still applies. APK recipients can extract the runtime identity; the APK and source
ZIP exclude the separate Android signing key.

## Verification

- Temurin JDK 25, Platform 37.0, Build-Tools 36.0.0, NDK 28.2.13676358.
- Full Android workflow command passed: shared 1,205 tests, common 997 tests,
  Home 4 tests; mobile/Home/maphost debug lint and debug APK builds.
- Browser tests passed under Node 22: 60 tests.
- Release tests were up to date; release lint and signed APK build passed.
- `apksigner verify` passed with APK Signature Scheme v2; certificate fingerprint
  matched the selected signing keystore.
- Manifest package, version and SDK values matched the build configuration.
- Both APK runtime files matched extracted upstream inputs byte for byte.
- Public tree and source ZIP credential scans passed; the only credential
  containers in the APK were the two intended runtime identity files.
- ZIP-volume reconstruction was checked against the complete original APK.

Environment fixes: Android/Java/Gradle caches used writable directories outside
Git. Oracle JDK 25 failed in Robolectric crypto initialization; Temurin 25 passed.
These fixes did not change application source.

Vehicle CarPlay acceptance and complete Bluetooth audio flow remain unverified.

## Delivery and next steps

The TiPlay repository URL below records the actual draft destination from that
session. It conflicts with the `uJZk/DiPlay` destination required by `AGENTS.md`;
this record does not resolve that policy conflict. Local paths and the private
Page describe session assets, whose continued availability has not been checked
in this documentation sweep.

The existing Release draft uses tag `v0.2.13`, target commit `83ec070`, and release
ID `409363608`. Find it in the repository's [Releases](https://github.com/uJZk/TiPlay/releases)
when signed in. Its description records the pending upload. Draft URLs can change
when edited; use the release ID or tag when resuming.

Session-local assets are in `/workspace/work/release-assets/`: the APK,
`TiPlay-0.2.13-source.zip` and `SHA256SUMS.txt`. They are external build outputs,
not repository files, and require preservation before replacing the cloud instance.
The private download Page ID is `page_0b854418d5048191b28dcf4848776406`;
its two uploaded ZIP volumes require removal of the generated filename suffixes
before extracting with 7-Zip. The Page contains the exact instructions and APK hash.
No signing key was uploaded to the Page.

Next steps:

1. Configure working GitHub authentication for `uploads.github.com` through the
   managed environment configuration workflow; network allowlisting alone is
   insufficient. The exposed GitHub connector does not provide binary Release upload.
2. Inspect the existing draft, upload only missing assets, and confirm all three
   names, hashes and the draft state. Keep the recorded build target and source ZIP
   together; subsequent documentation commits do not change this APK's provenance.
3. Test the APK in the intended vehicle before claiming end-to-end CarPlay/audio
   validation. Public Release publication remains a separate action.

## Documentation wrap-up

`docs/BUILD.md` now documents upstream extraction, PKCS12 signing checks, APK
signature/identity verification, draft creation, failed-upload recovery and
read-only-home/proxy settings. `AGENTS.md` points to this release record.
Duplicate download/compression intermediates and session build daemons were cleaned
up. Verified outputs, runtime inputs, user-supplied signing file and reports were
retained for the outstanding upload. No APK rebuild or website deployment is needed
for these documentation-only changes. These documentation changes do not alter the Release draft's build target.
