# Documentation checklist

Sources: [AGENTS.md](../../AGENTS.md) and [UPSTREAM_SYNC.md](../UPSTREAM_SYNC.md). No separate prose-style standard was found; use these explicit project rules without inventing one.

- [x] User request: README.md contains only user-needed information (purpose, installation, connection/use, limitations and help); keep essential credits and align the Chinese README. Remove developer implementation/build/delivery detail from the entry page.
- [x] Current user-facing product names use TiPlay; preserve DiPlay in historical release/changelog/audit/validation records, upstream copies and credits.
- [x] Follow explicit AGENTS.md project issue/release/download/site destination `https://github.com/uJZk/DiPlay`; preserve upstream numbered references on `shihabal3amri/DiPlay`. Flag conflicting TiPlay repository/Pages destinations rather than choosing new policy.
- [x] Current guides cover Android phone + car browser only; retained native head-unit material is upstream compatibility, not a supported second product or new acceptance requirement.
- [x] Preserve internal packages/classes/resources/preferences/actions/environment identifiers, legal notices and one-way upstream sync with small hooks.
- [x] Verify current settings names, reachable main/advanced controls, native Android presentation, translated labels, experimental suffixes and consent for draft/apply/reconnect against code.
- [x] Verify connection, browser media/debug/resize, permissions, endpoint and boot claims against current code and tests; preserve uncertain platform/device qualifications.
- [x] Date historical results and identify superseded behavior without rewriting raw evidence or turning past runs into current guarantees.
- [x] Check local file/heading links and references; reconcile duplicated/outdated instructions and English/Chinese guide consistency without cosmetic rewriting.
- [x] Edit only task-owned documents listed in SCOPE.md; preserve meaning, generated/legal/upstream originals and raw logs. Flag unverifiable claims. No code/configuration changes, commits or pushes.

Coordinator runs AGENTS.md Android CI command, Node browser tests, public-tree and scoped link/whitespace checks. Each task records item-by-item review in its RESULT file; shared checklist marks are completed by coordinator.

All checklist items were reviewed. A checked item records review completion; it does not certify external claims or resolve the source-policy conflicts recorded in README.md and task results.
