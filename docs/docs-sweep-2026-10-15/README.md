# Documentation sweep

- Date: 2026-10-15
- Status: complete; documentation edits and checks finished, Android validation blocked by environment.
- base-commit: `4d03261f9dc915d0acb2cd6f69f7028640da6f04` (reviewed source baseline before cleanup).
- Scope: all documentation, explicitly requested by the user; [scope/history](SCOPE.md).
- Standard: user instructions and project rules, distilled in [Checklist](CHECKLIST.md).
- Work: [Tasks and model assignments](TASKS.md).

Removed 267 obsolete files and replaced 86 loose topic documents with 14 stable guides
and a short index. Rewrote the English and Simplified Chinese READMEs and AGENTS/CHANGELOG; removed
the Traditional Chinese README as requested. Kept license texts and source/asset attribution. Only this sweep remains. Historical evidence stays in Git.
The docs tree shrank from 286 to 24 files (including legal texts and this sweep),
reducing content bytes by about 95%. Website and issue forms now use current TiPlay setup/reporting copy.

## Verification

- Browser tests: 231 passed (Node 24 available; CI specifies Node 22). The sandbox's initial
  subprocess EPERM failure was resolved by rerunning with approved sandbox escalation.
- Release-draft tests: 9 passed.
- Static-site generation and assembly passed.
- Local links/anchors, current website/issue-template targets, capitalization, date-free
  topic names, word limits, single-sweep retention, public-tree and whitespace checks passed.
- Android required command was attempted. The default Gradle cache was unwritable; after
  selecting a workspace cache, wrapper download failed with `SocketException: Operation
  not permitted`. No Gradle distribution is cached; installed Java is 21 versus CI's 25.
  Android tests/lint/builds did not run. No APK or physical-device compatibility is claimed.

Real iPhone/car acceptance remains in [Todo](../Todo.md).

## Delivery

The user invoked tie-up after retaining only English and Simplified Chinese READMEs.
Latest quick checks: 157 links/anchors, public-tree scan, whitespace, site generation
and assembly passed. Earlier 231 browser and 9 release-draft tests remain applicable;
subsequent README/link-only edits required no runtime rebuild. Android validation
remains limited as described above. No APK build or release is needed for this cleanup.

Remote main matched the reviewed source baseline when fetched. Commit, fast-forward
integration into main and push are authorized; the existing Publish site workflow
will deploy the changed website. Final delivery identifiers will be recorded here.
Session scratch files are removed before commit; AGENTS links to this record.

