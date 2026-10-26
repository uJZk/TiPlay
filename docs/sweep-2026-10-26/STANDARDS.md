# Code standards

Reused from `a1748b81:docs/sweep-2026-10-13/STANDARDS.md` rules 1–11, updated only where current AGENTS.md contracts supersede historical behavior. Historical session-specific repair/retirement authorizations do not apply.

1. Edit only assigned current files in SCOPE.md, and fork-owned additions/modified hunks in inherited files. Preserve upstream names, files, formatting, notices, preference keys and compatibility. No features or behavior changes.
2. Kotlin: neighboring four-space formatting and naming; remove proven unused imports, locals and private helpers. No broad inherited refactors.
3. Preserve synchronization, callback order, thread affinity, cancellation, timeouts, fallback, queue bounds and resource ownership. Ambiguous lifecycle/security/performance findings go to Open decisions.
4. Preserve error/fallback and diagnostic/privacy contracts, including explicitly opted-in unredacted captures. Never expose credentials; add no dependencies.
5. JS/Python/Java/C: preserve module style, public exports, protocol and stored keys. Remove proven dead code, exact duplication and stale comments only when behavior is unchanged. Avoid formatting churn and speculative micro-optimization.
6. Android: retain phone/browser defaults, reconnect/consent/settings category/translation contracts. TiPlay is the visible product name; preserve upstream internal names and credits. Do not add native head-unit navigation or acceptance tests.
7. Keep meaningful existing regression assertions. Add no tests that merely mirror mechanical changes. Run relevant existing checks; coordinator runs full AGENTS Android command, browser suite and public-tree checks. Report infrastructure limits accurately.
8. No hand edits to generated locale HTML, packaged binaries, vendor/native dependency sources or build output. JNI fork-owned wrappers/build hooks only; preserve validation and native interfaces.
9. Inspect media hot paths proportionately for repeated work, allocations, blocking, unbounded state and resource leaks. Change only proven equivalent work, with relevant checks; do not claim measured improvement without measurements.
10. Retain regression tests for completed active features. Remove TiPlay-owned dead code/tests only with proven unreachable or retired-contract evidence; behavior-changing retirements require a decision.
11. Current transport: original-codec WebRTC video/negotiated audio, AVPlayer URL engine with Canvas/local pinned resources, fixed 48 kHz browser live audio. AGENTS.md and stable topic docs define current boundaries.
