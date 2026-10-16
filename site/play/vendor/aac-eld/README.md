# AAC-ELD asm.js decoder

This is the **Third-Party Modified Version of the Fraunhofer FDK AAC Codec Library
for Android** supplied for TiPlay. The module is preserved without changes;
[SHA256SUMS](SHA256SUMS) pins the original distribution and source bytes.
[NOTICE](NOTICE) contains its complete license and copyright notices;
[MODIFICATIONS.txt](MODIFICATIONS.txt) identifies the supplied modifications.
The software license does not grant patent licenses.

The [complete corresponding source archive](aac-eld-source.zip) includes modified
FDK sources, the JavaScript wrapper, patches, build scripts and synthetic fixtures.
Redistributions must retain the notices and make this complete source available
free of charge. Its published download is
<https://ujzk.github.io/TiPlay/vendor/aac-eld/aac-eld-source.zip>.
Provenance and detailed rebuilding instructions are in the archive's
`dist/README.md`; `build.sh` requires Emscripten 1.39.0 **fastcomp**, CMake and Python.
Modern Emscripten's `WASM=0` output uses a different backend.

`createEldDecoder({sampleRate, channels, frameLength})` asynchronously creates one
decoder per independent stream. It supports raw, decrypted AAC-ELD access units
at 44.1/48 kHz, mono/stereo, and 480/512 samples per channel, without SBR, MPEG
Surround or resilience tools (`epConfig=0`). Each input is one complete access
unit of 1–8,192 bytes; framing, decryption and scheduling belong to the caller.

Each instance owns a fixed 16 MiB heap. `decode(packet, true)` returns an owned,
interleaved PCM16 array that can be transferred. The default borrowed result is
overwritten by the next decode, conceal or reset; transferring its buffer would
detach the decoder heap. Call `close()` on retirement. Externally retained
borrowed views keep their heap alive after close.

The module embeds its initializer and has no external WASM/memory download,
`eval` or `Function` construction. It targets browsers and module workers;
bare Node execution selects an unsupported legacy loader branch. Run browser
fixtures in a real browser or an explicit browser test context. The archived
fixtures and supplier validation are synthetic, and do not establish iPhone or
vehicle playback performance.
