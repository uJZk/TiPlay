# R1 — coordinated browser tap lifecycle

Implemented the user-authorized repair in REPAIR-SCOPE.md / STANDARDS.md 13 on the integrated main version. Only `TeslaBrowserLink.kt`, `TeslaBrowserLinkTest.kt` and this task's sweep records were edited.

## Behavior and locking

- A single private `tapLock` protects both weak tap maps. Creation, pause, resume, pair removal, canvas lookup and test cleanup all use it. The maps no longer have independent implicit monitors, so an audio retirement cannot modify the collection during the audio-pause iteration.
- Pause/resume still serialize the same audio/video transitions and retain the incoming ordinary-AirPlay resource guard, Bluetooth voice factory, and paused-on-creation behavior.
- Retirement removes the audio/video pair atomically, then closes the detached audio followed by its video outside `tapLock`. Replacement audio teardown is also outside the registry lock. A slow old audio/voice teardown therefore does not hold the registry, and owner-specific hub cleanup cannot terminate a replacement stream.
- Canvas updates capture the tap under `tapLock` and then rely on the existing sink monitor/closed check. Test reset captures and clears both maps under `tapLock`, resets the pause flag there, and closes both detached collections outside the lock. Previously reset only closed the audio collection and discarded the video references.
- Lock order during coordinated creation/pause/resume remains registry → individual sink/hub, with no second map monitor. Detached close never reacquires the registry and no sink callback was added. Existing serial transition semantics are retained; this is not a redesign that runs pause callbacks concurrently.

## Regression coverage

Added two runtime regressions to `TeslaBrowserLinkTest`:

1. `concurrentRetirementCannotInvalidateAnInProgressAudioPauseIteration`: creates three actual browser/audio taps, holds the first audio monitor with a latch, waits until the real pause worker blocks after obtaining the first iterator entry, and starts retirement of another tap. Both transitions must finish without errors. It then verifies every remaining display is paused, a newly created tap inherits that pause, the retained session resumes, and late calls from the retired tap cannot replace or clear the new stream. Under the old independent-map policy, retirement could remove the second audio entry before blocking on the video map, invalidating the paused iterator.
2. `delayedRetiredAudioCloseDoesNotHoldTheTapRegistryOrCloseTheReplacement`: holds the real retired audio monitor while retirement reaches close, creates and starts a replacement on another worker, and requires it to finish before releasing the old monitor. After old teardown finishes, the replacement must still own the displayed stream.

The tests use bounded latches, worker monitor states, captured worker failures and bounded joins. A test-only reflective lookup obtains existing audio objects while no workers are running; it introduces no production hook, fake map or source-text assertion. Sink keys remain strongly referenced throughout the interleaving.

## Validation

- `git diff --check` for both edited Kotlin files: passed.
- Reviewed every tap-map access for the shared lock and retained incoming Bluetooth/resource behavior.
- No Gradle process was started by this task, as requested. The coordinator must run `TeslaBrowserLinkTest` and the complete Android checks; runtime pass/fail results remain pending here. No performance improvement is claimed without measurement.
- No commit/push/deploy performed by this owner.

## Final integrated coordinator checks

The final source commit 91430639 passed the complete Android task set: 1352 shared + 1067 common + 4 home = 2423 tests, zero failures/errors/skips, and all three lint/debug-build tasks. Final Node suite 113/113; fake-phone, compiled-phone and real Video.js MP4 Chromium E2Es all passed. Changed fixture constructors/root serving/synthetic schedule/restart-counter and current audio privacy contract are documented in D2/TIE-UP reports without production changes or relaxed thresholds. Source committed, merged and normally pushed; Pages deployment succeeded. See TIE-UP.md for delivery and remaining new static findings.
