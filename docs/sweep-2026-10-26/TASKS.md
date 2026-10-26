# Code sweep tasks

Models: Sonnet/Opus are not available. GPT-6.1 Sol is used for mechanical cleanup and current-code comparisons; ambiguous behavior is recorded for a decision.

| Task | Target | Model / reason | Status | Result |
| --- | --- | --- | --- | --- |
| C1 | 469 files in Scope-C1-*.md | GPT-6.1 Sol high; bounded, standard-driven review | done | [Result-C1.md](Result-C1.md); 5 code files, 30 lines removed; static checks pass; Android checks owned by coordinator |
| C2 | 446 files in Scope-C2-*.md | GPT-6.1 Sol high; bounded, standard-driven review | done | [Result-C2](Result-C2.md): four unused imports removed; lightweight checks passed; coordinator runs full checks |
| C3 | 178 files in Scope-C3-*.md | GPT-6.1 Sol high; bounded, standard-driven review | done | [Result-C3](Result-C3.md): seven mechanical code/test cleanups; nine targeted suite files pass; retained obsolete video e2e assumptions for decision |
| C4 | 148 files in Scope-C4-*.md | GPT-6.1 Sol high; bounded, standard-driven review | done | [Result-C4.md](Result-C4.md) |
