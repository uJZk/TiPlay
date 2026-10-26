// SPDX-License-Identifier: GPL-3.0-only
// These native-media capabilities have no controls in TiPlay's Canvas player.
// Patch only the three version-pinned upstream probes; retain all other feature code.
const probes = {
  '/presentation/pip.js': ['isPictureInPictureEnabled', 'false'],
  '/presentation/fullscreen.js': ['isFullscreenEnabled', 'false'],
  '/store/features/volume.js': ['canSetVolume', '"unsupported"'],
};
export function disableNativeVideoProbe(source, path) {
  const entry = Object.entries(probes).find(([suffix]) => path.replaceAll('\\', '/').endsWith(suffix));
  if (!entry) throw new Error(`Unexpected native-media probe module: ${path}`);
  const [name, result] = entry[1];
  const start = source.indexOf(`function ${name}() {`);
  if (start < 0 || source.indexOf(`function ${name}() {`, start + 1) >= 0)
    throw new Error(`Version-pinned probe function changed: ${path}`);
  // Each pinned function ends immediately before its following module comment.
  const end = source.indexOf('\n}\n', start);
  const original = source.slice(start, end + 2);
  if (end < start || !original.includes('document.createElement("video")'))
    throw new Error(`Version-pinned native video probe changed: ${path}`);
  return source.slice(0, start) + `function ${name}() { return ${result}; }` + source.slice(end + 2);
}
export function nativeVideoProbePlugin(patched) {
  return { name: 'tiplay-canvas-controls', setup(build) {
    build.onLoad({ filter: /[/\\]@videojs[/\\]core[/\\]dist[/\\]default[/\\]dom[/\\](?:presentation[/\\](?:pip|fullscreen)|store[/\\]features[/\\]volume)\.js$/ }, async args => {
      const { readFile } = await import('node:fs/promises');
      const source = await readFile(args.path, 'utf8');
      patched.add(args.path);
      return { contents: disableNativeVideoProbe(source, args.path), loader: 'js' };
    });
  } };
}
