# Runtime review results

The current optimized candidate passes real Chromium 151 AudioWorklet execution without JavaScript dynamic compilation or WebAssembly. It retains the existing audio-processing API, has a fixed 16 MiB heap, and produces all 25,600 requested frames across 200 render quanta, with nonzero output, no non-finite samples, no native error and no CSP violation. `Optimized-strict-csp.json` uses the final `script-src 'self'` production policy, with no `wasm-unsafe-eval` permission. The smoke test disables the worklet's global WebAssembly before importing the candidate.

This is a loading and output smoke test. It does not certify glitch-free real-time playback, video performance, or old car-browser compatibility.

## Measured scope

`Benchmark.mjs` pins the pre-change production wrapper in `Pinned-streaming-resampler.mjs` and the original WASM in `Existing.wasm`. This prevents concurrent application edits from changing the comparison. All engines use that same wrapper, float32 buffers, HQ variable-rate processing, 128-frame quanta, output-frame ratio slew, and drain-before-feed. The benchmark forbids string code generation; JS runs additionally disable WebAssembly.

`*-full.json` each cover 28 input/output/channel combinations, 4,000 measured blocks per case and 500 warmup blocks. All cases produce full blocks; each process also completes 1,000 stream create/delete cycles with no heap growth. First-output time, stream construction, impulse filter-delay calibration, block elapsed percentiles and process CPU are reported separately. The JS allocator's live bytes/high-water are not exported, so no exact allocator leak or high-water claim is made.

`Repeated-summary.json` and `*-repeat-N.json` cover five fresh-process repetitions with rotating engine order, 4,000 measured blocks per case and 500 warmup blocks. They compare three common formats plus simultaneous media/navigation streams. Each table value below is the median of the five run means; it is measured elapsed time in milliseconds for a 128-frame block, including wrapper copies and ratio updates.

| Input -> 48 kHz output | Original WASM | Unpruned JS | Optimized JS | Optimized vs unpruned |
| --- | ---: | ---: | ---: | ---: |
| 8 kHz mono | 0.0140 | 0.1679 | 0.1459 | 13.1% lower |
| 44.1 kHz stereo | 0.0683 | 0.2892 | 0.2919 | 0.9% higher |
| 48 kHz stereo | 0.0395 | 0.2859 | 0.2506 | 12.4% lower |
| 48 kHz stereo + 16 kHz mono | 0.0560 | 0.3235 | 0.3255 | 0.6% higher |

For the simultaneous-stream case, median P99 improves from 1.722 ms to 1.301 ms. Measured process CPU for the optimized candidate improves over unpruned JS in each single-stream core case: 72.81 -> 45.06, 108.84 -> 104.14, and 106.99 -> 100.15 CPU milliseconds per audio second respectively. Original WASM remains substantially faster at 5.06, 24.41, and 14.21 CPU milliseconds per audio second.

The candidate is 250,835 bytes versus the unpruned JS factory's 510,242 bytes, a 50.8% reduction. It is a static, self-contained module. One full-run end RSS was approximately 71.1 MB versus unpruned JS 93.1 MB, but RSS includes runtime/JIT and is not library allocator usage. All retain the same configured 16 MiB processing heap.

## Interpretation and limits

The optimized candidate offers a materially smaller pure-JS artifact and some measured gains over unpruned JS. The common stereo cases do not show a uniform improvement. It is not a CPU improvement over WASM. If pure JS is the user's explicit runtime requirement, make that tradeoff clear.

The host has severe scheduling/GC/JIT tails: even the original WASM records an isolated 110.7 ms block in the repeated runs. Per-block elapsed time and deadline exceedance are therefore retained as raw observations, not presented as pure-DSP worst-case execution time or proof of an AudioWorklet underrun. A 128-frame/48 kHz worklet has a 2.667 ms budget for ALL mixing, queues and DSP; this benchmark excludes timeline/mixing and cannot certify that total budget.

The generated module is Binaryen wasm2js output: typed JavaScript / asm.js-like, not validated legacy asm.js. No runtime WASM binary or WASM execution is involved. Do not change this classification by adding an unsupported `use asm` directive.

Independent DSP correctness and continuity measurements are owned by the DSP reviewer and should accompany these results. Target car browsers and physical audio/video playback remain required before making end-device performance claims.

## Reproduce

- `node --disallow-code-generation-from-strings Benchmark.mjs wasm 4000 500`
- `node --disallow-code-generation-from-strings Benchmark.mjs /absolute/factory.mjs 4000 500`
- `SOXR_BENCH_MATRIX=core node --disallow-code-generation-from-strings Benchmark.mjs /absolute/factory.mjs 4000 500`
- `node Repeated.mjs`
- `node Csp-worklet.mjs /absolute/factory.mjs` (requires Playwright, Chromium and local HTTP listening). `SOXR_PROJECT_ROOT`, `SOXR_PLAYWRIGHT_MODULE`, and `SOXR_CHROMIUM` can select local paths.

The complete test scripts and raw JSON files are in this directory. No production files were modified by the runtime reviewer.
