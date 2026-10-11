# Archive documentation result — 2026-10-11

Status: completed. Scope: the 45 archive entries in `groups.json`; historical release/audit/review/validation names, recorded identities, credits and raw evidence were preserved.

## Corrections

- Dated the initial cleanup reports and linked the later queue/lifecycle follow-up and tie-up. Their earlier E2E failure, unimplemented decisions and no-commit statements now have an explicit historical boundary.
- Changed the initial sweep README/environment E2E assertions to past tense, and tied the browser-source unchanged claim to its initial checkpoint. Kept the initial failures alongside final passing evidence.
- Clarified that the settings installation and system-proxy E2E documents are 2026-10-10 snapshots. Linked the later build/E2E and delivery records without rewriting the earlier eight crypto-test failures or claiming subsequent vehicle acceptance.
- Qualified the follow-up/TASKS no-commit notes as pre-delivery checkpoints and linked the recorded delivery outcome.

## Verification

- Checked all archive Markdown relative links and anchors: 41 references, zero unresolved targets.
- Compared every assigned raw `.txt` artifact with `HEAD`: all 14 remain byte-identical.
- Checked retained final logs: Android `BUILD SUCCESSFUL` in 9m 21s initially and 7m 40s for the follow-up; both final E2E logs record `all checks passed`. Earlier failure logs remain unchanged.
- Scoped `git diff --check` passed. No application/configuration changes, commits or pushes. Mandatory current Android/browser checks belong to the coordinator; historical passing logs are not presented as a new execution.

## Unverified history and policy conflicts

- The tie-up record explicitly leaves remote Android run `38099177144` running at its recorded checkpoint. Its later status was not queried or inferred; remote success remains unverified in this sweep.
- Recorded deployment/settings evidence uses `https://ujzk.github.io/TiPlay/` and `uJZk/TiPlay` workflow links, while AGENTS.md prescribes `uJZk/DiPlay` for current project destinations. Preserved the actual historical deployment references and flagged the policy conflict rather than rewriting evidence.
- Historical upstream release/download/reporting destinations in the 0.2.x notes identify upstream DiPlay releases and reports. They were retained with the release names, numbered contributions and provenance; they do not establish current TiPlay download or support destinations.
- Older upstream release APK hashes, certificates, external CI results, physical-device observations and locally retained diagnostic workspaces could not be independently revalidated from this checkout. Kept them as dated recorded claims, without extending them to current builds or supported hardware.
