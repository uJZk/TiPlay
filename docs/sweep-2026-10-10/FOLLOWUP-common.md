# Common settings probe follow-up — 2026-10-11

## Changes

- Added `LatestSettingsProbe`, shared once per settings card type across card instances/renders. Each helper permits one running interface probe and retains only the newest pending request, at most one completed result and one scheduled main-thread delivery. A burst replaces pending work instead of creating a thread for every event.
- Cancellation drops the pending request/result, clears the delivery callback and removes its queued main-thread runnable. Posting/removal share the state lock so cancellation cannot race a late post. A request token prevents an old card's detach from canceling a newer card. Workers capture application context and immutable inputs, not the activity or views; an already running platform read may finish but cannot publish to a canceled owner.
- Both `HotspotExtraAddressCard` and `TeslaBrowserLinkCard` start probes on view attachment and cancel on detach, alongside their existing listener registration/removal. Reattachment requests fresh data. Delivery additionally checks attachment. Existing worker thread names remain unchanged.
- Worker work and UI callbacks run outside the state lock. The main thread never waits for a worker. Probe exceptions release the failed callback and allow queued/new work to proceed.

## Bounds and policy

Across these two card types, at most two interface-read workers can run concurrently, with one pending replacement each. Only the newest requested owner/generation receives results. Running Android interface reads are not interrupted; a permanently blocked platform read can delay newer work in that card type, but cannot create additional worker threads or retain a detached UI callback. Introducing platform-read timeouts would need a separate strategy; no timeout or network fallback was changed here.

## Tests and verification

- `LatestSettingsProbeTest`: blocked first probe plus 1,000 replacement requests executes only the first/newest work; stale-owner cancellation does not cancel the replacement; detach removes running/pending and queued UI results; reattachment delivers fresh results; UI delivery is coalesced; failed probes recover.
- `TeslaBrowserLinkSettingsTest.detachedCardsDiscardBlockedProbesAndReattachmentGetsFreshLinks`: blocks both actual cards' interface probes, navigates away, verifies detached rows receive no late updates, then checks new links after reattachment.
- `git diff --check -- common` passes.
- Focused Gradle run passed in 58 seconds: `LatestSettingsProbeTest` (4), `TeslaBrowserLinkSettingsTest` (13), `HotspotExtraAddressSettingsTest` (31), 48 tests total and zero failures. Log: `/tmp/tiplay-common-focused.log`. Coordinator reruns the mandatory full Android CI command.
- The first full run exposed two link-delivery failures: clipboard retained the initial default link (missing `?t=10.176.81.135`), and reattachment missed the fresh link. Existing global thread-name joins also waited on unrelated Robolectric sandboxes blocked in platform tethering reads. Replaced those joins with helper-owned idle latches, made the fixture destroy all created activities, and resolve the current main looper when scheduling/removing deliveries. Exact clipboard and fresh-link assertions are retained and pass.

Prior uncommitted cleanup is preserved. No upstream implementation, protocol, persisted keys, consent flow, commits or pushes changed. No measured performance claims.

## Coordinator final verification — 2026-10-11

The full mandatory AGENTS.md Android command passed in 7m 40s, including this module's regression tests, all three application lint tasks and debug APK builds. Shared/common/home report totals are 1,205/992/4, zero failures/errors/skips. See FOLLOWUP-ANDROID-VALIDATION.txt and FOLLOWUP-ANDROID-TEST-SUMMARY.json. Final verification supersedes earlier pending/failed attempts above.
