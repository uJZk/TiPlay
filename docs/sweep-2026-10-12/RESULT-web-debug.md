# Browser Debug and synchronized timing

## Authorized repairs

- Debug now contains exactly four fields: codec, five-second central-90% presentation FPS, central-90% frame latency, and slowest-5% frame latency. Numbers round to integers and carry `fps` / `ms` units. The removed slowest-FPS field remains available in full diagnostics, where it is still useful.
- Following the user's request to restore the original absence of hardware/software labels, the first field now contains only the codec (for example `HEVC · 60 fps · 5 ms · 34 ms`). WebCodecs exposes a hardware acceleration preference, not the decoder implementation actually selected. The preference remains in diagnostics; `decoderImplementation` explicitly reports `unknown`.
- A concrete synchronization gap existed when SETUP omitted `timingPort` or supplied zero: the Android timing server answered iPhone timing requests, but never initiated a reciprocal exchange, so its `synced` flag could never become true. The session now starts the timing client even without a port. The clock learns an endpoint only from a timing request whose address matches the RTSP peer, then uses the existing four-timestamp exchange to synchronize. Advertised-port behavior remains unchanged.
- This is a supported-path defect established from code and tested with an emulated timing peer. No actual affected iPhone SETUP capture is available in this environment, so it is not proof that missing timingPort caused the user's observed `—`.
- Source timestamps still follow the real chain: screen header NTP 32.32 → synchronized Android monotonic time → optional kind-5 record → browser clock bridge → decoded frame → canvas submission. No receive-time estimate substitutes for an absent source timestamp. Stale, future and invalid timing remains unavailable. New `timingRecords` / `timingRejected` diagnostic counters distinguish absent server timing from browser mapping rejection.
- Browser appearance is replayed after each successful stream connection/reconnection and included in periodic stats as an actual Boolean, preserving the Android contract despite generic stats flattening converting booleans to numbers. Existing immediate system-theme change reporting remains active.
- Service worker cache initially bumped to v15, then to v16 for the requested label removal.

## Compatibility and cleanup

Upstream filenames, identifiers, callbacks, codec selection, record v1 layout, optional timing negotiation, preference keys, queue policies and frame ownership remain unchanged. No obsolete display-only slow-FPS helper was removed because that statistic remains useful in complete diagnostics. Rolling statistics now sort each sample vector once and reuse it for both percentile ranges, removing two duplicate sorts and array copies per snapshot while preserving fractional boundary weights. Reviewed video/touch/transport hot paths retain their existing bounded queues and retained-frame release paths; no speculative performance gains claimed.

## Verification

- Updated the four-field formatting regression to require codec-only display for both hardware and software acceleration preferences.
- Added decoder pipeline regression showing a synchronized timestamp reaches presentation and a missing clock produces null, with diagnostic rejection accounting. Targeted video tests: 4 passed.
- Added `PeerInitiatedTimingTest`: real loopback UDP request/reply exchange with an emulated iPhone clock offset by 120 seconds; synchronization requires both reciprocal exchanges and maps to Android monotonic time. Coordinator runs it with the full Android CI set.
- Existing theme E2E now checks actual authenticated Boolean `themeDark` reports for both dark/light changes during reconnect, plus periodic decoded stats before and after recovery.
- Existing browser E2E assertions updated for four fields; its worker-stream, worker-chunk, worker-frame and main-thread paths already assert timestamp-to-draw latency.
- Local sandbox Node run passed 9/10 files; site assembly was blocked by subprocess `EPERM`. Coordinator reran all browser tests outside that restriction: initial 63 tests passed; one additional pipeline regression above was then added.
- Local E2E attempt was blocked by loopback listen `EPERM`; coordinator owns the permitted Chromium run and final results. No duplicate server/process remains running.

## Measurement limits

Actual iPhone timestamp semantics (capture vs scheduled presentation), the user's affected SETUP exchange, and physical display scanout were not measured here. The displayed latency remains a synchronized iPhone frame-time-to-canvas-submission estimate, not a verified capture-to-photon result. Browser APIs cannot currently certify hardware versus software decoder selection. Real device confirmation remains necessary for those claims.

## Coordinator verification follow-up

The revised fake-phone Chromium E2E passed, including authenticated dark/light Boolean reports. The first real-phone harness run failed at Java compilation because its `BrowserLinkStatus` constructor call predated the `portalRevision` argument. Updated the harness to explicitly pass `0L`, matching its lack of portal-open requests. `VideoTeeMediaSink` constructor usage still matches its existing API; no production change was required. Coordinator owns the real-phone rerun.

The next real-phone run reached decoding, touch and complete stats, then exposed another stale harness assumption: `#fit` is inside the portal, which is intentionally hidden during CarPlay playback. The test now first confirms an actual display/viewport mismatch, invokes a harness `portal` command backed by the real `BrowserPortalSignal`, waits for the portal, and tests the same fit button and callback. Status now reports the real signal revision rather than the initial constant zero. After the mismatch clears, the test resumes CarPlay via its existing Connect action. Timeouts and fit assertions were not relaxed; production behavior is unchanged.

A subsequent run timed out awaiting the next session's first rendered frame. Added failure-only session/keyframe/hub/page diagnostic evidence to that assertion, without relaxing its deadline or changing production. The permitted investigation rerun then passed all real-phone checks with process exit 0 (`work/phone-e2e-debug-validation.txt`), including the exact next-session assertion, retired-sink exclusion and cross-origin playback. This successful rerun does not establish a cause for the earlier intermittent timeout.

One additional repeat also passed all checks with exit 0 (`work/phone-e2e-repeat-validation.txt`). Verification stopped after those two consecutive full passes. Android CI was running concurrently during these browser runs; host load is a possible contributor to timeout variability, not an established explanation. No production lifecycle change was justified by the observed evidence, and the earlier timeout remains an explicitly recorded limitation.
