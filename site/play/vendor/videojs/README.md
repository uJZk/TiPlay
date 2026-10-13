# Video.js 10.1.0

Self-hosted ESM bundle built from the official npm packages `@videojs/html@10.1.0`
and `@videojs/hlsjs-video@10.1.0` (Apache-2.0). The HLS adapter uses
`hls.js@1.6.19`; VHS and the v8 `videojs()` API are no longer used.

Source: https://github.com/videojs/video.js
HLS engine: https://github.com/video-dev/hls.js
Version-matched migration documentation is bundled in `@videojs/html/docs/`.

The owned [build inputs](../../../../scripts/videojs/) and npm lockfile pin all packages
and published tarball integrity. npm verifies that integrity during `npm ci`.
`player.min.js` registers only the required player, media and UI components, with the
Chinese locale included. There are no runtime CDN dependencies. `LICENSE`,
`APACHE-2.0.txt`, `THIRD_PARTY_LICENSES.txt` and `player.min.js.LEGAL.txt` retain licenses and notices.
TiPlay's control layout lives in `videojs-player.js` and `airplay-controls.css`.

Rebuild with Node 22:

```sh
npm ci --prefix scripts/videojs
npm run build --prefix scripts/videojs
```

When updating, choose explicit versions, regenerate the lockfile and bundle, bump the
service-worker cache and update its complete asset list. Verify MP4/HLS, Canvas rendering,
iPhone play/pause/seek/status, Bluetooth mute, captions, Chinese labels, stop/disposal
and offline module loading. See [migration record](../../../../docs/VIDEOJS-10-2026-10-14.md).
