# Video.js controls and media adapter

Self-hosted ESM controls and official default-skin CSS from the official Video.js
HTML and media packages (Apache-2.0). TiPlay's native-like media adapter exposes
libmedia AVPlayer's Canvas/Web Audio playback engine to these controls.

Source: https://github.com/videojs/video.js
Version-matched migration documentation is bundled in `@videojs/html/docs/`.

The owned [build inputs](../../../../scripts/videojs/) and npm lockfile pin all packages
and published tarball integrity. npm verifies that integrity during `npm ci`.
`player.min.js` registers only the required player and UI components, with the
Chinese locale included. There are no runtime CDN dependencies. The reproducible build replaces only the three
version-pinned native-video capability probes for PiP, fullscreen and volume with
unsupported results: these controls are absent from TiPlay, and their upstream
probes otherwise create detached video elements. Other official feature code and
the media adapter remain unchanged. The build fails if a probe changes, the three
expected modules are not patched, or the output still creates a video element. `LICENSE`,
`APACHE-2.0.txt`, `THIRD_PARTY_LICENSES.txt` and `player.min.js.LEGAL.txt` retain licenses and notices.
`videojs-player.js` uses the official default skin's container, backdrop, controls
and time-slider groups, plus Video.js single-tap controls and accessible seek buttons
for ±10 seconds. Double-clicking or double-tapping the picture does not seek. The casting
end action uses the same `media-button` style. `airplay-controls.css` handles
Canvas placement and narrow layouts; page button styles exclude the player.
URL playback dependencies are built separately under [libmedia](../libmedia/README.md).

Rebuild with Node 22:

```sh
npm ci --prefix scripts/videojs
npm run build --prefix scripts/videojs
```

When updating, choose explicit versions, regenerate the lockfile and bundle, bump the
service-worker cache and update its complete asset list. Verify MP4/HLS, Canvas rendering,
iPhone play/pause/seek/status, Bluetooth mute, captions, Chinese labels, stop/disposal
and offline module loading. See [playback contracts](../../../../docs/AirPlay.md).
