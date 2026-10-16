# Final independent runtime review

The final selected pure-JavaScript artifact is `candidate-a.mjs` / delivered `soxr.asm.js`, SHA-256 `0dda221ebb9979a01840c475caed3d9aee84c436f4a1e91483a868ca5df85777`, 364,339 bytes. It uses libsoxr's original HQ variable-rate DSP, float32-only I/O pruning, clang O3/LTO and Binaryen optimization before translation, but omits the final wasm2js O3 pass after measured variant comparison. It is wasm2js-generated typed JavaScript / asm.js-like code, not validated legacy asm.js. It has no runtime WASM dependency.

## Verified behavior

- Real Chromium 151 AudioWorklet runs with the final production `script-src 'self'` policy, no JavaScript `unsafe-eval` and no `wasm-unsafe-eval`. The test additionally removes global WebAssembly before importing the candidate.
- All 200 requested 128-frame quanta produce output: 25,600 frames, nonzero energy, zero non-finite samples, zero native API errors, zero browser errors and zero CSP violations. Evidence: `Final-strict-csp.json`, bound to the artifact SHA above.
- Final full benchmark covers 28 input/output/channel configurations, each 4,000 measured blocks after 500 warmup blocks, using the pre-change production wrapper pinned in `Pinned-streaming-resampler.mjs`. All cases produce full blocks. It also processes simultaneous stereo media / mono navigation and completes 1,000 create/delete cycles.
- Processing memory remains 16,777,216 bytes throughout the final full run. Exact allocator live bytes and high-water are not exported; fixed heap size and successful lifecycle reuse do not prove exact allocation/leak accounting.
- All JS benchmarking forbids string code generation and disables WebAssembly. Original WASM and unpruned JS use the same pinned wrapper, buffer sizes, quality contract, variable-rate schedule and drain-before-feed policy.

The real worklet test proves loading and output. It does not certify glitch-free target-device playback, whole-worklet timing, or video performance. Independent final DSP quality, packet continuity, filter-delay and 120-second drift checks are supplied by the DSP reviewer.

## Final performance measurements

Evidence: `final/Repeated-summary.json` plus 15 raw process JSON files. Five fresh-process repetitions rotate engine order; each case has 4,000 measured 128-frame blocks after 500 warmup blocks. Values below are medians of the five run means in milliseconds. They are elapsed block time, including wrapper copies and ratio updates; process CPU is recorded separately in the raw results.

| Input -> 48 kHz output | Original WASM | Unpruned JS | Final JS | Final vs unpruned |
| --- | ---: | ---: | ---: | ---: |
| 8 kHz mono | 0.00899 | 0.15197 | 0.15069 | 0.8% lower |
| 44.1 kHz stereo | 0.05227 | 0.28875 | 0.26164 | 9.4% lower |
| 48 kHz stereo | 0.03175 | 0.26688 | 0.27503 | 3.1% higher |
| Stereo media + mono navigation | 0.04586 | 0.28516 | 0.27806 | 2.5% lower |

Process CPU medians in milliseconds per audio second:

| Input -> 48 kHz output | Original WASM | Unpruned JS | Final JS |
| --- | ---: | ---: | ---: |
| 8 kHz mono | 4.01 | 63.51 | 64.30 |
| 44.1 kHz stereo | 20.57 | 108.66 | 97.77 |
| 48 kHz stereo | 11.26 | 106.25 | 111.76 |

Median P99 block elapsed times:

| Input -> 48 kHz output | Unpruned JS | Final JS |
| --- | ---: | ---: |
| 8 kHz mono | 1.1003 | 0.9500 |
| 44.1 kHz stereo | 0.9794 | 0.8045 |
| 48 kHz stereo | 1.4844 | 1.6217 |
| Stereo media + mono navigation | 1.0206 | 1.7458 |

Final full-run cold import takes 5.64 ms and factory initialization 1.21 ms in one observed process, excluding fetch. Stream creation, first-output and impulse-calibration times are reported per format in `final/Final-full.json`. The final artifact is 28.6% smaller than the unpruned 510,242-byte JS factory. It intentionally gives up the earlier O3 translation's smaller 250,835-byte size in exchange for the variant comparison's better common-case execution. The previous candidate's full and repeated results remain available for transparency.

## Interpretation

There is no uniform runtime improvement over unpruned JS: the final candidate improves measured 44.1 kHz stereo processing, but the final five-run comparison shows a small 48 kHz stereo CPU regression and mixed tail latency. Original WASM remains significantly faster. Adoption of pure JS satisfies the user's explicit no-WASM requirement; it should not be described as a general CPU upgrade over WASM or as a proven fix for audio/video stutter.

The host has substantial scheduling / GC / JIT interference, including an isolated 1,160.99 ms final dual-stream block. P99 and max are elapsed observations, not pure-DSP worst-case execution time. A 500-block warmup also cannot guarantee that all background optimizing compilation has finished. Keep the raw data and make target-browser measurements before drawing small-percentage conclusions. A 128-frame/48 kHz quantum allows 2.667 ms for the entire worklet; these tests exclude timeline/mixing and do not certify that deadline. Do not claim zero deadline misses.

The final source is acceptable for the requested standalone pure-JS deliverable and passed the reviewed runtime/CSP contract. Real car-browser compatibility and sustained hardware playback remain unverified.

## Reproduction

All scripts reside beside this document. `Benchmark.mjs` uses the pinned pre-change wrapper and original WASM to remain independent of ongoing production edits.

```sh
node --disallow-code-generation-from-strings Benchmark.mjs wasm 4000 500
node --disallow-code-generation-from-strings Benchmark.mjs /absolute/factory.mjs 4000 500
SOXR_BENCH_MATRIX=core node --disallow-code-generation-from-strings Benchmark.mjs /absolute/factory.mjs 4000 500
SOXR_BENCH_RESULTS_DIR=/absolute/results node Repeated.mjs /absolute/factory.mjs Final
node Csp-worklet.mjs /absolute/factory.mjs
```

The browser script requires Playwright, Chromium and local HTTP listening. `SOXR_PROJECT_ROOT`, `SOXR_PLAYWRIGHT_MODULE`, and `SOXR_CHROMIUM` select local paths. The test project root must contain the candidate and production CSP page.

No production files were modified by the runtime reviewer.
