# Synthetic AAC-ELD tones

These are prefixes of the `fixtures/<rate>-<channels>-<frameLength>-1.bin` files
in the supplied [corresponding source archive](../../../../site/play/vendor/aac-eld/aac-eld-source.zip).
The archive's `fixtures.cpp` generates the tones with the unmodified FDK encoder;
they contain no captured music or user traffic. The source and decoder license
are retained in the [vendor distribution](../../../../site/play/vendor/aac-eld/README.md).

Each container stores a little-endian unsigned 32-bit byte length followed by
that many bytes. The first segment is the four-byte AudioSpecificConfig; the
remaining twelve segments are complete raw access units. Filenames identify
sample rate, channel count and samples per channel. There is no RTP framing.

To reproduce a fixture, copy the corresponding archive entry through the end of
its thirteenth length-prefixed segment without changing those bytes. These small
fixtures exercise all supported rate/channel/frame-length combinations and
initial decoder history; they do not establish vehicle audio performance.
