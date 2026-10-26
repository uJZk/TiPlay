# D1 result

Status: done. Reviewed all nine files in [Scope-D1-1](Scope-D1-1.md) against the
[checklist](CHECKLIST.md), baseline `5c47dd00` and the media implementations in the
shared sweep workspace. GPT-6.1 Sol performed the technical comparisons because
Sonnet/Opus are unavailable. No implementation files, commits or publication were
changed by D1.

## Changes

- `Browser.md`, `CarPlay-DataChannel.md` and `WebRTC-roadmap.md`: replaced obsolete
  encoded-video/WebCodecs fallback, application pacing and touch-catch-up claims
  with required original-codec RTP, direct Processor-to-Canvas and authenticated
  video-only renegotiation. Distinguish unsupported/failed replacement from normal
  source replacement, and source/negotiated/initialized encoder observations.
- `Audio-tempo.md`, `Browser-wasm.md` and `AirPlay.md`: corrected Opus selection to
  require negotiated native RTP, PCM-NetEq fallback, Worker conversion exceptions,
  separate software/native limits and retired browser libsoxr. Kept AVPlayer's
  ownership and independent URL compatibility boundaries.
- `Audio-evidence.md` and `Diagnostics.md`: distinguish current measurements from
  retained schema fields. Current source deadlines remain
  `unknown`/`independent-audio` even with a valid diagnostic output mapping; old
  PD/Soxr deadlines, native float scans and policy fields do not certify current
  playback. Preserve bounded waveform/capture/privacy/delivery limits.
- `Testing.md`, `Diagnostics.md` and `WebRTC-roadmap.md`: removed repeated rollout
  diaries and obsolete controller settings; preserve useful historical field,
  waveform and standalone-clock observations with their version and uncertainty.
  Detailed retired-engine records remain linked to their immutable Git source.
  Current release evidence, historical tests and unperformed device acceptance
  are explicitly separate.
- Repaired D1 references to `Geolocation.md` and the renamed WebRTC notices anchor.
  All existing externally referenced D1 section anchors remain present.

## Verification

Compared claims with `audio-worklet.js`, `airplay-audio-decoder.js`,
`live-audio-software.js`, `neteq-audio.js`, `audio.js`, `audio-evidence.js`,
`audio-buffer-policy.js`, `video-diagnostics.js`, `rtc-video-receive.js`,
`webrtc-transport.js` and current decoder tests. The independent shared-code review
also checked normal source renegotiation, PCM bypass and unknown deadline behavior.

All D1 local file links and Markdown heading anchors resolve. `git diff --check`
passes for all nine files. Every reviewed file remains below 8,192 whitespace words;
the largest is `Diagnostics.md` at approximately 5,400 words. Implementation tests
were not rerun by this documentation-only task; repository-level validation is the
coordinator's responsibility, and existing release counts are historical evidence.

## Remaining boundary

Physical iPhone/vehicle RTP decoding, real JNI encoder switching, hardware selection,
gear changes, sustained audio quality/CPU/memory, independent speaker/panel latency,
HFP/SCO and AirPlay interoperability remain unperformed acceptance. Documentation
cleanup does not establish those results. The independent Cloudflare comparison
remains unfinished and its former Soxr design needs a current-engine scope decision.
