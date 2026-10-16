// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const pageRoot = resolve(repo, 'site/play'), fixtureRoot = resolve(repo, 'tests/web/fixtures'), e2eRoot = resolve(repo, 'tests/web-e2e');
const index = await readFile(resolve(pageRoot, 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)?.[1];
assert.ok(csp && !csp.split(/\s+/).includes("'unsafe-eval'"), 'Use the exact production CSP without JavaScript eval');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp4': 'video/mp4' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceIdentity() {
  const paths = (await readdir(pageRoot)).filter(path => path.endsWith('.js')).sort();
  paths.push('index.html', 'vendor/soxr/soxr.asm.js');
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(resolve(pageRoot, path)))])));
}
const before = await sourceIdentity(), servedAssets = {}, pageErrors = [], externalRequests = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const [root, relative] = url.pathname === '/' ? [e2eRoot, 'media-clock.html']
      : url.pathname.startsWith('/play/') ? [pageRoot, url.pathname.slice(6)]
        : url.pathname.startsWith('/fixtures/') ? [fixtureRoot, url.pathname.slice(10)]
          : url.pathname.startsWith('/e2e/') ? [e2eRoot, url.pathname.slice(5)] : [null];
    if (!root) throw new Error('Unknown fixture route');
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const bytes = await readFile(path);
    servedAssets[url.pathname] = hash(bytes);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking'] });
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    externalRequests.push(url.href); return route.abort();
  });
  await context.addInitScript(() => { globalThis.WebAssembly = undefined; });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  await page.goto(origin);
  await page.waitForFunction(() => globalThis.__audioProbeReady === true, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Start media clock check' }).click();
  await page.waitForFunction(() => globalThis.__audioProbeResult?.done, null, { timeout: 30000 });
  const result = await page.evaluate(() => globalThis.__audioProbeResult);
  const after = await sourceIdentity(), changed = Object.keys(before).filter(path => before[path] !== after[path]);
  const identity = { before, after, changed, servedAssets, csp };
  if (process.env.MEDIA_CLOCK_RESULT) await writeFile(process.env.MEDIA_CLOCK_RESULT, JSON.stringify({ result, identity }, null, 2) + '\n');
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(pageErrors, [], 'No browser/worker JavaScript errors');
  assert.deepEqual(externalRequests, [], 'Every media/asset request remains loopback');
  assert.equal(await page.evaluate(() => typeof WebAssembly), 'undefined');
  assert.ok(Object.keys(servedAssets).every(path => !path.endsWith('.wasm')), 'No runtime WASM asset');
  assert.deepEqual(changed, [], 'Runtime source remained unchanged throughout the check');
  console.log(JSON.stringify({ browser: await browser.version(), summary: result.summary,
    workers: result.workers, sourceSha256: hash(JSON.stringify(before)), sourceFiles: Object.keys(before).length,
    physicalOutputMeasured: false }, null, 2));
} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
