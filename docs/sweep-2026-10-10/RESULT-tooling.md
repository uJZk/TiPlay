# Tooling sweep result

Reviewed the tooling section of SCOPE.md against standards 1–9. Inherited files were reviewed only for fork changes relative to e837efa; original upstream implementation and generated locale HTML were excluded. No shared TASKS.md edits, commits or pushes.

## Changes

- `tests/web-e2e/RealPhone.java`: removed the duplicate `i + 3 <= stream.length` check inside the Annex-B parser loop. The enclosing loop has the identical condition and neither index nor array length changes before the expression, so byte reads, short-circuit behavior and parsing results are preserved.
- Reviewed site assembler/generator, E2E runners/fake phone, shell-address Java utility, CI/build configuration and fork naming hunks. No other mechanical changes were justified.

## Performance review

The parser change removes a redundant condition without claiming a measured speed gain. Clip parsing/encoding and site assembly run during setup, so additional buffer rewrites or filesystem caching would be speculative. The fake phone retains its interval cleanup on stream replacement/close; the real harness retains feeder shutdown and server stop. No thread, timeout, protocol or queue policy changes were made.

## Validation

- Passed `node --check` for `run.mjs`, `phone-run.mjs` and `fake-phone.mjs`.
- Passed Python AST parsing for `scripts/assemble_site.py` and `scripts/build_site.py` without generating or modifying HTML.
- Passed `git diff --check -- tests/web-e2e/RealPhone.java`.
- Attempted fake-phone E2E with existing Playwright at `/opt/codex/cua_node/lib/node_modules` and Chromium `/usr/bin/chromium`. Its ffmpeg check decoded all 30 H.264 frames; the sandbox then rejected the loopback listener with `listen EPERM`. A retry with additional network permissions was aborted before a result, so full E2E is not verified.
- Java cleanup is validated by static control-flow reasoning; no javac is available in the installed JRE and the harness Kotlin runtime was not located. No new tool installation was attempted.
- Coordinator reports all 50 browser unit tests passing. Mandatory Android tests/lint/build are blocked by JDK 25 provisioning from api.foojay.io returning HTTP 403.

## Open decisions

- E2E startup acquires resources before its main `try/finally`: a failed encoder/phone/browser startup can leave a server, child process or temporary directory until process exit. Extending cleanup requires a separate lifecycle/error-handling change.
- Test harness event/request/log collections retain all entries, and fake video writes do not honor socket backpressure. These are bounded by normal test duration, but a stalled or prolonged harness can grow memory; capping histories or changing streaming pacing requires decisions about assertions and queue policy.
- The real harness serializes diagnostic output synchronously on callback threads. Changing logging scheduling or buffering would change timing/order and is outside this mechanical sweep.

## Coordinator verification follow-up

The earlier local infrastructure blockers above are historical. JDK/SDK setup is now fixed, and the full required Android test/lint/build command passed (2,177 tests, zero failures/errors/skips). Full browser unit suite passed 50/50; RealPhone.java compilation passed. Optional fake-phone E2E still fails the stats-event assertion, recorded separately in README.md. See README.md and ENVIRONMENT.md for final results and repeatable setup.
