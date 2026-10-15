# Scope

The user explicitly requested a whole-repository documentation reduction, overriding
the skill's usual incremental boundary. Reviewed source HEAD: `4d03261f9dc915d0acb2cd6f69f7028640da6f04`.
Previous completed docs sweep baseline: `1db90a7c3bc4cf7faf07bf9718a40ba54c61d345` (reachable).

## History and code mapping

The inventory contained 296 tracked Markdown/text documents outside build caches.
Three Luna groups reviewed substantive documentation; repetitive raw validation logs
and generated inventories were classified from summaries rather than audited line by line.
Sol workers checked current behavior against code before replacing product claims.

History was collected with `git log --name-status 1db90a7c3bc4cf7faf07bf9718a40ba54c61d345..4d03261f9dc915d0acb2cd6f69f7028640da6f04`
and `git diff --stat 1db90a7c3bc4cf7faf07bf9718a40ba54c61d345..4d03261f9dc915d0acb2cd6f69f7028640da6f04`. There are 134 documentation-touching
commits in that range, including imported upstream history. To reproduce the exact
file/commit list without retaining another transcript:

```sh
git log --name-status 1db90a7c3bc4cf7faf07bf9718a40ba54c61d345..4d03261f9dc915d0acb2cd6f69f7028640da6f04 -- '*.md' '*.txt'
git diff --stat 1db90a7c3bc4cf7faf07bf9718a40ba54c61d345..4d03261f9dc915d0acb2cd6f69f7028640da6f04
git ls-tree -r --name-only 4d03261f9dc915d0acb2cd6f69f7028640da6f04 -- docs
```

- `d40d09be`: upstream merge → Build, Upstream, Testing and supported product scope.
- `d7d494cc`, `d1e605a8`: controls/media-engine updates → AirPlay, Browser, notices and vendor READMEs.
- `dd94db4e`: monitor/process logging → Diagnostics and Privacy.
- `090c529c`, `86fe366a`, `876de51f`, `4d03261f`: screen borrowing, audio, photos, subtitles, approval and CSP → AirPlay, Browser, Privacy and Todo.
- Settings, retries, USB/wireless, hotspot and export code were also rechecked despite unchanged guide filenames.

## Stable document mapping

Last-touch commits below identify the original guide inputs; current truth was checked
against source HEAD, including later code changes. Installation, the English and Simplified Chinese root READMEs,
AGENTS and CHANGELOG were rewritten; the documentation index is new.

| Original guide | Current guide | Last input commit |
| --- | --- | --- |
| `AIRPLAY.md` | [AirPlay](../AirPlay.md) | `876de51f` |
| `TESLA_BROWSER.md` | [Browser](../Browser.md) | `86fe366a` |
| `BUILD.md` | [Build](../Build.md) | `a2df771b` |
| `CONNECTION_SETUP.md` | [Connection-setup](../Connection-setup.md) | `ddad78ba` |
| `DIAGNOSTICS.md` | [Diagnostics](../Diagnostics.md) | `dd94db4e` |
| `HOTSPOT_ADDRESS.md` | [Hotspot-address](../Hotspot-address.md) | `a2df771b` |
| `INSTALL.md` | [Install](../Install.md) | `a2df771b` |
| `PRIVACY.md` | [Privacy](../Privacy.md) | `a2df771b` |
| `APP-MAIN-PAGE-IMPLEMENTATION.md` | [Settings](../Settings.md) | `dd94db4e` |
| `TESTING.md` | [Testing](../Testing.md) | `a2df771b` |
| `THIRD_PARTY_NOTICES.md` | [Third-party-notices](../Third-party-notices.md) | `86fe366a` |
| `todo.md` | [Todo](../Todo.md) | `86fe366a` |
| `Upstream.md` | [Upstream](../Upstream.md) | `d1e605a8` |
| `WLSC.md` | [Wlsc](../Wlsc.md) | `d1e605a8` |

## Removed material

267 files were removed: all older `docs/sweep-*` and `docs/docs-sweep-*` folders;
dated implementation/release/validation/tie-up records; copied DiPlay release notes
and READMEs; native head-unit/BYD feature guides; duplicate child translations and
connection/media guides. Durable setup, contracts and pending acceptance were merged
into the stable topics above. Git retains the original files and their attribution.

No license texts, vendored source or asset notices were deleted. Native source references
to removed interface guides use immutable pre-cleanup GitHub links. Current website,
tool, issue-template and guide references use the renamed documents.
