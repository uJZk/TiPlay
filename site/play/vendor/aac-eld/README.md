# AAC-ELD WebAssembly decoder

This is a **Third-Party Modified Version of the Fraunhofer FDK AAC Codec Library
for Android**, with a TiPlay WASM interface dated 2026-10-24. The complete FDK AAC
2.0.3 source at commit `716f4394641d53f0d79c9ddac3fa93b03a49f278` is compiled
without source pruning, stub extensions or the former asm.js arithmetic changes.
Ordinary LLVM link-time optimization removes unreachable code from the binary.
[NOTICE](NOTICE) retains the complete license; the software license grants no
patent license. [MODIFICATIONS.txt](MODIFICATIONS.txt) identifies the adapter.

Browser WebCodecs remains the first decoder choice. When native AAC-ELD is
unavailable, TiPlay runs this decoder in one module Worker per independent stream.
The 973,937-byte `aac-eld.wasm` binary is genuine WebAssembly; `aac-eld.js` is a
small ES module loader and ownership adapter. There is no asm.js or wasm2js
fallback, `eval`, dynamic function construction or CDN dependency. The page and
worker CSP need `script-src 'self' 'wasm-unsafe-eval'`. Serve the binary with
`Content-Type: application/wasm` for streaming compilation; generic binary MIME
also works through byte compilation. HTTP and compile failures reject startup;
a fresh decoder epoch may retry. Worker termination cancels outstanding work.

## Interface and memory

```js
import { createEldDecoder } from './aac-eld.js';
const decoder = await createEldDecoder({ sampleRate: 44100, channels: 2, frameLength: 480 });
const pcm16 = decoder.decode(rawAccessUnit, true); // owned, transferable PCM16
// Transfer pcm16.buffer, then close the decoder when its stream ends.
decoder.close();
```

The interface accepts one complete decrypted raw AAC-ELD access unit of
1–8,192 bytes. Supported negotiated profiles are 44.1/48 kHz, mono/stereo and
480/512 samples per channel, without SBR or resilience extensions. The complete
upstream codec remains intact; this interface limits the negotiated product
profiles. Framing, decryption and timing belong to the caller.

Each instance has a fixed 16 MiB WASM memory, a reused input buffer and borrowed
interleaved PCM16 output. `decode(packet)` returns a borrowed view overwritten
by the next decode, conceal or reset. **Never transfer its buffer**: it owns the
whole WASM memory. Use `decode(packet, true)` for an exact owned PCM array, or
`decodeInto(packet, destination)` for caller-owned storage. `conceal(copy=false)`
retains FDK's concealment behavior; output-valid status codes `0x4000..0x4fff`
are exposed through `lastStatus`. Fatal status codes throw with `.code`.
`reset()` clears codec history; `close()` is idempotent and releases private
references. Externally retained borrowed views retain their WASM memory.

The standalone codec has no filesystem or console capability. Its WASI I/O
imports return EBADF; any libc entropy request uses browser `crypto.getRandomValues`.
An optional already-compiled `module: WebAssembly.Module` permits replacement and
non-browser verification without changing the codec or exposing Node loaders.
The production worker adapter bounds concurrent instances to four, pending
packets to 32, and initialization/decode waits; native WebCodecs success allocates
no software decoder memory.

## Source and rebuild

[The source archive](aac-eld-source.zip) contains the **complete unmodified FDK**,
the TiPlay interface source and the retained synthetic fixture generator.
The [interface source](source/decoder.cpp), loader, notices, exact source/toolchain
provenance and [SHA256SUMS](SHA256SUMS) accompany the binary. Redistribute these
materials and make them available free of charge with binary distributions.

Use pinned WASI SDK **34.0** (clang **23.1.0-wasi-sdk**), CMake **4.1.2** and
Ninja **1.13.0**. From the TiPlay repository root:

```sh
python3 scripts/aac-eld/build.py --sdk /path/to/wasi-sdk-34.0-x86_64-linux \
  --cmake /path/to/cmake --ninja /path/to/ninja
node tests/web/aac-eld-software.test.mjs
CHROMIUM=/path/to/chromium node tests/web-e2e/aac-eld-wasm.mjs
```

`build.py` verifies the source archive and compiler versions, compiles every
upstream library source through its unmodified CMake project, then links the
small interface with a bounded stack/memory and no embedded timestamps. Two
independent builds produced identical binary SHA-256
`2cfccd341de80efab47b64c09f173575fa32066e5aada602e91e9bd0e01d1f99`.

The eight synthetic profile fixtures produce exactly the pre-migration PCM
bytes, pinned by independent golden SHA-256 values. Tests also cover NoData,
stream isolation, reset, ownership, native-first selection, bounds and worker
cancellation. The real Chromium harness uses the exact production CSP and
shipped binary, checks all 96 fixture frames and failure/retry paths. These
checks establish software behavior; they do not establish iPhone or vehicle
playback quality or physical output latency.

The linked WASI libc/musl, LLVM compiler-rt and applicable C++ runtime notices
are retained in [wasm-runtime](../wasm-runtime/README.md), with exact SDK source
revisions and full license texts. Keep that shared notice directory with binary
distributions.
