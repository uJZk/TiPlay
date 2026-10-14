# Media decoding and audio processing

This self-hosted bundle contains Mediabunny's media input/sink APIs, SoundTouchJS's
audio tempo processor and hls.js's WebVTT parsers. TiPlay owns playback scheduling;
no HLS playback engine, CDN or second HTML video clock is used by this bundle.

The authoritative package versions, tarball URLs and integrity are in the
[build lockfile](../../../../scripts/videojs/package-lock.json). Rebuild through the
same [vendor build](../../../../scripts/videojs/build.mjs) used for Video.js.
`THIRD_PARTY_LICENSES.txt` contains full dependency licenses and the linked legal
notice file retains copyright notices from the generated module graph.

Corresponding source packages are the official npm tarballs recorded in the
lockfile, and upstream source is available from:

- [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0).
- [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) (MPL-2.0).
- [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0). Its WebVTT parser
  incorporates Mozilla's vtt.js; retain that source's notices when rebuilding.

The hls.js parser imports are taken from the integrity-verified npm source tree,
because its package exports do not expose these utilities. Package updates must
review their source signatures and timestamp/discontinuity behavior. Subtitle
support does not imply DRM key availability or support for embedded subtitle
formats. Browser codec support remains a WebCodecs capability check.
