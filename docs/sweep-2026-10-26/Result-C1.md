# C1 Android UI, resources and tests

Reviewed against [STANDARDS.md](STANDARDS.md), repository `AGENTS.md` and
`docs/Upstream.md`, using `91430639..5c47dd00` to distinguish new/changed code.

## Coverage

- All 469 assigned paths in `Scope-C1-1.md` and `Scope-C1-2.md` were inventoried:
  143 production/debug/sample Kotlin files, 174 Kotlin test files, 148 XML files,
  two Gradle files and two HTML assets. The range adds 277 files and modifies 192
  inherited paths.
- All Kotlin files received an import/reference and single-reference private
  declaration scan. Candidates were checked against current repository references,
  reflective test references and baseline diffs before editing. Delegated-property
  operator imports were retained.
- Focused source review covered the fork-owned host palette/Bluetooth hunks,
  browser Video in Car generation/resource/loan lifecycle, settings watches and
  main/advanced settings, foreground-service degradation, Bluetooth status,
  bounded diagnostic writing/dialog policy, device trust, artwork ownership and
  settings-backup request handling. Build/manifest deltas and the affected tests
  were read. This was proportional static coverage, not a line-by-line audit of
  all 71,054 scoped lines or a physical-device review.
- All scoped XML was parsed and checked for duplicate named entries within each
  file. Both HTML assets' inline scripts were syntax checked. Existing native
  compatibility files, resource identifiers, locale copy and test assertions remain.

## Changes

- Removed the unused `Bitmap` import in `CarPlayBlackCornerOverlay`.
- Removed the unreferenced fork-owned `MENU_BUTTON_TEXT` getter and
  `logCarBluetoothAudio` helper from `CarPlayHostActivity`. A repository-wide search
  found no direct or reflective caller. The removed helper's delayed Bluetooth
  probes were unreachable; active Bluetooth status and capture code were untouched.
- Removed unused `R`, `ByteArrayOutputStream` and `File` imports from
  `BrowserDiagnosticResultUiTest`, `SettingsBackupServerTest` and
  `UpdateChecksumsTest`, respectively. No assertions or test cases were removed.

Five code files changed, with 30 lines removed. Each deletion belongs to an
addition/modified hunk in the review range. No dependency, behavior or public API
changes were made.

## Verification

- Scoped `git diff --check`: passed.
- XML parse and duplicate-name check: all 148 files passed, no duplicate named
  entries within a file.
- `node --check` on extracted inline scripts: both HTML assets passed.
- Scoped conflict-marker scan: none found.
- No Gradle command was started by C1; the coordinator owns the required Android
  test/lint/assembly command and records its result. These static checks do not
  establish Android compilation or device acceptance.
- One tool invocation failed with an exec-server transport disconnect; the next
  invocation succeeded and subsequent checks completed. No failed invocation is
  counted as successful verification.

## Open decisions

No confirmed behavior-changing finding was established by this cleanup. Existing
unused imports/private helpers outside changed hunks were left intact under the
upstream-compatibility constraint; they do not justify widening this task.

## Integration review

Independently spot-checked the final C1–C4 non-Markdown diffs after the browser
and tooling workers confirmed their code snapshots were stable. All 19 changed
non-Markdown files belong to the assigned scope inventories, including the
coordinator's intentional `v97` to `v98` page/cache identifiers. No untracked
non-Markdown file was present.

- Android changes are unused imports and the two unreferenced C1 private members.
  No executable caller or regression assertion was removed.
- Browser/tooling removals are unused imports/local helpers; removed whole-module
  test imports were checked for initialization side effects. The same-module
  libav import merge preserves module evaluation and imported bindings.
- Independently compared the before/after `SUMMARY_KEYS` arrays: all 140 unique
  keys retain their exact first-occurrence order, so existing `Set` deduplication
  yields the same diagnostic field priorities and budget behavior.
- Remaining changes are comments and the coordinator-owned matching page/cache
  version increment. Scoped code `git diff --check` passed. No full test suite was
  rerun for this spot-check.

No concrete integration risk or accidental behavior/scope change was found in
the reviewed snapshot. This conclusion covers static equivalence of these diffs;
the coordinator records full runtime/build verification separately.
