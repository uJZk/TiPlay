# Independent DSP review of the TiPlay libsoxr asm.js build

Scope: pinned libsoxr commit 945b592b70470e29f917f4de89b4281fbbd540c0, existing WASI build, adapter, streaming resampler and ContinuousAudio. No production files changed by this reviewer.

## Findings and minimum safe trimming

1. Existing compilation already selects only `soxr.c`, `data-io.c`, `vr32.c`; CR32/64, FFT/SIMD, OpenMP, libsamplerate compatibility, examples and file/audio-device I/O are absent. Export only the eight TiPlay stream/memory entry points, permit compiler DCE, and disable Emscripten filesystem/runtime convenience APIs. These trims preserve DSP behavior.
2. Preserve variable-rate polyphase interpolation, half-band FIR/IIR, stage transitions and their crossfades, all filter state/FIFOs, 64-bit fixed-point phase accumulation and output-frame slew. Do not replace these with linear interpolation, per-packet stateless processing or a shortened coefficient bank to obtain a smaller file. Current input protocol permits 8–96 kHz and 1–2 channels. Ratios cross 1:1 during drift, even for nominal 48→48 kHz, so a fixed-ratio-only path is incorrect.
3. `SOXR_HQ | SOXR_VR` chooses vr32, but pinned `vr_create` ignores q_spec/r_spec. The name HQ does not establish adjustable vr32 filter quality. Quality must be measured for the shipped implementation. Removing HQ options does not justify replacing its coefficients.
4. Prefer link-time specialization before hand-editing `soxr.c`/`data-io.c`. The adapter currently guarantees float32 interleaved and a single worker; public split/int16/int32/float64 I/O code can be removed only if all dispatch tables and adapter expectations are checked and comparison probes pass. Retaining source for a dead runtime path is harmless when DCE removes it. Keep upstream source and auditable patches.
5. Do not use `-ffast-math`, approximate transcendental operations or reduced phase precision in the final build without additional numerical characterization. Native i64 lowering is expensive in asm.js, but deleting carries changes the continuous source clock. A future two-u32 phase implementation must separately prove overflow and slew invariants before replacement.
6. Preserve non-null-input/zero-length draining semantics: temporary lack of input must not become EOF (`soxr_process(..., NULL, ...)`). Keep instance state across packets, and recreate it only for a real discontinuity/format epoch. Keep current latency policy and impulse content-delay measurement; upstream vr_delay remains the constant TODO `100`.

## Adapter and runtime cautions

- `tiplay_create` currently does not explicitly reject NaN/infinite ratio or invalid channels. Existing browser protocol validates source format, but a distributed reusable asm.js wrapper should reject non-finite/zero rates, channels outside 1–2, negative/non-integer frame counts/capacities and buffers shorter than the indicated sample count before touching heap memory.
- Keep maximum-ratio provisioning at initialRatio*1.05. Calling set_io_ratio beyond the provisioned maximum can require unavailable stages; the current JS wrapper guards ±5%; constructor input validation and finite nonnegative integer slew validation could be hardened.
- `input_done`/`output_done` are process-global adapter values. Current synchronous AudioWorklet calls consume them immediately and are safe; expose one result object per call to callers and avoid async interleaving between process and these getters. Two streams should be exercised in an alternating test.
- Runtime JS typed-array/subarray/result-object allocations remain in the existing processing path; a smaller C binary alone cannot establish absence of AudioWorklet allocation spikes. Upstream FIFOs initially allocate 32 KiB each and can later realloc/memmove, so 'allocation occurs only at creation' should not be claimed without measurement or preallocation.
- Filter calibration must remain per input/output format. Hardware context sample rates beyond 44.1/48 kHz need separate acceptance before claiming support. Impulse energy-centroid tests establish content delay, not end-to-end acoustic latency.

## Executable quality probes

`node work/soxr-asm/review-dsp/probe.mjs [absolute-asm-module-path]`

