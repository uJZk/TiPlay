# LibTomMath 1.3.0 benchmark candidate

This complete [LibTomMath 1.3.0](https://github.com/libtom/libtommath/tree/v1.3.0)
WASM candidate is retained solely for the SRP benchmark. **It is not part of the
published browser application.** Real Chromium measurements found this candidate
slower than the browser's native BigInt implementation; see the parent README.

The complete, unmodified upstream source archive is retained under `source/`,
with its **Unlicense**. Every `bn_*.c` translation unit is compiled and all library
functions remain exported. No custom feature header or algorithm pruning is
applied. The adapter only marshals bounded hexadecimal operands into `mp_exptmod`.
File/socket helpers have no host capability and return WASI `ENOSYS`.

Each candidate handshake has a private, fixed 2 MiB memory. WebCrypto owns
randomness and hashing. The hexadecimal arena is cleared after each operation.
Optimizing C compilers can eliminate upstream pre-free limb clearing, so disposal
explicitly erases the **entire private linear memory**. JavaScript strings and
BigInts remain subject to engine garbage collection. No constant-time claim is made.

Rebuild using `tests/bench/srp/build.py --sdk /path/to/wasi-sdk-34.0-x86_64-linux`.
The script pins the archive digest, compiles the complete library with
`-O3 -flto -D__STDC_IEC_559__=1 -mexec-model=reactor`, exports all functions and fixes
initial/maximum memory to 2 MiB. The IEEE-754 definition enables the upstream
floating-point conversion APIs on WASM; it does not change SRP arithmetic.

`provenance.json` records source and binary identities. The candidate unit tests
verify actual heap erasure, bounds, allocation failure/retry and the real Bouncy
Castle 1.79 proof/key/transcript vector. The browser benchmark verifies matching
proofs under production CSP and includes marshaling, native WebCrypto, full
initialization and complete heap disposal.
