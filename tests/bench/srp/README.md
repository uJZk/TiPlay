# SRP client arithmetic benchmark

Run from the repository root with Node 22, Playwright Core and Chromium:

```sh
CHROMIUM=/path/to/chromium node tests/bench/srp/benchmark.mjs
```

This benchmark-only candidate is excluded from the published site and browser
cache. Production retains the faster browser BigInt implementation, as required
by the user's exception for slower WASM replacements.

The benchmark runs real Chromium under the production CSP. It compares the original
unmodified tssrp6a BigInt modular-power implementation with the complete
LibTomMath WASM library using identical 2048-bit-group operands and a
production-size private exponent. It verifies identical A/M1/S proofs.

The measured client setup includes three modular powers, library marshaling,
WebCrypto hashing/proof verification, native HMAC key import/sign/verification
and per-handshake WASM instantiation and complete 2 MiB heap disposal. It reports
twenty warm trials per backend, alternating order, with the first warmup omitted.
The initial WASM measurement additionally includes no-store gzip HTTP fetch,
decompression and compilation; initial native timing is reported separately.

The local server excludes Internet download latency, cache persistence, phone
round trips and vehicle execution. Desktop results do not establish a cold
Internet download time or a car-browser speedup. There are no constant-time
claims, passwords or reusable session keys in benchmark output.

On Chromium 151.0.7922.173, three independent twenty-trial runs measured native
client medians of **9.60/9.50/9.60 ms**, against **16.30/16.40/16.60 ms** for WASM. Initial
native setup measured **13.30/22.60/18.80 ms**; initial WASM fetch/compile/setup measured
**24.40/31.80/31.60 ms**. Matching proofs passed. These browser results supersede an
initial Node 22 host profile that favored WASM. The full candidate source and
build remain here so the performance exception can be re-evaluated on another
browser without adding it to the product.

Rebuild and check the complete candidate with WASI SDK 34:

```sh
python3 tests/bench/srp/build.py --sdk /absolute/path/to/wasi-sdk-34.0-x86_64-linux
node --test tests/bench/srp/math.test.mjs
```
