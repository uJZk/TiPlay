# Web sweep result

Reviewed the `web` section of SCOPE.md against STANDARDS.md rules 1–9. All 11 production Kotlin files are additions since `e837efa`; no inherited upstream code was edited. Reviewed all 12 assigned test files and the JSON fixture; the binary fixture was excluded from edits.

## Changes

- `BrowserTouchSlots.touch`: replace `map { id }.distinct()` with a direct comparison when there are exactly two contacts. The existing size guard already rejects more than two; zero or one cannot contain duplicates. Removes temporary collections for each valid touch update while preserving validation order, synchronization, slot ordering, callback ownership and watchdog behavior.
- `VideoPerformance.Samples.summary`: sort the copied `DoubleArray` in place instead of converting it to a boxed sorted list. Preserves sample order for averaging, percentile selection, the bounded 240-sample window and synchronization. Avoids boxed sample storage while holding the metrics monitor.

These are allocation reductions established by the code paths; no latency, throughput or vehicle performance improvement was measured or claimed.

## Performance and lifecycle review

- `WebMediaSink` / `WebVideoHub`: main-screen gating, owner identity and close serialization keep retired sinks from taking over. Frame byte arrays are shared unchanged with the decoder. There is no per-frame codec-config parsing; identical configurations are skipped. Key-frame detection stops at the first slice. Frame ingestion holds the hub lock but performs no socket write; key-frame requests dispatch through the executor. Existing locking and callback order remain intact.
- `BrowserLinkServer` / `WebVideoRecords`: the writer reuses its gathered-write buffer, copying the record once and issuing one socket write per record. Splitting that write or changing payload ownership would require measurements and a broader design decision. Writer stalls have a watchdog; stop ends streams, allows the existing grace period, closes sockets and shuts down server executors. HTTP request size and active connections are capped. The connection executor uses an unbounded queue, but admission tracks at most eight active sockets; no queue policy was changed.
- `WebFrameQueue`: frame age, count and bytes are bounded, parameter-set bytes count toward the budget, and overflow/expiry preserves the key-frame recovery policy. Config records deliberately remain ordered and never drop; see the open decision below.
- `BrowserTouchSlots`: preserves the synchronized callback and fresh output contact list because recipients may retain it. No buffer/list reuse or lock removal was attempted.
- `VideoPerformance`: sample windows and rates are bounded; snapshots still compute under the metrics monitor, which frame ingestion also acquires. The primitive sort reduces unnecessary allocation there without changing consistency. Moving snapshot work outside that monitor would require a larger synchronization design.
- `BrowserPairingGate`, `BrowserLinkStatus`, `WebJson` and `WebVideoCodecs`: reviewed validation, bounds, resource ownership and parsing. Pairing failure history and replaced-session history are bounded, JSON nesting is capped, and request bytes are capped by the caller. Codec parsing does repeat parameter-set extraction during configuration, but this is a deduplicated setup path, so no speculative refactor was made.
- Tests retain existing behavioral coverage for invalid/duplicate touches, slot order, retained reports, timing averages/percentiles, frame payload identity, queue overflow/expiry, lifecycle, server concurrency and protocol fixtures. No test-only mechanical churn.

## Validation

- `git diff --check -- shared/src/main/java/com/shilapi/xcertplay/web`: passed.
- `./gradlew :shared:testDebugUnitTest --tests 'com.shilapi.xcertplay.web.*'`: blocked before compilation because the sandbox cannot create the default `/home/agent/.gradle` wrapper lock directory.
- Retried with `GRADLE_USER_HOME=/tmp/tiplay-sweep-gradle`: blocked before compilation by `java.net.SocketException: Operation not permitted` while downloading Gradle 9.5.0. No installed `kotlinc` was available as an alternative. These results are infrastructure failures, not passing tests.
- Coordinator owns the mandatory full Android CI command and shared browser/public-tree validation.

## Open decisions

1. `WebFrameQueue.offerConfig` retains all config records outside frame budgets. Repeated distinct codec configurations while a writer is slow can grow the config backlog and lengthen scans in `expire`. A bound or coalescing rule would alter the explicit never-drop/ordering contract; left unchanged.
2. `WebVideoHub` defaults to a single-thread executor with an unbounded request queue. A blocked key-frame network callback can accumulate periodic retries; forced requests on subscriptions bypass the ordinary rate limit. Coalescing, cancellation or a bounded queue would change request delivery/order and requires a separate lifecycle/policy decision. The hub is documented as process-wide, so its executor has no per-session shutdown.

## Coordinator verification follow-up

The earlier local infrastructure blockers above are historical. JDK/SDK setup is now fixed, and the full required Android test/lint/build command passed (2,177 tests, zero failures/errors/skips). Full browser unit suite passed 50/50; RealPhone.java compilation passed. Optional fake-phone E2E still fails the stats-event assertion, recorded separately in README.md. See README.md and ENVIRONMENT.md for final results and repeatable setup.
