// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url), output = new URL('../../site/play/vendor/captions/', root);
const checking = process.argv.includes('--check');
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const dependency = lock.packages['node_modules/hls.js'];
if (dependency.version !== '1.6.19' || !dependency.integrity.startsWith('sha512-')) throw new Error('Unexpected caption dependency lock');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const generated = new Map();
for (const [entry, filename, format, globalName] of [
  ['entry.js', 'parser.js', 'esm', undefined], ['extract.js', 'extractor.js', 'iife', 'TiPlayCaptionExtractor'],
]) {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL(entry, root))], bundle: true, write: false,
    format, globalName, minify: true, target: ['chrome111', 'safari16.4'], legalComments: 'inline',
    banner: { js: '// SPDX-License-Identifier: GPL-3.0-only\n// Built from scripts/captions; see README.md and THIRD_PARTY_LICENSES.txt.' } });
  generated.set(filename, Buffer.from(bundled.outputFiles[0].contents));
}
generated.set('THIRD_PARTY_LICENSES.txt', Buffer.from('hls.js 1.6.19 — Apache-2.0\n\n' +
  await readFile(new URL('node_modules/hls.js/LICENSE', root), 'utf8')));
const archivePath = 'source/hls.js-1.6.19.tgz';
let archive;
try { archive = await readFile(new URL(archivePath, output)); } catch (_) {
  if (checking) throw new Error('Missing pinned hls.js source archive');
  const response = await fetch(dependency.resolved);
  if (!response.ok) throw new Error('Unable to retrieve pinned hls.js sources');
  archive = Buffer.from(await response.arrayBuffer());
}
if ('sha512-' + createHash('sha512').update(archive).digest('base64') !== dependency.integrity)
  throw new Error('Pinned hls.js source archive integrity mismatch');
generated.set(archivePath, archive);
const sources = [];
for (const name of ['entry.js', 'extract.js', 'package.json', 'package-lock.json', 'build.mjs'])
  sources.push({ path: name, sha256: hash(await readFile(new URL(name, root))) });
generated.set('artifacts.json', Buffer.from(JSON.stringify({ dependency: { name: 'hls.js', version: dependency.version,
  resolved: dependency.resolved, integrity: dependency.integrity }, sources,
  artifacts: [...generated].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) })) }, null, 2) + '\n'));
if (!checking) await mkdir(new URL('source/', output), { recursive: true });
for (const [name, bytes] of generated) {
  if (checking) {
    if (!(await readFile(new URL(name, output))).equals(bytes)) throw new Error(`Caption artifact differs: ${name}`);
  } else await writeFile(new URL(name, output), bytes);
}
console.log(`${checking ? 'Verified' : 'Built'} bounded embedded-caption parser and pinned corresponding sources`);
