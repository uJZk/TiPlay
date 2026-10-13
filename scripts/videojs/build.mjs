// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../../site/play/vendor/videojs/', import.meta.url));
const result = await build({
  entryPoints: [fileURLToPath(new URL('entry.js', import.meta.url))],
  bundle: true, format: 'esm', minify: true, target: ['chrome111', 'safari16.4'],
  outfile: `${output}/player.min.js`, legalComments: 'linked', metafile: true,
});
await copyFile(new URL('node_modules/@videojs/html/LICENSE', import.meta.url), `${output}/LICENSE`);
await copyFile(new URL('../../docs/licenses/dependencies/Apache-2.0.txt', import.meta.url), `${output}/APACHE-2.0.txt`);
const packages = new Set(Object.keys(result.metafile.inputs).flatMap(path => {
  const match = path.match(/(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  return match ? [match[1]] : [];
}));
let notices = '';
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT']) {
    try { license = await readFile(`${directory}/${filename}`, 'utf8'); break; } catch {}
  }
  if (!license) throw new Error(`Missing license for ${metadata.name}`);
  notices += `\n===== ${metadata.name}@${metadata.version} (${metadata.license}) =====\n${license}\n`;
}
await writeFile(`${output}/THIRD_PARTY_LICENSES.txt`, notices);
console.log('Bundled Video.js 10.1.0 and hls.js with local licenses.');
