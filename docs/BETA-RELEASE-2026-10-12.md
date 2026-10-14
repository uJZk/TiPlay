# TiPlay 0.2.14-beta.1

This is the dated beta.1 build and delivery record. Upload failures, approval
blocks and pending steps below belong to their original sessions. The later
[October 13 delivery record](BROWSER-MEDIA-TIE-UP-2026-10-13.md) records beta.1 as
published and beta.2 as a prerelease draft; use that handoff instead of resuming
the old draft/upload steps here. Remote states were not revalidated in this
documentation review. The official project destinations are now
https://github.com/uJZk/TiPlay and https://ujzk.github.io/TiPlay/.

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

Build commit: `283d4582be56ae39e8874de739119fd6884c645e`, merged into main and pushed.
The final committed-tree APK assembly passed in 15s and the signature, runtime
assets and matching source archive were checked again.

- APK SHA-256: `4a8265fc5170070af2e3eaa08cfe56de7e24c3c294c2775aee0e9316848da23b`.
- Source ZIP SHA-256: `7e388ecd90a39c243cdade7951def43c08dadeb68c5e818d7dc99212ded54bd8`.
- GitHub Release draft ID: `410162538`, tag `v0.2.14-beta.1`, prerelease true.
- The source ZIP and `SHA256SUMS.txt` uploaded successfully. The 39 MB APK failed
  with HTTP 401 at `uploads.github.com`, both with gh and an Expect/continue curl
  request. The environment reported its GitHub binding ready on both API and
  upload hosts; that readiness did not establish successful large-attachment upload.
- Publication remains pending; the incomplete release is still a draft.

A checksum-verified GitHub Actions upload workflow was prepared locally in
`/workspace/release-beta-2026-10-12/upload-prepared-release.awaiting-approval.yml`,
but automatic approval rejected
its commit/push because a persistent workflow with Contents write permission
requires explicit authorization. It has not been committed, pushed or run.
The user was asked to approve a temporary workflow (removed after use), or fix
the upload credentials for direct upload. Do not bypass that rejection.

Next: upload the exact APK above through the approved path, verify all three
remote attachments and their hashes, then publish the beta with prerelease true.
Do not rebuild or change the draft's target commit when resuming this upload.

## Release build workflow follow-up (historical sequence)

The user subsequently requested a non-debug APK release build workflow.
`.github/workflows/android-release.yml` builds a signed mobile release with
Contents read permission, automatically extracts the pinned upstream identity,
and uploads Actions build artifacts. It does not upload or publish a GitHub
Release. Signing requires the four repository secrets documented in
[BUILD.md](BUILD.md#github-actions-release-build); cloud runtime variables are
separate from repository secrets. Listing repository secrets via the current
GitHub integration returned HTTP 403, so their presence could not be established.
Workflow YAML, shell and embedded Python syntax checks passed. A local signed
release rebuild and release lint passed in 51s. The previous beta draft's exact
APK and matching source inputs remain preserved separately.

The release-build workflow was committed and pushed as `beb37772`. Run
https://github.com/uJZk/TiPlay/actions/runs/38204537123 failed at the signing-input
check before Java/SDK setup or compilation. The integration could not retrieve
the runner logs because their download host was denied by network policy, so
the exact missing secret names were not established. Configure the four signing
repository secrets, then rerun this workflow. The user explicitly stopped local
release builds; continue with GitHub Actions only. Do not resume the separate
Contents-write upload workflow without its required authorization.

The repository secrets were then configured. Actions run
https://github.com/uJZk/TiPlay/actions/runs/38204955887 succeeded, including
release lint/build, APK identity verification and Actions artifact upload.

The user subsequently explicitly requested automatic Release draft delivery,
with APK, source ZIP and SHA256SUMS.txt. This authorizes the new separate
Contents-write draft job in `android-release.yml`. It uploads the verified
Actions build outputs, sets the exact build target, verifies remote hashes,
and keeps the Release a prerelease draft. The old temporary split-upload workflow
is unused. No local Android build is required or authorized by this follow-up.

Eight release-delivery tests passed, covering checksum and source-credential
rejection, draft creation/reruns, preservation of published releases and remote
asset verification. YAML, shell, embedded Python, public-tree and whitespace
checks passed. Automatic review rejected the combined commit/main-push/dispatch
action because it required explicit approval for this exact default-branch push
and remote execution. The user subsequently explicitly authorized the commit,
main push and workflow execution. Draft delivery will be verified in Actions;
no local Android build is part of this follow-up.

Delivery commit `4a8f8670` was pushed and Actions run
https://github.com/uJZk/TiPlay/actions/runs/38207149600 built and uploaded all
three attachments to prerelease draft `410201815`. Its final draft lookup failed
because GitHub's tag endpoint returned 404 for this unpublished draft. The
publisher now finds drafts through the authenticated paginated Releases list;
a regression test covers this case. A fresh workflow run will verify the repair.

Session inputs, logs and deliverables are outside Git in
`/workspace/release-beta-2026-10-12/`.

Real-car CarPlay, full Bluetooth audio and iPhone AirPlay acceptance remain
unverified. The beta.1 AirPlay receiver carried video only; it supports
neither AirPlay audio nor DRM or HEVC mirroring. Lightweight AirPlay device trust
is still pending as recorded in [todo.md](todo.md).

Subsequent source supports mirror companion AAC-ELD audio and enabled HEVC
mirroring, while URL video uses browser Video.js with authenticated proxy or
direct resources. Standalone audio-only reception and DRM remain unsupported.
The earlier video-only and read-only-workflow descriptions are superseded;
`android-release.yml` includes the authorized Contents-write draft job. See
[AIRPLAY.md](AIRPLAY.md) and [BUILD.md](BUILD.md#github-actions-release-build) for
current contracts. Historical APK hashes and test totals above are unchanged.
