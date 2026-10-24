# Raw capture encoding benchmark

Run with the project's JDK 25 from the repository root:

```sh
java tests/bench/raw-capture/RawCaptureEncoding.java
```

This compares the previous copied input/Base64 String/BufferedWriter path with the
JDK bulk Base64 range encoder and buffered byte writer. Each operation includes a
complete TSV record and synchronous flush to a discard sink. It reports median
time and thread-allocated bytes after warmup for 960-byte, 4 KiB and 48 KiB payloads.
The source range has a nonzero offset. The benchmark uses the JDK implementation;
it contains no custom Base64 codec.

The sink removes filesystem variability so the result measures encoding and
allocation only. Host JIT/SIMD behavior and allocation results do not establish
Android device performance, disk throughput or physical playback continuity.
`RawTrafficTest.bulkEncodingPreservesByteRangesPaddingAndUtf8ChannelNames` checks
actual journal bytes, padding, chunk boundaries and Unicode channel labels.
