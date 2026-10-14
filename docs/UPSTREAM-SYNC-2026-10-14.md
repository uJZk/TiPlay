# DiPlay source sync — 2026-10-14

The user chose a full DiPlay source merge while retaining TiPlay's Android phone + car
browser product scope. This replaces selective backports as the regular tracking method.

## Baseline and retained scope

- TiPlay started at `ad94410cc`, after pulling `origin/main`.
- DiPlay merge baseline: `c30d3f0df18dd132739d864a9e054c73b3d57d8c`, including
  0.2.19 and subsequent main fixes. The prior common ancestor was `e837efa95e`;
  444 upstream commits are retained through a merge commit.
- Keep TiPlay application ID `com.ujzk.tiplay`, current version `0.2.14-beta.2` /
  code 34 and mobile minimum Android API 28 at the initial sync. Subsequent beta.3
  packaging/versionCode 35 is recorded in [the delivery record](UPSTREAM-VIDEOJS-TIE-UP-2026-10-14.md).
- Preserve inherited packages, identifiers, native compatibility source, licenses and
  historical release records. Normal TiPlay entry remains phone + browser; retained
  head-unit source is not a second supported product.
- Keep Main and Advanced phone settings, immediate saving, automatic negotiation
  reconnect and hosted HTTPS browser pages. Native settings, cluster/vehicle listeners,
  wheel keys, call-popup guards, BYD Bluetooth operations and native update scheduling
  remain behind the head-unit integration gate.

## Applicable changes

The merge adopts upstream USB framing and completion handling, iOS 26 setup sequencing,
Bluetooth adapter compatibility, hotspot/address recovery, startup diagnostics, crash
records, software Opus encoding and protocol/audio corrections. Native-only features remain
available in source for future merge reuse without gaining phone product entry points.

TiPlay-specific adaptations:

- Feedback and browser audio timestamps use negotiated `rtpClockRate`; decoding/output
  still use `sampleRate`. This fixes 16/24 kHz RTP streams decoded at 48 kHz.
  Feedback remains an estimated receiver position, not a measurement of audible car audio.
- Browser microphone capture starts on stream setup even without a downlink packet.
  HFP/SCO empty reads wait briefly and restart after one second; read errors restart
  immediately, with at most three attempts. No handset microphone fallback is introduced.
- Browser buffered-audio bounds, underrun recovery and fill pacing remain. Upstream
  retained-PCM accounting and paced filling stay in the native path.
- The old browser enum preference is migrated to `tiplay_car_bluetooth_audio`, avoiding
  collision with upstream's Boolean `car_bluetooth_audio`. Existing choices survive.
- Browser capability negotiation stays independent of Android hardware video decoders.
- Japanese upstream resources and TiPlay browser translations are included, alongside
  phone-scoped Japanese website output and a Traditional Chinese TiPlay README.
- The site generator now matches the configured TiPlay Pages browser address and current
  beta version. Native update source and exported filenames use TiPlay.

## Verification

The full required Android CI command passed with JDK 25, Android SDK 37 and Node 22:
shared 1,822 tests, common 1,475 tests and Home 6 tests, with no failures or skips;
mobile/Home/MapHost lint and debug assembly passed. Browser unit tests passed 116/116,
Chromium page tests passed, native AirPlay JNI boundary checks passed and release-draft
unit tests passed 9/9. The subsequent Video.js v10 migration is recorded separately in
[VIDEOJS-10-2026-10-14.md](VIDEOJS-10-2026-10-14.md).

Real iPhone/car checks are still needed for USB/wireless negotiation, SCO capture recovery,
call/Siri/navigation timing, media continuity and vehicle browser compatibility. Automated
checks do not establish those device results.

## Next upstream merge

Use the full-merge procedure in [Upstream.md](Upstream.md). Git now has the complete
baseline ancestry, so the next comparison starts at this merge rather than reconstructing
which upstream fixes were manually ported. Keep product adaptations in owned files where
practical and retain small integration hooks in inherited source.
