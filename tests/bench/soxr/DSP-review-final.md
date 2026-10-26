# Independent DSP final signoff

Historical wasm2js candidate review. Current browser audio no longer uses this
engine; see the [benchmark scope](README.md) before reproducing or interpreting these measurements.


Final candidate: `0dda221ebb9979a01840c475caed3d9aee84c436f4a1e91483a868ca5df85777`.

The child DSP reviewer reran the full independent probe after the final wasm2js-flag selection. All 28 format cases, 3 antialias probes, ±4.9% variable-ratio slew, 14 impulse-centroid measurements and 120-second / 5760000-frame continuous drift passed. Candidate samples and delays equal the pinned original WASM reference exactly on all tested inputs. Results: candidate-final.json. The float32-only IO specialization is correct within the exported tiplay ABI. Keep all vr32 filters, half-band stages, 64-bit phase and slew/crossfades unchanged. General int16/int32/float64 libsoxr IO is deliberately outside this ABI.

The measured quality equivalence does not prove car-browser CPU scheduling; wasm2js output is asm.js-like typed JavaScript, not validated legacy asm.js.
