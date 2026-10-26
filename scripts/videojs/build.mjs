// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { nativeVideoProbePlugin } from './native-video-probes.mjs';
async function bundle(entry, directory, filename, noticesFile) {
  const output = fileURLToPath(new URL(`../../site/play/vendor/${directory}/`, import.meta.url));
  await mkdir(output, { recursive: true });
  const canvasControls = filename === 'player.min.js', patched = new Set();
  const result = await build({
    plugins: canvasControls ? [nativeVideoProbePlugin(patched)] : [],
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, format: 'esm', minify: true, target: ['chrome111', 'safari16.4'],
    outfile: `${output}/${filename}`, legalComments: 'linked', metafile: true,
  });
  if (canvasControls) {
    if (patched.size !== 3) throw new Error(`Expected three pinned native-video probes; patched ${patched.size}`);
    const bundled = await readFile(`${output}/${filename}`, 'utf8');
    if (/createElement(?:NS)?\s*\([^)]*["']video["']/.test(bundled))
      throw new Error('Canvas controls bundle still creates a native video element');
  }
  const packages = new Set(Object.keys(result.metafile.inputs).flatMap(path => {
    if (path.startsWith('(disabled):')) return [];
    const match = path.match(/(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    return match ? [match[1]] : [];
  }));
  let notices = '';
  for (const dependency of [...packages].sort()) {
    const metadata = JSON.parse(await readFile(`${dependency}/package.json`, 'utf8'));
    let license;
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT']) {
      try { license = await readFile(`${dependency}/${name}`, 'utf8'); break; } catch {}
    }
    if (!license) throw new Error(`Missing license for ${metadata.name}`);
    notices += `\n===== ${metadata.name}@${metadata.version} (${metadata.license}) =====\n${license}\n`;
  }
  await writeFile(`${output}/${noticesFile}`, notices.trimEnd() + '\n');
}
await bundle('entry.js', 'videojs', 'player.min.js', 'THIRD_PARTY_LICENSES.txt');
await bundle('skin.css', 'videojs', 'skin.min.css', 'SKIN_LICENSES.txt');
await copyFile(new URL('node_modules/@videojs/html/LICENSE', import.meta.url), new URL('../../site/play/vendor/videojs/LICENSE', import.meta.url));
await copyFile(new URL('../../docs/licenses/dependencies/Apache-2.0.txt', import.meta.url), new URL('../../site/play/vendor/videojs/APACHE-2.0.txt', import.meta.url));
console.log('Bundled local Video.js controls and skin; AVPlayer owns URL playback.');
