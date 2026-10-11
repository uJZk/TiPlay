# Documentation checklist

Sources: [AGENTS.md](../../AGENTS.md), especially Naming and Upstream; [UPSTREAM_SYNC.md](../UPSTREAM_SYNC.md). No separate prose style standard exists in the project or available user configuration. Do not invent one.

- [x] User-facing current product names use TiPlay. Preserve DiPlay in historical changelog/release notes, audits/reviews/validation records, upstream README copies and credits.
- [x] Current project issue/release/download/site links follow the explicit AGENTS.md target `https://github.com/uJZk/DiPlay`. Preserve numbered upstream issue/PR/commit references and credits on `shihabal3amri/DiPlay`. If current configuration conflicts with this requirement, flag it instead of silently choosing a new policy.
- [x] Preserve internal package/class/resource/preference/action/environment identifiers and legal notices.
- [x] Preserve one-way upstream sync and small-hook rules; send no upstream patches.
- [x] Settings instructions retain category ownership, translations, experimental suffixes, reconnect consent and next-connection behavior where applicable.
- [x] Verify technical claims against repository code/configuration or recorded evidence. Date historical results; do not turn old results into current guarantees. Flag unverifiable claims.
- [x] Check relative file links and heading references, duplicate/outdated instructions, and consistency between translations and overlapping guides. Preserve meaning; avoid cosmetic rewrites.
- [x] Keep license/vendor originals and generated outputs unchanged. Raw validation/history logs are evidence, not prose to rewrite.
- [x] Edit only assigned scope. No application/configuration changes, commits or pushes.

AGENTS.md also requires the full Android CI command and browser Node tests before reporting completion; the coordinator handles these checks.

All items reviewed. Checked marks record completion of review, not certification of external claims. Preserved exceptions and unresolved policy conflicts are in README.md and per-task result files.
