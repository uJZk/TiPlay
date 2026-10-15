# Video.js controls and media adapter

Self-hosted ESM controls and native neutral-skin CSS from the official Video.js
HTML and media packages (Apache-2.0). TiPlay's native-like media adapter exposes
its own Canvas/Web Audio playback engine to these controls.

Source: https://github.com/videojs/video.js
Version-matched migration documentation is bundled in `@videojs/html/docs/`.

The owned [build inputs](../../../../scripts/videojs/) and npm lockfile pin all packages
and published tarball integrity. npm verifies that integrity during `npm ci`.
`player.min.js` registers only the required player and UI components, with the
Chinese locale included. There are no runtime CDN dependencies. `LICENSE`,
`APACHE-2.0.txt`, `THIRD_PARTY_LICENSES.txt` and `player.min.js.LEGAL.txt` retain licenses and notices.
TiPlay's control layout lives in `videojs-player.js` and `airplay-controls.css`.
The same build creates the [media toolkit bundle](../mediabunny/README.md).

Rebuild with Node 22:

```sh
npm ci --prefix scripts/videojs
npm run build --prefix scripts/videojs
```

When updating, choose explicit versions, regenerate the lockfile and bundle, bump the
service-worker cache and update its complete asset list. Verify MP4/HLS, Canvas rendering,
iPhone play/pause/seek/status, Bluetooth mute, captions, Chinese labels, stop/disposal
and offline module loading. See [playback contracts](../../../../docs/AirPlay.md).
