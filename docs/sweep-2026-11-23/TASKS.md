# Tasks

All tasks follow STANDARDS.md rules 1–11, preserve behavior, and only edit existing in-scope files. Agents record results in individual task files for safe concurrent updates.

- [x] shared media: done; model inherited (Opus-equivalent judgment): concurrency and audio lifecycle. Formatting and import order only; full verification passed. [Result](media-result.md).
- [x] shared other: done; model inherited (Opus-equivalent judgment): receiver, protocol and ownership. Removed unused helper and relocated KDoc; checks covered changed hunks and sampled test assertions, with depth limits documented. [Initial review](shared-result.md); follow-ups: [AirPlay](shared-airplay-result.md), [receiver](shared-receiver-result.md), [transport](shared-rest-result.md). Full verification passed.
- [x] common and mobile: done; model inherited (Opus-equivalent judgment): service lifecycle and Android contracts. Hoisted diagnostic sets; full verification passed. [Result](common-result.md).
- [x] site: done; model inherited (Opus-equivalent judgment): browser media contracts. No cleanup justified; focused tests passed. [Result](site-result.md).
- [x] tests: done; model inherited (Sonnet-equivalent scope): test-only cleanup. Removed unused imports; focused tests passed. [Result](tests-result.md).
- [x] scripts, workflows and root configuration: done; model inherited (Opus-equivalent judgment): build and security boundaries. No cleanup justified; Python checks passed. [Result](scripts-result.md).

## Follow-up verification

- [x] Repair diagnostic export test fixture: captured an active server-scoped callback and preserved control/export assertions. Five focused tests and the full Android command passed.
- [x] Full Android tests, lint and Debug builds passed; browser suite and public-tree check passed. See [README](README.md).
