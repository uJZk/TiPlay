# C4 build tooling, benchmarks and native/Python checks

Reviewed against [STANDARDS.md](STANDARDS.md), `AGENTS.md` and
`docs/Upstream.md`, using baseline `91430639..5c47dd00` and the 148 assigned
paths in [Scope-C4-1.md](Scope-C4-1.md).

## Coverage

- Reviewed fork-owned script, build/CI and issue-template changes against the
  baseline, including pinned download/build verification, native artifact checks,
  site generation, capture preparation and audio/CPU evidence handling.
- Read the benchmark drivers/adapters and assigned native/Python tests. Checked
  Python import references and parsed all assigned Python/JavaScript sources.
  Historical DSP probes retain their prepared-reference requirements; no
  historical measurement was rerun or rewritten.
- Parsed all 82 assigned JSON files, including lockfiles, fixture inputs and
  historical benchmark evidence. Generated evidence, binaries and vendor sources
  were left intact. Parsed the GitHub YAML templates/workflows as syntax checks.
- Review of the audio benchmark loops and capture preparation found no proven
  equivalent hot-path change beyond the import cleanup. This was proportional
  static review, not a vehicle-performance or acoustic-timing assessment.

## Changes

- Removed the unused `createHash` import from `tests/bench/soxr/Csp-worklet.mjs`.
- Combined two imports from the identical libav module in
  `tests/bench/libav/eld-adapter.mjs`; imported bindings and order are preserved.
- Corrected the stale `docs/HOTSPOT_ADDRESS.md` comment reference in
  `shared/build.gradle` to the existing `docs/Hotspot-address.md`.

No runtime behavior, test assertions, dependencies, toolchain pins, build tasks,
protocols, public exports or generated files changed.

## Verification

- `python3 -m unittest discover -s tests -p 'test_*.py'`: all 33 tests pass.
- Assigned-source syntax checks: 24 Python ASTs, 23 JavaScript modules and 82 JSON
  files parse; all GitHub YAML files parse. `git diff --check` passes.
- `python3 scripts/soxr/prepare-native.py --check`: native source archive, patch
  and configuration match the checked-in native sources.
- `python3 scripts/rtc-audio/build.py --verify`: all four ABI artifacts pass hash,
  ELF alignment and packaged notice/provenance checks.
- `node scripts/avplayer/check.mjs`: all 45 AVPlayer artifacts pass source/build
  checksum verification.
- `node --test --test-isolation=none --test-reporter=tap tests/bench/srp/math.test.mjs`:
  all seven SRP arithmetic/lifecycle/vector tests pass on Node 24.19.0. The normal
  isolated invocation also exits successfully but reports only the test file;
  the explicit in-process invocation confirms each named regression executes.
- With the coordinator-provisioned JDK 25, `scripts/test_airplay_native.py` passes
  host JNI boundary checks. `RawCaptureEncoding.java` and `AddAddr.java` compile
  into a temporary directory.
- No Gradle command was started by C4. The coordinator owns Android checks and
  fresh Android class generation. Native Soxr/Kotlin runtime verification and
  the encoded-audio peer probe were not run against stale preexisting classes.
  No benchmark performance claim, device acceptance or physical timing follows
  from these checks.

## Open decisions

The following original finding was subsequently fixed at the user's request; see [follow-up repairs](Delivery.md#follow-up-repairs).

`.github/ISSUE_TEMPLATE/feature_request.yml` still sends new connection/bug
reports to the upstream DiPlay repository and asks for DiPlay/native head-unit
details. These are live user-facing destinations and copy, not historical
numbered issue references. Updating them changes report routing and the inherited
template, so this behavior-preserving sweep leaves them for a separate decision.
