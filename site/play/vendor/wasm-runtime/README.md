# Linked WebAssembly runtime notices

The browser's NetEq and SoundTouch reactors link portions of the
WASI SDK C/C++ runtime. This directory retains their full runtime license texts,
credits and source-level third-party notices alongside the media libraries'
own licenses. Keep these files with distributions of the corresponding WASM
binaries. They are public distribution materials and do not participate in the
offline playback cache.

## Pinned source identity

The verified build toolchain is WASI SDK **34.0**, archive SHA-256
`b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4`.
Its `VERSION` file records the same revisions as the
[`wasi-sdk-34` source tag](https://github.com/WebAssembly/wasi-sdk/tree/5a0bf653a1a06e1c18867567c5937006d3394a69):

| Component | Exact source revision |
| --- | --- |
| WASI SDK build configuration | `5a0bf653a1a06e1c18867567c5937006d3394a69` |
| WASI libc | `2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13` |
| LLVM runtime sources | `895aa2c896ada719451be2e3673c83da8ddf1141` |

musl **1.2.6** is the vendored `libc-top-half/musl` subtree at that WASI libc
revision. It is not a separate musl submodule. `dlmalloc` is the SDK/default
allocator. [provenance.json](provenance.json) records immutable source URLs,
archive/file checksums, extraction details and the SDK's two relevant libc++/
libc++abi source patches. The patches do not alter the license texts.

## Retained notices

| Runtime component | Materials |
| --- | --- |
| WASI libc | [upstream license overview](wasi-libc/LICENSE.txt), full [Apache-2.0](wasi-libc/LICENSE-APACHE.txt), [Apache-2.0 with LLVM exceptions](wasi-libc/LICENSE-APACHE-LLVM.txt) and [MIT](wasi-libc/LICENSE-MIT.txt) texts |
| musl and math contributions | full [COPYRIGHT and contributor list](wasi-libc/MUSL-COPYRIGHT.txt), plus [verbatim source notices](wasi-libc/MUSL-SOURCE-NOTICES.txt), including Sun, Arm and BSD math notices |
| Cloudlibc and musl-fts portions of WASI libc | full [Cloudlibc BSD-2-Clause notice](wasi-libc/CLOUDLIBC-LICENSE.txt) and [musl-fts BSD-3-Clause notice](wasi-libc/MUSL-FTS-COPYING.txt) |
| dlmalloc | [original public-domain/CC0 notice](wasi-libc/DLMALLOC-NOTICE.txt) and full [CC0-1.0 legal text](wasi-libc/CC0-1.0.txt) |
| LLVM compiler-rt builtins | full [LICENSE](llvm/compiler-rt-LICENSE.TXT) and [CREDITS](llvm/compiler-rt-CREDITS.TXT) |
| LLVM libc++ | full [LICENSE](llvm/libcxx-LICENSE.TXT) and [CREDITS](llvm/libcxx-CREDITS.TXT) |
| LLVM libc++abi | full [LICENSE](llvm/libcxxabi-LICENSE.TXT) and [CREDITS](llvm/libcxxabi-CREDITS.TXT) |

The LLVM component licenses retain Apache-2.0 with LLVM exceptions and their
included legacy license/attribution sections. The WASI libc notice set covers the
upstream runtime package conservatively; inclusion of a component's notice does
not establish that every function from that component survives linking.

The C reactor link selects WASIp1 startup, libc/math/allocator and compiler-rt
builtins. The C++ reactors additionally select the no-exceptions (`noeh`) libc++
and libc++abi archives. Individual functions are selected by the static linker
and LTO. These builds do not select libunwind. The project's freestanding
`audio-core.wasm` uses `-nostdlib` and has no standard-runtime archive link inputs.
Clang and Binaryen themselves are offline build tools; this notice bundle covers
runtime code and does not describe those tool executables as browser dependencies.

The [SoundTouch](../soundtouch/README.md) materials retain each media library's own
license, complete source and replaceable-build instructions. Their license terms
continue to apply alongside these linked-runtime notices.

Libav.js uses its Emscripten build and bundled component license headers; its
complete sources and build provenance are in [vendor/libav](../libav/README.md).
