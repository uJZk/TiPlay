# D2 documentation review

Reviewed all 36 assigned files in [Scope-D2-1](Scope-D2-1.md) against the
[checklist](CHECKLIST.md), current source and retained release provenance.
No production code, tests, build configuration, license texts or generated assets
were changed by D2. No commit or push was performed.

## Corrections

- Reduced AGENTS.md from 2,766 to approximately 1,470 whitespace-delimited words:
  kept contributor rules, required source checks, settings/naming/upstream policy,
  current transport/URL contracts and stable resume links; removed repeated release
  diaries and historical CI waivers as current instructions.
- Updated both README source badges to beta.24, documented WebRTC plus
  MediaStreamTrackProcessor requirements, independent live timing and the actual
  iPhone-Bluetooth audio switch label. Added the English screenshot/first-load
  qualifications already present in Chinese.
- Corrected the location-permission entry to Main settings → Permission checklist,
  clarified the location opt-out, retained precise-permission and coordinate-evidence
  boundaries, and repaired the related links.
- Corrected Upstream's current browser audio/video ownership, expanded Android
  WebRTC provenance terminology and preserved the incoming legacy
  `android-webrtc-datachannels` anchor in Third-party notices.
- Replaced obsolete Todo calibration tasks for retired source/device clock fits,
  libsoxr/SoundTouch and custom URL queues with current native-RTP/PCM-NetEq and
  AVPlayer physical acceptance. Kept the independent Cloudflare comparison request,
  deferred FLUSHBUFFERED work, real-device limits, microphone/session/security
  work and relevant historical evidence distinctions. Corrected persisted Debug
  restart expectations.
- Added missing concise beta.17–22 changelog entries; corrected older release
  evidence links. Kept beta.24 artifact hashes/workflow/publication records intact.
  Build's older implementations are explicitly historical; v97 deployment remains
  the published record until the coordinator verifies a later deployment.
- Marked screenshot implementation details as capture-time provenance and removed
  obsolete README update execution diaries. Preserved source, legal credits and
  illustration boundaries.
- Repaired removed test/source references in audio-core, libav, fixtures and
  optional E2E documentation. Marked `run.mjs` and source-timed capture replay as
  historical fixtures, rather than current native-RTP playback acceptance.
  The media-clock description now matches its null source-time assertions and
  NetEq/audio-core graph; it makes no current +300 ms output-enforcement claim.
- Replaced broken libsoxr source/vendor links with fixed historical GitHub links
  and a disposable historical-worktree reproduction recipe. Labelled all six
  staged wasm2js review reports historical without rewriting measured results.

## File moves

Original paths remain in the scope table as review provenance. Current names:

| Original | Current |
| --- | --- |
| `docs/geolocation.md` | `docs/Geolocation.md` |
| `docs/BYD_SETTINGS_ENTRY_POINTS.md` | `docs/BYD-settings-entry-points.md` |
| `docs/RELEASE-NOTES-0.2.20.md` | `docs/Release-notes-0.2.20.md` |

All assigned-file inbound links were repaired. The coordinator owns remaining
references outside D2. The BYD firmware audit and DiPlay release notes now identify
themselves as historical upstream native-head-unit material outside TiPlay's
phone/browser product.

## Verification and limits

- Checked all 36 assigned files and 267 local Markdown file/anchor links: no
  missing targets or anchors; all assigned documents remain below 8,192 words.
- `git diff --check` passed for the shared working tree at completion.
- Compared current contracts with `gradle.properties`, `mobile/build.gradle.kts`,
  Android workflows, BrowserAdvancedSettings/BrowserPermissionsPage/
  BrowserCarPlayAudioSettings, `app.js`, `rtc-video.js`,
  `airplay-audio-decoder.js`, AudioWorklet, media-clock/capture probes and retained
  benchmark scripts. Confirmed removed libsoxr runtime/report inputs exist at
  historical commit `6d4e5018` before linking to that source.
- D1 confirmed current Opus requires native RTP and current fallback Worklet
  references have null source timing. D2 aligned AGENTS/Todo/E2E wording with those
  verified boundaries.
- Reviewed Connection setup, Hotspot address, Wlsc, raw-capture/SRP benchmark and
  AAC-ELD fixture notes without finding a verified correction necessary.
- No Android/browser runtime test was rerun solely for these prose changes.
  The coordinator owns source/build/site checks for the parallel code sweep.
- Historical firmware images and old local capture artifacts were not available
  for a new measurement. Their recorded observations remain attributed historical
  evidence, not newly verified physical behavior. Published hashes/workflow results
  were retained from existing provenance; D2 did not re-download release assets.
