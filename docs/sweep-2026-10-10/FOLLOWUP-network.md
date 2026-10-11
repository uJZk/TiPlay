# Network queue and resource lifecycle follow-up

Implemented the authorized policy changes in TiPlay-owned network code. Original upstream implementation is untouched.

## Hotspot refresh ownership

`HotspotRefreshQueue` retains at most one queued check in addition to a running check. Ordinary events merge; an explicit retry is ORed into the pending check and cannot be erased by later broadcasts. Requests during a running check retain one follow-up. Closing cancels that follow-up and rejects future events.

Session initialization uses the same cancellable queue. Replacing a session that has not started cancels its initialization without posting a teardown; this prevents repeated address/backend choices from retaining a queue of obsolete startup/cleanup tasks. A session that has begun work posts its resource teardown behind its running check. Receiver registration/unregistration, finder/backend cleanup and address removal run on the worker, outside state locks. Existing removal-before-new-initialization ordering is retained. Cancelled futures are removed by the existing executor policy.

Starting the same address/backend replaces its eligibility predicate with the newest caller's predicate. Closed/stale sessions cannot overwrite root-refusal state; an old stop publication cannot overwrite a newly started session.

## Root shell resources

Removed the blocking stdout reader thread. The caller drains only bytes already available from the process pipe, checks completion in intervals of at most 10 ms, and uses a monotonic timeout deadline. Each drain pass is bounded to 65,536 bytes, so a descendant continuously writing after its parent exits cannot keep the drain loop running forever. Retained output is capped at 65,536 encoded bytes and then the existing 16,384-character tail before parsing the exit marker.

All process streams close in `finally`; the live direct process is forcibly destroyed without waiting for descendant EOF or joining a reader. Interrupted callers preserve their interrupt flag and return `TimedOut`. The validated script and wrapper are smaller than a pipe buffer, so writing to the newly created stdin pipe does not depend on the command consuming input. No additional reader/cleanup thread is created. Descendant process termination itself remains the operating system/root-shell responsibility; this change releases TiPlay's pipe ownership independently of descendant stdout lifetime.

## Regression checks

Added tests for:

- 10,000 queued refresh events retaining one check and the explicit retry;
- a blocked running check plus 10,000 follow-ups, then cancellation and rejection of later events;
- 1,000 unopened session generations releasing their queued work before the newest generation runs;
- same-address starts respecting the newest eligibility predicate;
- timeout with a descendant holding stdout, with no surviving reader thread;
- interruption returning promptly with the caller interrupt preserved;
- output exceeding the retained tail limit still parsing the final marker.

`git diff --check` passed. A focused network Gradle run was started, then deliberately stopped before compilation to avoid overlapping the web agent's assigned Gradle slot. The coordinator will run the network tests with its next shared-test batch and full CI. No performance gains are claimed without measurements.

## Coordinator final verification — 2026-10-11

The full mandatory AGENTS.md Android command passed in 7m 40s, including this module's regression tests, all three application lint tasks and debug APK builds. Shared/common/home report totals are 1,205/992/4, zero failures/errors/skips. See FOLLOWUP-ANDROID-VALIDATION.txt and FOLLOWUP-ANDROID-TEST-SUMMARY.json. Final verification supersedes earlier pending/failed attempts above.
