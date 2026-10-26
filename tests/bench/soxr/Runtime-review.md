# Independent runtime and benchmark review

Historical wasm2js candidate review. Current browser audio no longer uses this
engine; see the [benchmark scope](README.md) before reproducing or interpreting these measurements.


Scope: pinned libsoxr adapter, existing WASM backend, prospective standalone JS build, AudioWorklet startup, production CSP. No production changes made by this reviewer.

## Findings

1. `site/play/index.html` currently allows `script-src 'self' 'wasm-unsafe-eval'`, not JavaScript `unsafe-eval`. An Emscripten build that instantiates generated functions from source strings will fail. Do not weaken CSP to accommodate it.
2. A wasm2js translation can be statically imported as a same-origin ES module without eval/new Function or a WASM runtime dependency. Ensure generated glue has no `WebAssembly.Module`, `Instance`, asynchronous file fetch, DOM, Node `require`, or dynamic compilation. Package all initialization data statically. AudioWorklet has no DOM and does not promise the ordinary worker globals.
3. Binaryen wasm2js normally produces ordinary typed JavaScript, not validated legacy asm.js. A filename, `asmFunc` function name, or inserted `'use asm'` does not prove asm.js validation. Deliver with an explicit description of this distinction. If strict asm.js is required, use a pinned legacy asm.js-capable Emscripten toolchain with `WASM=0`, `DYNAMIC_EXECUTION=0`, fixed memory, and a static synchronous factory; verify actual validation instead of assuming it.
4. `soxr-wrapper.c` is already strongly pruned: only float32 interleaved variable-rate libsoxr is built, with `SOXR_HQ | SOXR_VR`, 1 runtime thread, and double-precision phase clock. Preserve this audio contract. The WASM indirect-function ABI adapter must remain if using the WASM-to-JS route.
5. Existing `StreamingResampler.process` allocates heap views, input/output subarray views, and an object result per native call. Its production caller uses drain before feed and up to 16 calls per quantum. Removing these view allocations is a plausible JS-boundary optimization, but must be applied consistently when comparing engines. Do not attribute wrapper-only improvements to translated DSP.
6. Preserve a non-null input pointer when frames=0: this drains buffered output without signalling end of input. Do not flush between network packets. Preserve ratio slew in OUTPUT frames, independent per-stream filters, and existing maximum latency policy.
7. Existing delay calibration measures an impulse centroid because upstream variable-rate delay is unimplemented. Compare centroids and startup input demand; a numerical output match alone does not establish a latency match. Do not replace this with `soxr_delay()` without validating the upstream implementation.
8. Fixed 16 MiB memory is compatible with existing initial memory and avoids growth/view invalidation. `MAXIMUM_MEMORY=32 MiB` is not evidence of 32 MiB actual usage. Report configured heap, live allocator usage/high-water, and process RSS separately. With a shared runtime, include a simultaneous multi-stream case.
9. AudioWorkletGlobalScope does not guarantee `performance.now()`. Measure detailed CPU block timings in a browser Worker / Node process with high-resolution timers and separately test a real AudioWorklet graph under production CSP. A simulated `AudioWorkletProcessor` in Node cannot verify browser loading or CSP.

## Build strategy

- Verify pinned libsoxr archive digest and pinned compiler/Binaryen archives before executing them.
- Build retained original source with the existing quality options as the unoptimized reference. Optimize with `-O3`/link-time dead-code removal and only DSP-reviewed source pruning; do not use `-ffast-math` as an unexamined shortcut.
- Emit statically importable ESM. Export a synchronous factory returning the existing `tiplay_*`, `malloc`, `free`, and `memory.buffer` interface, with a fresh heap per factory, no process-global mutable engine state across factories.
- Initialize once per worklet before packets. Allocate/calculate coefficient banks and impulse delay before render where possible. Reuse fixed input/output buffers. Keep CPU measurements of stream construction and coefficient initialization separate from steady processing.
- Scan generated artifact for `eval`, `Function`, WebAssembly, DOM and Node globals. Execute it under a context prohibiting both string and WASM code generation. Then run a true CSP AudioWorklet smoke test without broadening policy.
- Include complete corresponding source, modified source patch, pinned toolchains, build recipe, licenses, checksums, benchmark script and raw results. Keep external runtime downloads out of playback.

## Fair measurement protocol

Three engines: shipped WASM, original-source JS translation, optimized-source JS translation. All use identical deterministic input, HQ+VR recipe, max ratio, channels, chunk boundaries, target rate schedule, adapter behavior, heap limit and wrapper. Use one wrapper for the core comparison; publish allocation/copy wrapper optimizations as a separate whole-pipeline comparison.

Run in fresh processes, rotate engine order across at least 5 repetitions, record CPU / OS / browser or Node / V8 / toolchain versions and source hashes. Warm each engine equivalently before timing. Avoid concurrent compilation/builds while measuring. Report actual timed blocks, not averaged throughput divided by blocks.

Format matrix: 8/16/24/32/44.1/48 kHz input to 44.1/48 kHz output; mono and stereo for supported streams. Include 128-frame production quanta plus separately labelled 256/512 stress sizes. Include 48->48 despite unity nominal ratio: drift correction still requires a live filter. Include stereo media plus mono navigation concurrently.

Metrics:

- source fetch/ESM parse+compile, factory initialization, stream construction, filter-delay calibration, and first valid 128-frame output, each separately;
- steady CPU block P50/P95/P99/max, total CPU time per second of audio, and blocks exceeding the quantum deadline; 128/48k permits 2.667 ms for the ENTIRE worklet, 128/44.1k permits 2.902 ms;
- configured heap byteLength, allocator baseline/live/high-water if observable, process RSS before/after as auxiliary only; repeated create/delete must return to stable memory;
- impulse energy centroid vs existing WASM, startup lookahead, time-to-first-output, numeric peak/RMS difference and non-finite values;
- deterministic 10-minute +/-100/500/1000 ppm schedules and bounded ratio slew; consumed/produced sample count, drift error, no hidden resets or deadline misses;
- contiguous sine/chirp/noise split into irregular network chunks versus one continuous input: after accounting for causal buffering, identical output across chunks and no packet-boundary spectral/click regression;
- temporary zero-input drain, refeed, underrun/recovery, format/epoch change, and ratio-change continuity. Never convert a temporary shortage into an EOF flush;
- shuffled/duplicate network packets are the timeline's responsibility: run existing ContinuousAudio acceptance with the candidate backend as well as direct-DSP tests.

Acceptance: no quality/timing-contract regression against original backend, no dynamic compilation, valid real AudioWorklet startup with production CSP, deterministic reproducible builds and a measured benefit for the stated target. Desktop Node improvements alone cannot support a claim that old car browsers will be faster or that video stutter is fixed.
