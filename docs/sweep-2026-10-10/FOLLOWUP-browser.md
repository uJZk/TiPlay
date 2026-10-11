# Browser queue and lifecycle follow-up — 2026-10-11

Implemented the browser decisions under the user's expanded lifecycle/queue authorization. Ownership stayed within `site/play/`, `tests/web/`, and this result file. The earlier MP4 allocation cleanup remains intact.

## Implemented bounds and ownership

- Added `transport.js`. The fallback worker feed uses a dedicated MessagePort per stream. A worker read issues one credit; the page sends at most one 64 KiB chunk for that credit. The worker stream uses a zero high-water mark, so a blocked codec configuration does not request more chunks. All bytes retain their order; required configuration/keyframe bytes are never silently discarded. Network read cancellation and credit-wait cancellation both release the body reader and ports. A fetched network chunk may remain locally while being split, but worker delivery cannot accumulate arbitrary posted chunks.
- Decoded-frame transfer permits one frame awaiting main-thread acknowledgement and one newest pending frame. Replacing/stopping closes the pending frame. An old transfer keeps its credit through reconnect until acknowledged; a stale acknowledgement cannot release a new transfer. The page closes frames from an obsolete stream and acknowledges in `finally`, including draw failures. Offscreen presentation remains direct.
- Record callbacks now receive a stream AbortSignal. Stop/replacement/timeout interrupts an unresolved configuration await, cancels the reader and releases its lock. Late codec support results cannot create a decoder after stop or supersede a newer connection.
- WebCodecs stop and natural stream end close the decoder, clear decode timing ownership and stop its sampling interval. Each read starts fresh decoder ownership. The presenter closes its retained frame on stop and closes a failed incoming frame if drawing throws. Final renderer disposal removes context listeners and deletes GL buffer, texture and program resources (attached shader objects are marked for deletion after attachment).
- MSE takes ownership of the source URL before awaiting `sourceopen`. Stop/replacement immediately revoke that URL and detach the video source. The pending wait is abortable and removes its listener. Late sourceopen, source-buffer construction failure, normal EOF and video error cannot revive or retain retired media. Final disposal removes video listeners.
- Pipeline messages carry stream IDs. The page ignores obsolete/inactive callbacks. Worker/main/MSE statistics timers run only while reading; worker stream end closes its presenter and frame queue. Normal reconnect uses reusable stopped sinks; non-persisted pagehide disposes renderers/the worker, while persisted pagehide can resume with fresh media resources.
- Service-worker version is v5 and caches the new transport module. Phone protocol and persisted keys are unchanged; generic `END slow-consumer` remains a normal reconnect reason.

## Verification

`node --test tests/web/*.test.mjs`: **60 passed, 0 failed**, using sandboxed network permission for the local Node/Python child-process restriction. Scoped `git diff --check` passed.

New regression coverage checks:

- blocked worker demand, bounded chunk size and exact byte order;
- cancellation during an outstanding network read and while waiting for credit;
- 100-frame bursts, pending-frame closure and stale acknowledgements across reconnect;
- stop during unresolved configuration, reader lock release, late codec probes, stale decoder output and natural EOF timer/decoder cleanup;
- presenter retained/failed frame ownership;
- stop during pending sourceopen, rapid replacement, stale source events, URL revocation, source-buffer creation failure, video error and subsequent reconnect.

Tooling agent also reports the full fake-browser E2E passing (all decode paths including credit/ack delivery, MSE error recovery, service-worker offline/download behavior, touches and stats; `/tmp/tiplay-tooling-e2e.log`). Coordinator owns full Android verification. No throughput or latency gain is claimed. No remaining browser queue/lifecycle decisions from the initial sweep are deferred.
