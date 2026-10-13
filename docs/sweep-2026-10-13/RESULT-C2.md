# C2 — incoming shared code cleanup

## Scope and outcome

Reviewed the incoming shared production/test entries in INTEGRATION-SCOPE.md under STANDARDS.md rules 1–10 and 14. ReceiverServer, BrowserAudioMediaSink, WebAudioHub and R2–R3 fixtures remain with their repair owner. No changes to dependencies, upstream names, generated/vendor files or public APIs.

- `BluetoothVoiceChannel.kt`: retain private immutable policy sets instead of rebuilding them for every policy check. The mixer invokes the navigation predicate for each stream/sample; membership, normalization and short-circuit behavior stay the same.
- `BluetoothVoiceMixer.kt`: iterate the converted PCM tail by index instead of allocating and boxing a temporary `takeLast` list. The 160 ms tail, FIFO eviction, resampler state, per-stream ownership, locking, attenuation and clipping are unchanged.
- `AndroidBluetoothVoiceChannel.kt`: reuse one speaker-worker-local silence array before duplex readiness. Pass a full capture buffer directly to the synchronous, read-only resampler; partial reads still copy their valid prefix. The resampler finishes before the next capture read and retains no input array. No shared scratch buffer or route/lifecycle changes.
- `AirPlayVideoProxy.kt`: compile the three fixed range/content-type regexes once. Exact patterns and validation order remain intact; no change to peer matching, authenticated routes, redirect limits, protocol rejection, network fallback or asynchronous connection shutdown.

AirPlayVideoPlayback, AirPlayBrowserPlayback, BrowserLinkServer, BrowserMicrophone, ReceiverProtocol, BrowserPlaybackMode and incoming USB/root-shell hooks required no additional mechanical cleanup. Retired privileged USB source stays deleted. Incoming deterministic MFi retry and bounded UDP release checks are retained.

## Tests and verification

No tests removed or added. Existing BluetoothVoiceMixerTest covers routing policy, navigation attenuation, clipping, bounded tails, stream clear, continuous resampling and anti-alias filtering. AndroidBluetoothVoiceChannelTest retains permission denial, no-handset fallback, existing-call protection and route cleanup cases. BrowserMicrophoneTest retains authenticated packet ordering and nonce continuity across resumed demand. AirPlayVideoPlaybackTest, AirPlayVideoProxyTest and BrowserLinkServerTest retain stale command/report, range, URL/redirect, pairing and retired-resource coverage.

Source/diff review completed; targeted `git diff --check` passed. No Gradle invocation by this owner, per coordinator instruction; full Android verification is assigned to the coordinator. No runtime performance measurements were made, so the changes establish removal of redundant allocations/work only.

## Open decisions

- The pre-Android-31 Bluetooth profile listener checks shared `profilePending`/`wanted` flags but has no attempt token. A delayed callback from an earlier attempt can satisfy the flags for a newer attempt after stop/start; its disconnect callback also acts on any currently acquired route. Generation-scoping these callbacks would be a separate lifecycle fix with deterministic stale-callback regression coverage. It is not changed by this behavior-preserving cleanup.
- Resampling still creates filtered/output arrays and the bounded mixer queue still boxes samples. Replacing those structures needs ownership/numeric equivalence review and measurement; this pass deliberately keeps their algorithms and queue policy.
