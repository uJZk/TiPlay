# TiPlay 0.2.14-beta.1

This beta targets the Android phone + car browser flow. The Android package is
`com.ujzk.tiplay`, version code 33, minimum Android 9 (API 28), target API 37.
It includes the current browser connection/settings/recovery work and the
experimental AirPlay video receiver. See [CHANGELOG](../CHANGELOG.md) and
[AIRPLAY.md](AIRPLAY.md) for behavior and limitations.

## Inputs

- Source: `uJZk/TiPlay`, based on main `b7e69569` plus this release's version and documentation changes.
- Runtime identity: extracted unchanged from public upstream `DiPlay-0.2.18.apk` at
  https://github.com/shihabal3amri/DiPlay/releases/tag/v0.2.18.
- Upstream APK SHA-256, checked against its published checksum:
  `e241457b36b21fe75b06b5682b4dcfc4fbc25cf75b1855c7a4d055129635ce8e`.
- `identity.pk8` SHA-256:
  `bd50eda2d8dd95a8464440f1aebca7068dcab46a2461ecaf826c7f98f5621a75`.
- `certificate.p7b` SHA-256:
  `634a93dd6c4338080524025411752597ecb828591839cd062a8292fd7e9e844e`.
- Android signing certificate SHA-256:
  `abf1f8b0af9653baeb22b8d33b3e48c8436285802b434ca0bbc3b68fc706a506`,
  matching the October 11 signing certificate.

The two runtime assets are the same as those extracted from upstream 0.2.17.
Selecting upstream 0.2.18 for authentication does not merge its source.
The experimental identity is extractable from the APK; see
[the notice](THIRD_PARTY_NOTICES.md#experimental-authentication-data).
The Android signing key is excluded from all distributed artifacts, and the
source archive excludes both runtime identity files and local build inputs.

## Validation and delivery

Publication is explicitly authorized by the user's request to publish a beta.
Use tag `v0.2.14-beta.1` with GitHub's prerelease flag. The historical `uJZk/DiPlay`
repository URL redirects to `uJZk/TiPlay`; both resolve to the same repository.
Keep the old empty `v0.2.13` draft separate.

Node 22 browser tests: 65/65 passed. Complete Android CI passed in 6m 6s:
shared 1,232, common 1,055 and home 4 tests (2,291 total), with zero failures,
errors or skips; mobile/home/maphost debug lint and builds all passed.
Release lint and signed APK build passed in 3m 16s. APK signature verification
passed and matched the signing fingerprint above. Manifest package, version,
minimum/target API values matched the build configuration. Both packaged runtime
assets matched the upstream inputs byte for byte, and the only credential
containers in the APK were the two selected runtime files. All three ABI AirPlay
libraries are present; the APK contains no bundled browser page.
Public source credential and whitespace checks passed.

The exact build commit and final APK/source checksums are recorded in the GitHub
Release notes and attached `SHA256SUMS.txt`. Upload and publication are the next
steps after committing this release change and assembling at the committed tree.
Session inputs, logs and deliverables are outside Git in
`/workspace/release-beta-2026-10-12/`.

Real-car CarPlay, full Bluetooth audio and iPhone AirPlay acceptance remain
unverified. The AirPlay receiver currently carries video only; it supports
neither AirPlay audio nor DRM or HEVC mirroring. Lightweight AirPlay device trust
is still pending as recorded in [todo.md](todo.md).
