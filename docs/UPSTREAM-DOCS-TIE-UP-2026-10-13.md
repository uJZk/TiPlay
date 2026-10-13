# Upstream documentation handoff — 2026-10-13

## Changes and decisions

- Consolidated upstream maintenance into [Upstream.md](Upstream.md), reduced from
  3,121 to 702 whitespace-delimited words. Track DiPlay, Video.js 8.24.1 and UxPlay
  commit `ec203121355220dd90278a369eeabb0b8ba4f14a`; component versions were not upgraded.
- Preserve one-way DiPlay merges, small hooks, stable identifiers, licenses and the
  phone + browser product boundary. Original upstream README archives remain unchanged.
- Deleted `APP-MAIN-PAGE-DESIGN.md` at the user's request. Updated active navigation;
  historical mentions retain their context without linking to the deleted file.
- Root AGENTS.md requires at most 8,192 words per AGENTS/child docs file, with a
  4,096-word target for split children. It indexes all new documents.
- Split [the October 13 scope](sweep-2026-10-13/SCOPE.md) into three parts of
  4,015, 4,003 and 1,238 words; all 342 entries retain their content and order; split-file final newlines are normalized.

## Verification and delivery boundary

Document lengths, changed-document links, removed-document reference checks,
scope-entry integrity, archived README integrity, `git diff --check` and the public-tree
check passed. Browser tests passed earlier in this session: 113 tests.

The required Android check was attempted earlier; Java 25 toolchain download from
`api.foojay.io` returned HTTP 403. No Android validation result is claimed. This
handoff changes documentation only and needs no build output or Pages deployment.
Integration target: `origin/main`; the temporary `work` branch is removed after integration.

## Next steps

Review upstream changes against the documented baselines when updating a component.
Update provenance, licenses and relevant validation together. Resolve Java 25 download
access before the next change requiring local Android checks.
