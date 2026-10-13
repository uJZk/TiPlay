# R2–R3 — reverse notifications and buffered decoder cancellation

Status: implementation and seven behavioral regressions complete; source/test files frozen for the coordinator's full Android validation. Scope follows REPAIR-SCOPE.md and STANDARDS rule 13. No Gradle, commit or push was run by this owner.

## R2: reverse socket writes outside playback ownership

`ReceiverServer` now gives each connection an ordered event writer with one daemon worker and at most 32 pending events. Selecting the reverse connection and submitting playback notifications occur under `ownership`; actual socket writes/flushes occur only on that captured connection's worker. The queue never resolves a session ID again, so replacing a reverse connection with the same ID cannot redirect an old stopped event. The writer retains the existing output monitor to avoid interleaving HTTP replies and events on the wire.

`finishPlayback()`, nested `/stop`, `Connection.finish()` and display-update retirement can now keep their state/resource/callback ordering without waiting for reverse output. Resource-request capture and enqueue also happen under `ownership`, before a subsequent stop can cancel the request and enqueue its stopped notification. Network writes remain asynchronous. A saturated event backlog closes that slow connection rather than allocating unbounded work or blocking ownership. Connection cleanup shuts down queued event work and closes the socket without joining the worker; server-wide shutdown closes all sockets before ownership cleanup, unblocking real network writes.

Two new `ReceiverServerTest` regressions upgrade real TCP reverse channels, then install a latch-controlled output wrapper on the selected connection:

- `blockedReverseWritesDoNotHoldPlaybackOwnershipAndQueuedEventsKeepTheirOrder`: a blocked event writer does not block `/stop` or a subsequent `/play`. Stop cancels a waiting resource request. Once released, the original connection receives playing, paused, resource request and stopped in submission order.
- `queuedStoppedEventsCannotReachAReplacementReverseChannelAndCloseDoesNotWaitForItsWriter`: a new reverse connection with the same session ID receives no old stopped event; closing the server while its writer is blocked completes without waiting for the latch and closes the real socket.

These fixtures replace a live output stream through reflection solely to make backpressure deterministic; assertions exercise real request dispatch, TCP responses/events, resource cancellation and socket closure, not source text or lock declarations.

## R3: prompt decoder retirement with publication leases

Each `BrowserAudioMediaSink.Decoder` now owns a `WebAudioHub.Publication` lease. A decoder's short monitor still validates `running`, pause and `routeEpoch` and handles Bluetooth routing, but browser PCM publication and its up-to-one-second music-capacity wait occur after that monitor is released. Retirement invalidates the lease, drops its queued packets, clears the decoder queue and interrupts its worker without waiting for music capacity. Worker `finally` also retires its lease and retains codec stop/release cleanup.

Lease retirement and reset/epoch admission are serialized under the hub monitor. A retired decoder cannot increment a replacement's epoch through a late `reset=true` publication. Queue records retain the lease; take rejects retired records and an enqueue racing retirement removes its own obsolete packet. Existing subscription generations still handle owner and route transitions. Live queue mutation, clear/discard and timeout retirement use a short subscription monitor; the blocking music offer holds neither the hub nor subscription monitor. Lock ordering is hub → subscription → queue; no path holding a subscription/queue lock calls into the hub or decoder.

Ordered music/backpressure, Bluetooth route records, route epochs, first-packet reset, pause/resume and output-buffer `finally` release remain. Data already admitted to a consumer before retirement remains in flight; queued retired data is rejected. Bluetooth `play` remains under the short decoder monitor: the current implementation calls bounded in-memory `BluetoothVoiceMixer.offer`, which performs conversion/enqueue without network/hardware I/O or waiting for capacity.

Five new audio regressions:

- `BrowserAudioMediaSinkTest.replacingADecoderBlockedOnMusicCapacityRetiresItsPendingResetWithoutClosingTheReader`: fill actual hub music capacity, wait until the real LPCM decoder enters its timed queue offer, replace promptly, preserve preceding music order, and verify only fresh reset/PCM with a continuous new epoch.
- `BrowserAudioMediaSinkTest.pausingAFullMusicDecoderReturnsPromptlyAndResumeStartsOnlyFreshPcm`: pause while the real decoder is blocked; resume emits fresh PCM and reset without old samples or subscriber retirement.
- `WebAudioHubTest.aRetiredPublicationCannotEnqueueOrAdvanceTheReplacementEpoch`: latch-delay an old reset until after its lease is retired and a new reset is consumed; the late reset produces no packet and the new producer's next PCM keeps its epoch.
- `WebAudioHubTest.retiringAFullPublicationReleasesItsQueuedAndWaitingMusicBeforeReplacement`: retire a lease with both queued and waiting music; no old PCM survives, the waiting producer exits, and a replacement publishes through the same open reader.
- `WebAudioHubTest.retiringAPublicationCancelsEveryWaiterEvenWhenOtherMusicKeepsTheQueueFull`: three waiting producers share a retired lease while another lease keeps all 16 queue slots occupied; all waiters exit within the existing 500 ms assertion without caller interruption, and the active queue/order/reader remain intact.

## Validation and limits

- `git diff --check` passed for all six changed production/test files.
- Only the three authorized production files and their three existing test files changed for this repair. No dependencies or additional production interfaces outside scope were added.
- The coordinator runs the full Android checks centrally. Hardware Bluetooth/MediaCodec throughput and latency were not measured, so no performance claim is made.
- This repair explicitly authorizes bounded reverse-event queuing and cancellable generation-aware publication. It does not alter unrelated queue sizes, codec formats, network fallback or product defaults.

## Initial compilation correction

The first full Android run rejected Publication.close's expression body because nullable subscription discard inferred a nullable return instead of Closeable's Unit. The coordinator changed it to an explicit block body; locking and cancellation behavior are unchanged. Initial evidence retained in TIE-UP-ANDROID-INITIAL-COMPILE.txt, then full task set rerun.

## Full-run failure and cancellation follow-up

The coordinator's first integrated shared run executed 1,354 tests. Its sole failure was the new `retiringAFullPublicationReleasesItsQueuedAndWaitingMusicBeforeReplacement` assertion at line 52: the waiting producer was still alive after lease retirement and the existing 500 ms join. XML duration was 0.513 seconds. Decoder retirement's interrupt covered decoder workers, but a standalone `Publication.close()` had no guarantee that removing queued packets would wake every timed `ArrayBlockingQueue.offer`; a full queue owned by a different publication also cannot be cleared just to wake a canceled producer. This exposed a real cancellation gap rather than an overly short test deadline.

Buffered publication now uses the original **one-second absolute monotonic deadline** with at most 10 ms per queue wait, checking subscription closure, generation and lease activity between waits. Retirement therefore completes waiting publication without depending on queue bulk-removal notification or interrupting a caller-owned thread. Genuine slow-consumer retirement still occurs only when the original one-second budget expires; active music remains ordered and is not dropped. The original 500 ms cancellation assertion is unchanged, and the three-waiter/other-owner-full-queue regression covers the independent cancellation path. Thread-wait observation now returns the observed state directly rather than rereading it after a short timed wait may have resumed.

The coordinator's explicit `Publication.close(): Unit` correction is retained. Changes were confined to `WebAudioHub.kt` and `WebAudioHubTest.kt`; `git diff --check` passed. Source/tests were frozen again for a full centralized rerun; no additional Gradle command was started by this owner.
