# Original sweep coordinator verification


This evidence describes the original reviewed `5449de24` before tie-up fetched newer main. Final integration validation and delivery are recorded in [TIE-UP.md](TIE-UP.md).

- Scope: 35 assigned source documents; 34 changed, AGENTS.md reviewed unchanged. Only documentation and new sweep records edited. HEAD remains `5449de24d399f9e4e1ce1124e7066d906df98813`; no commits or pushes.
- Spot-checks: user-only README scope and English/Chinese flow; Android vs browser Connect actions; 60 fps default and saved settings; advanced explicit apply/reconnect; current None/无 labels, endpoint restrictions and shared-address persistence; boot intent; single active pairing/session; WebCodecs-only rendering; Debug and historical/current boundaries.
- Scoped local Markdown file/heading links pass; see LINK-CHECK.json. Inline Markdown references and fenced examples are distinguished; remote destinations were not tested.
- Tracked documentation diff whitespace passes. Generated site files, code/configuration, legal/vendor/upstream originals and prior raw/sweep evidence unchanged.
- Public-tree check passed. This check scans tracked source; new sweep records were additionally inspected for prohibited distribution files/private-key blocks before completion.
- Browser tests: 63 passed, zero failures/skips with Node 22. Restricted-sandbox first run blocked the site Python subprocess; rerun with approved subprocess capability passed without source changes.
- Android: full required CI command passed, BUILD SUCCESSFUL in 5m 57s. Reports: shared 1225, common 1035, Home 4; total 2264, zero failures/errors/skips. Unit tasks executed for shared/common; Home reused its up-to-date reports. Required Lint and mobile/Home/maphost debug assemblies passed. Initial restricted run could not determine usable wildcard IP because local sockets were blocked; approved rerun passed with existing toolchains. Full success and initial failure logs retained.
- No physical phone/car checks, E2E runs, downloads, remote Release/Pages verification or deployment were performed. Past device and delivery reports remain attributed historical evidence.
