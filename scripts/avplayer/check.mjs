// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const destination = new URL('../../site/play/vendor/libmedia/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('artifacts.json', destination), 'utf8'));
const lock = JSON.parse(await readFile(new URL('wasm.lock.json', import.meta.url), 'utf8'));
if (manifest.version !== lock.version || manifest.commit !== lock.commit) throw new Error('AVPlayer source pin mismatch');
for (const artifact of manifest.artifacts) {
  const data = await readFile(new URL(artifact.path, destination));
  const digest = createHash('sha256').update(data).digest('hex');
  if (data.length !== artifact.bytes || digest !== artifact.sha256) throw new Error(`Artifact mismatch: ${artifact.path}`);
  if (artifact.path.endsWith('.wasm')) {
    const upstream = lock.assets.find(asset => asset.path === artifact.path);
    if (!upstream || upstream.sha256 !== digest) throw new Error(`WASM source mismatch: ${artifact.path}`);
    if (!WebAssembly.validate(data)) throw new Error(`Invalid WASM: ${artifact.path}`);
  }
}
console.log(`Verified ${manifest.artifacts.length} AVPlayer artifacts against source and build checksums.`);