Expected optional module: default Emscripten factory, `_tiplay_create`, `_tiplay_process`, `_tiplay_ratio`, `_tiplay_input_done`, `_tiplay_output_done`, `_tiplay_delete`, `_malloc`, `_free`, `HEAPU8`. No argument probes existing WASM. The comparison uses the actual pinned WASM, not a mock.

- 28 format cases: input 8/16/24/32/44.1/48/96 kHz × output 44.1/48 kHz × mono/stereo. 137-frame versus 4096-frame packetization must be bit-identical for fixed ratio; every produced value finite; no input lost; silent right channel remains exactly silent.
- Candidate versus pinned WASM: equal emitted sample counts, maximum absolute error below 2e-5 for fixed and swept ratios.
- Three full-waveform stopband probes: 96→48k at 36k input; 48→44.1k at 23.5k; 96→44.1k at 36k. Reject >70 dB relative to 997 Hz and no >1 dB degradation from pinned baseline. Transient ends excluded. These are selected tones, not a full stopband sweep or universal spectral guarantee.
- Stereo ±4.9% slew with 128 output-frame scheduling crosses 1:1 both directions. Packetization error below 2e-5 and candidate versus pinned error below 2e-5; bounded adjacent-sample delta. This does not claim all arbitrary rate curves are characterized.

## Existing WASM measurements

All probe checks passed on Node 24.19.0. Raw result: `baseline.json`.

- Fixed-ratio packetization: zero maximum absolute difference across all 28 cases.
- Stopband RMS ratios: −128.15, −116.04, −128.15 dB respectively.
- Swept-ratio packetization: max absolute difference 1.6093e-6, RMS 2.0333e-7. Small block-dependent float rounding exists in upstream vr32, so demanding bit identity during slew would reject the baseline itself.
- Swept stereo maximum adjacent sample delta: 0.11227 at the configured two tones/amplitudes.

## Extended measurements and baseline JS artifact

- Fourteen impulse centroid formats: content delay −0.01134..0.16440 ms, all within current 1 ms uncertainty, identical to pinned WASM.
- A 120-second virtual stereo 44.1→48k run retains state for 5,760,000 output frames with varying ±425 ppm drift components, never underruns, and leaves 245.83 input frames of bounded lookahead. Candidate and reference handles are called alternately every process call, also checking immediate global input/output-count retrieval across simultaneous streams. Output difference versus pinned WASM is zero.
- `baseline-factory.mjs` passed every extended probe, with zero numerical difference against the pinned WASM in fixed-ratio, slew, calibration and long-run comparisons. Raw result: `candidate-baseline.json`.

## Final artifact status

Approved for the tested DSP boundary: `/workspace/TiPlay/work/soxr-asm/soxr.asm.mjs`, SHA-256 `b47714c01372ee0271e5fd3542932bb522f51c6291d9479cb556c508eda6887b` (250,835 bytes).

The optimized candidate independently passed the entire extended probe. Across 28 format cases, three stopband probes, ±4.9% slew, 14 impulse calibrations and the 120-second/5,760,000-frame stereo long run, output samples and calibrated delays were identical to the original pinned WASM. Raw result: `candidate-optimized.json`.

`build/float-io.c` (SHA-256 `453d12c05aa35f67e58778c1f7f52b10015c7d0c000c4254d89dee469b71791f`) correctly specializes original float32 IO: mono memcpy; stereo split/interleave loops; sample pointer advancement; zero integer-clipping count. This is valid because only the TiPlay default float32-interleaved constructor is exported. It must not be advertised as the general-purpose original libsoxr datatype API. The filter coefficients and vr32 phase/slew implementation are unchanged; no fast-math is enabled. This is the recommended trimming boundary.

Generated core remains wasm2js asm.js-like, not validated asm.js; delivery should preserve that distinction. These DSP checks establish numerical parity for the listed signals and format/ratio cases, not AudioWorklet scheduling performance or physical acoustic quality in a car browser. No production integration or latency-cap change was made by this review.
