# HLS fixtures

Synthetic one-second H.264/AAC test pattern and sine-wave HLS fixture generated with FFmpeg:

`ffmpeg -f lavfi -i testsrc2=size=32x18:rate=5 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 1 -c:v libx264 -threads 1 -pix_fmt yuv420p -g 5 -c:a aac -b:a 32k -f hls -hls_time 0.5 -hls_list_size 0 index.m3u8`

The `../hls-cmaf` fixture uses the same command plus `-hls_segment_type fmp4`.

These fixtures contain no third-party recordings. They exercise demux/decode paths, not sender or vehicle compatibility.
