# Official libWebRTC NetEq for browser audio

`neteq.wasm` contains official NetEq DSP/controller code and the official Opus/L16
AudioDecoder implementations, built from the exact revisions and SHA-256 archives
in `provenance.json`. This is not the independently rewritten Rust `neteq` crate.

TiPlay's `source/` supplies the C ABI, private decoder factory and WASI platform
services. Upstream NetEq algorithms are unmodified. The wasm32 architecture header
and single-owner mutex header override unsupported host services at include time.
Each WASM instance belongs exclusively to one AudioWorklet thread; never share its
memory or handles between workers. Environment creation requires supplied
clock/trials; task-queue creation traps rather than silently running asynchronous
work. Abseil nullability annotations are erased for the pinned Abseil release;
this affects annotations only. The supplied clock follows audio consumption;
WASI chrono calls are for instrumentation, not jitter/tempo policy.

The build uses 32 MiB fixed linear memory and a 1 MiB stack. Engine creation and
packet allocation remain upstream behavior; fixed memory does not imply zero
allocations or a proven vehicle real-time budget. The native wrapper exports only
the bounded ABI, not arbitrary library functions. PCM float/int16 conversion is
native; NetEq operates at 48 kHz with mono or stereo audio. Opus packet duration is
parsed by libopus. AAC/ALAC decoding is external according to browser capabilities.

Rebuild (Python 3.12+, CMake 4.1.2, Ninja 1.13.0, WASI SDK 34.0):

```sh
python3 scripts/neteq/build.py --sdk /path/to/wasi-sdk-34.0-x86_64-linux
```

The script downloads checksum-pinned public source archives only during build,
using the normal configured HTTPS proxy/TLS trust. A checked cache can support
offline rebuilds. Sources are available at the exact URLs in provenance; source
archives and build files are not needed at browser runtime. `scripts/build_wasm.py`
includes NetEq in its full rebuild/check workflow. Preserve LICENSE.webrtc,
PATENTS.webrtc, LICENSE.opus and LICENSE.abseil in distributions.

Normal web tests use the actual shipped binary, not a simulated NetEq. Synthetic
FEC-positive fixtures are generated test signals, never uploaded user recordings.
See [audio buffering](../../../../docs/Audio-tempo.md) for policy and limitations.
