# Synthetic AAC-ELD tones

These are prefixes of the files produced by [generator.cpp](generator.cpp)
using the unmodified FDK 2.0.3 encoder. They contain no captured music or user
traffic. Each stores a little-endian 32-bit segment length followed by that many
bytes: a four-byte AudioSpecificConfig, then twelve raw access units. Filenames
identify rate, channel count and samples per channel.

The fixture generator is test-only. Reproduce by building upstream
[FDK 2.0.3](https://github.com/mstorsjo/fdk-aac/tree/v2.0.3), compiling the generator
against its encoder/decoder APIs, and retaining the first thirteen segments of
each `*-1.bin` tone stream. The original complete source distribution and its
licenses remain available in
[Git history](https://github.com/uJZk/TiPlay/blob/6d4e5018/site/play/vendor/aac-eld/aac-eld-source.zip).
FDK's runtime binary, library source bundle and build adapter are no longer shipped.

`native-pcm-sha256.json` pins concatenated PCM16 decoded independently by native
FFmpeg 9.0 using [native-oracle.c](native-oracle.c), not the WASM under test.
The complete FFmpeg source archive and checksum are retained in
[vendor/libav](../../../../site/play/vendor/libav/README.md).
Build native FFmpeg with `--disable-everything --enable-decoder=aac
--disable-x86asm --disable-programs --disable-doc --disable-network
--disable-autodetect`, then `make libavcodec/libavcodec.a libavutil/libavutil.a`.
Compile the oracle with the FFmpeg source include directory, those two archives,
`-lm -lpthread`; run `native-oracle fixture.bin sampleRate channels > output.s16le`.
The oracle uses round-to-nearest, no-dither conversion from planar float to PCM16.
All eight WASM profiles match these native PCM hashes byte-for-byte.

The older FDK/asm.js PCM oracle was removed with its decoder. These tests validate
codec output and ownership; they do not establish vehicle sound quality or CPU headroom.
