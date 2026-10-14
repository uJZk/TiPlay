// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
async function bundle(entry, directory, filename, noticesFile) {
  const output = fileURLToPath(new URL(`../../site/play/vendor/${directory}/`, import.meta.url));
  await mkdir(output, { recursive: true });
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, format: 'esm', minify: true, target: ['chrome111', 'safari16.4'],
    outfile: `${output}/${filename}`, legalComments: 'linked', metafile: true,
  });
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
  // hls.js's source parser includes an attribution that esbuild's legal-comment filter omits.
  if (directory === 'mediabunny') {
    const cue = await readFile(new URL('node_modules/hls.js/src/utils/vttcue.ts', import.meta.url), 'utf8');
    notices += `\n===== hls.js WebVTT / Mozilla vtt.js =====\nSource: https://github.com/mozilla/vtt.js\n${cue.match(/^\/\*\*[\s\S]*?\*\//)[0]}\n`;
  }
  await writeFile(`${output}/${noticesFile}`, notices.trimEnd() + '\n');
}
await bundle('entry.js', 'videojs', 'player.min.js', 'THIRD_PARTY_LICENSES.txt');
await bundle('skin.css', 'videojs', 'skin.min.css', 'SKIN_LICENSES.txt');
await bundle('media-entry.js', 'mediabunny', 'mediabunny.min.js', 'THIRD_PARTY_LICENSES.txt');
await copyFile(new URL('node_modules/@videojs/html/LICENSE', import.meta.url), new URL('../../site/play/vendor/videojs/LICENSE', import.meta.url));
await copyFile(new URL('../../docs/licenses/dependencies/Apache-2.0.txt', import.meta.url), new URL('../../site/play/vendor/videojs/APACHE-2.0.txt', import.meta.url));
console.log('Bundled local Video.js controls, Mediabunny, SoundTouch and HLS subtitle parsers.');
