# Tooling queue/lifecycle follow-up

Implemented only in `tests/web-e2e/`, under the 2026-10-11 authorization for lifecycle/policy fixes. Preserved the earlier redundant Java parser-guard cleanup. No shared README/TASKS edits or commits.

## Changes and bounds

- Both runners acquire their initial server/phone/browser inside cleanup ownership. Nested finalizers retire all acquired resources even when another close fails; temporary clip directories are removed on startup failure. Server listen failures reject instead of becoming unhandled events. Failed Java child startup kills/reaps the child; successful shutdown waits briefly for graceful exit, then kills/reaps if necessary.
- Retained event/request/error histories hold at most 20,000 entries each and count all arrivals. They retain early evidence and original marks; overflow explicitly fails final assertions, rather than letting truncated evidence report success. Auxiliary CORS/bye/service-worker histories use the same policy. Decoder config evidence and live worker tracking are capped at 64; terminated workers leave the active set. Replaced fake sessions are capped at 1,024 and excess takeover requests are refused; deduplication state is also capped at 1,024 sessions and retains prior session sequence values.
- Fake video checks `write()` backpressure for configuration and frames, pauses frame production until `drain`, and removes timers/drain listeners on replacement, disconnect and shutdown. No required codec/frame record is silently discarded; stopping a blocked stream destroys its socket instead of adding more queued output.
- RealPhone callbacks enqueue stdout evidence asynchronously in FIFO order into a 4,096-line queue. A short enqueue/state lock protects close ownership; stdout I/O runs only on the writer thread. Saturation reports an explicit harness failure and exits unsuccessfully. Teardown waits for media executors, drains logging with a three-second bound, and closes a tap whose session startup failed before publication. Late daemon callbacks after teardown no longer own live evidence.
- Fake E2E now waits for a stats event with decoded FPS and worker path before asserting its full report and 2,048-byte protocol limit. The previous unconditional first-event selection matched the observed initial link-only report; behavioral assertions remain intact. The real runner likewise waits for the full unsupported-codec report.

- Real E2E explicitly forces unsupported WebCodecs in its first case, preserving exact message/stats assertions on hosts that support H.264. A direct secure-localhost capability query returned `supported: true` for the installed Chromium. The native MSE case fixes its stale `page.live` path to `page.link.live` (matching app.js stats), and strengthens supported playback to require positive decoded FPS. The stand-in scenario starts a fresh real session because native MSE may already have consumed the once-per-epoch rendered notification; later session expectations derive from that restart. Stand-in frame/protocol/recovery assertions remain intact.

## Verification

- Node focused regressions: 4/4 pass. Checks cover a 10,000-entry history burst, listener startup rejection/cleanup, and a paused video peer with bounded buffered bytes, production resuming on drain, and timer teardown; control deduplication across a bye also remains intact.
- Temurin 25 compiles RealPhone and LogCheck against existing shared classes and Gradle's Kotlin runtime. LogCheck passes: producers finish while stdout is blocked, 2,001 lines drain in order, and a saturated subprocess exits with failure.
- Injected nonexistent Chromium and Java executables: both runners exit failure within a 20-second timeout, with no retained temporary phone clip directory.
- Java lifecycle smoke passes: graceful quit and invalid-port startup both terminate within the timeout.
- JavaScript syntax checks and scoped `git diff --check` pass.
- Full fake-phone E2E passes every check: decoded stats report, worker/worker-chunks/worker-frames/main/MSE paths, touch mapping, decoder/reconnect recovery, service-worker cache and download exclusion. Output: `/tmp/tiplay-tooling-e2e.log`.
- Full real-phone E2E passes every check against freshly compiled shared classes: forced unsupported-codec branch, native supported H.264 MSE with positive decoded FPS, stand-in chunk/config/touch/stats assertions, decode-error/key-frame recovery, session restart/stale-owner protection, bye, cross-origin CORS, and secret/session-ID redaction. Output: `/tmp/tiplay-tooling-phone-e2e.log`.

The bounds protect a verification harness; exceeding evidence capacity fails the run and asks for a more selective assertion strategy rather than silently reducing coverage. No measured performance gain is claimed.
