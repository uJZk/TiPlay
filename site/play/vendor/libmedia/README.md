# libmedia AVPlayer

TiPlay uses upstream AVPlayer for AirPlay URL playback: HTTP/HLS loading,
packet buffering, demuxing, decode scheduling, A/V synchronization, Canvas/WebGL
rendering, Web Audio output and tempo processing. Video.js supplies controls only.

## Pin and reproduction

- Official npm `@libmedia/avplayer` **1.3.1**, with tarball URL, SHA-512 integrity
  and transitive source packages pinned in [package-lock.json](../../../../scripts/avplayer/package-lock.json).
- Upstream [v1.3.1](https://github.com/zhaohappy/libmedia/tree/152f629d3021fd8013efa464fcb7b55f9fbe7753),
  commit `152f629d3021fd8013efa464fcb7b55f9fbe7753`.
- Unmodified baseline audio WASM releases are pinned by URL, size and SHA-256 in
  [wasm.lock.json](../../../../scripts/avplayer/wasm.lock.json). No video WASM,
  encoder, SIMD-only or pthread-only audio decoder is included.
- [artifacts.json](artifacts.json) records exact generated JavaScript/WASM bytes.

Rebuild with Node 22, npm and curl:

```sh
cd scripts/avplayer
npm ci --ignore-scripts --no-audit --no-fund
node build.mjs
node check.mjs
```

The build downloads only missing checksum-verified WASM into its ignored `.cache/`.
Original npm ESM lazy chunks remain local; no CDN is consulted at runtime. Copy
all files in this vendor directory when distributing. AVPlayer internally creates
Blob workers; deployment must allow `worker-src 'self' blob:`. SharedArrayBuffer
is optional; browser and no-SAB Worker acceptance is recorded in Testing.

## Local adaptation

[entry.js](../../../../scripts/avplayer/entry.js) exports the upstream player through
an explicit Canvas subclass. It always disables MSE, rejects attempts to create
HTML video/audio elements, prefers native WebCodecs video and WebGL rendering, and supplies local
baseline audio decoder/resampling/tempo modules. Unsupported native video formats
must report an error; no video WASM fallback is packaged. Upstream 1.3.1 does not
supply an ALAC WASM decoder or include ALAC in its supported-codec set.
ALAC-only URL audio is rejected explicitly; supported alternate audio tracks
remain selectable. Live ALAC uses the separate live-audio decoder and is unaffected.

[build.mjs](../../../../scripts/avplayer/build.mjs) AST-transforms exactly 13 bare
`fetch` call sites with an inline RequestInit adapter: `no-store`, no referrer,
no ambient credentials, and TiPlay's local/loopback address-space classification.
For proxy-only sessions, the internal `X-TiPlay-Proxy-Origin` header carries an
instance request policy through upstream HTTP options. The adapter removes this
header before network access, rejects destinations outside the exact Android
origin and `/airplay-resource` route, and rejects HTTP redirects. On HTTPS pages,
Chromium can block a Blob Worker's private HTTP request as mixed content even
when the document can access the Android endpoint. A per-source document-thread
bridge makes only requests to that exact endpoint and streams one requested chunk
at a time back to the Worker. It preserves Range, response status/headers and
cancellation. The bridge does not replace global fetch or implement another HLS
engine, retry policy or media buffer.
The unreachable upstream CDN WASM default is replaced with a local failure path.
One pinned `startAudioContext` registration is redirected from an upstream Blob
AudioWorklet to the official same-origin standalone processor file. The original
thread/Safari selection predicate is retained. This keeps the existing
`script-src 'self' 'wasm-unsafe-eval'` policy; no `unsafe-eval` or Blob script
permission is required. Three metadata adaptations classify HLS from the upstream-parsed `ENDLIST`
state: the HLS media loader sets its live flag in both directions; IO open returns
that classification; AVPlayer consumes it before creating its buffering policy.
No second playlist parser is introduced, and DASH remains unchanged. A final
pipeline teardown adaptation closes AVPlayer's owned AudioContext and clears
stale render-thread references so subsequent URL sessions can reopen cleanly.
The AudioContext state listener captures its actual context and ignores retired
context events, including delayed close events after a replacement session starts.
Six cancellation adaptations preserve upstream request ownership: pending
FetchIOLoader headers are abortable before a reader exists, an abort-only IO operation cancels requests
before demux teardown without destroying pending IPC replies, and HLS propagates an owned source AbortSignal through its
existing request-options helper to manifest/key requests without local signals.
Local reader/refresh signals retain their original behavior. The internal signal
option is removed before native fetch. Lifecycle epochs guard load/play await
continuations after stop; the wrapper waits actual in-flight operations after
cancellation before final shared-pipeline teardown. This prevents asynchronous
initialization from recreating workers after an early dispose. All guard counts
are recorded in the build manifest and checked against the pinned source.
Both worker RPC error serializers handle null/missing rejection values without
throwing a secondary exception, preserve known Error names/messages, and use a
fixed generic message for other values. Negative IO-open results become explicit
load failures. Six HLS failure-evidence adaptations retain only the current
master-manifest attempt's fixed phase (`request`, `body`, `parse`, `playlist`),
HTTP status and allowlisted exception name across IO-worker startup. Terminal
failures become a fixed diagnostic message instead of losing the cause behind
`Unable to open media source`. Retry count, timing, loading and buffering remain
upstream-owned; this improves evidence and does not fix an unknown media source.
Source URLs, response headers, manifest content and arbitrary error messages are
excluded. A successful retry clears older failed-attempt evidence. The two bundled
asynchronous IOReader line readers retain a
nonempty final line only on clean EOF; WebVTT's chunk reader likewise retains
its final nonempty cue without requiring a blank separator. Empty EOF, aborts
and network failures still propagate. After seek, an already pending packet
pull is satisfied through upstream's existing `replyAVPacket` serialization/
release helper instead of leaving that request stranded behind a cached packet.
Seek time is captured before packet ownership transfers; queue counters change
only when a packet is actually queued. Focused tests execute the generated line,
chunk and seek-handoff code. SubtitleRender's non-SAB Worker boundary uses the
existing upstream `unserializeAVPacket` helper to turn transferred packet objects
into local packet allocations before CType pointer operations. Raw pointers and
negative status codes keep their upstream path. Original release paths and a
finally guard ensure each owned packet releases once and the in-flight flag
clears on failures. The helper is resolved once in module scope to avoid shadowed
webpack-loader variables. Browser acceptance includes HLS subtitle switching.
Before a seek or subtitle switch, the renderer pauses and sends a drain marker
over its existing subtitle packet port. The demux handler answers an older
pending subtitle pull with the upstream retry status, then acknowledges the
marker. The renderer waits for that pull to finish before clearing old cues and
performing the seek. Its next pull therefore receives the newly cached first
cue; an old EOF cannot end the restarted renderer. Audio/video request handoffs
remain unchanged. The controls adapter enables subtitles before selecting them,
so a later redundant enable cannot erase a cue produced by selection. Generated
code tests cover the port ordering, stale EOF/packet drain and unchanged
non-subtitle requests.
HLS master selection uses the upstream-parsed variant metadata: declared PQ/HLG
and Dolby Vision codecs are excluded before any variant request, explicit SDR
variants take precedence over unknown transfer metadata, and unknown variants
remain eligible only when no explicit SDR variant is available. An all-HDR master
returns a typed unsupported error through the existing IO metadata boundary,
without attempting child resources or retrying an unsupported policy. Selected
stream metadata is still checked by the facade before playback. No second
playlist parser is used. These are TiPlay modifications; buffering targets and
timing algorithms otherwise remain upstream.

## Licenses and corresponding source

`COPYING.LGPLv3` and `THIRD_PARTY_LICENSES.txt` retain dependency licenses/notices.
The npm tarballs pinned by the lockfile include the corresponding TypeScript
sources for libmedia components; AVPlayer source is available at the exact commit
above. The repository's `build/`, compiler scripts and dependency definitions at
that commit provide the audio WASM build sources/configuration. FFmpeg audio
codec/resampling code is LGPL-2.1-or-later; SoundTouch is LGPL-2.1-or-later. No
GPL x264/x265 encoder module is distributed here. TiPlay's wrapper and build
adapter remain available as source and can be replaced/rebuilt with the upstream
components; the modules are not encrypted or integrity-locked at runtime.
