// SPDX-License-Identifier: GPL-3.0-only
// Real Chromium permission/watch/localStorage lifecycle; no vehicle or Android sensor simulation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { listen, closeServer } from './resources.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const resources = Object.fromEntries(['geolocation.js', 'location-notice.js', 'airplay-trust.css'].map(name =>
  [`/${name}`, readFileSync(new URL(`../../site/play/${name}`, import.meta.url))]));
const html = `<!doctype html><link rel="stylesheet" href="/airplay-trust.css">
<div class="notification-stack"><aside class="tiplay-notification" id="notice" hidden>
<strong data-location-heading></strong><p class="notification-message" data-location-message></p>
<div class="airplay-trust-actions"><button data-location-close></button></div></aside></div>
<script type="module">
import { createLocationNotice } from '/location-notice.js';
const notice = createLocationNotice(document.querySelector('#notice'));
import { createBrowserLocation } from '/geolocation.js';
window.events = [];
window.tracker = createBrowserLocation({onIssue: reason => notice.show(reason), push: event => events.push(event), navigator, storage: localStorage, secure: isSecureContext});
tracker.update({enabled: true, active: true});
</script>`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(resources[req.url] ?? html);
});
let browser;
try {
  await listen(server, '127.0.0.1');
  const port = server.address().port;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--no-proxy-server'] });
  const context = await browser.newContext({ permissions: ['geolocation'],
    geolocation: { latitude: 39.9, longitude: 116.4, accuracy: 10 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => events.length > 0);
  assert.equal(await page.locator('#notice').isVisible(), false);
  assert.equal(await page.evaluate(() => events[0].datum), null);
  await page.evaluate(() => tracker.update({ enabled: true, active: true, datum: 'GCJ02' }));
  await context.setGeolocation({ latitude: 39.901, longitude: 116.4, accuracy: 10 });
  await page.waitForFunction(() => events.some(event => event.datum === 'GCJ02'));
  await page.reload();
  await page.waitForFunction(() => events.length > 0);
  assert.equal(await page.evaluate(() => events[0].datum), 'GCJ02');
  await page.evaluate(() => tracker.update({ enabled: false, active: true }));
  const count = await page.evaluate(() => events.length);
  await context.setGeolocation({ latitude: 39.902, longitude: 116.4, accuracy: 10 });
  // Allow Chromium's actual geolocation callback delivery to flush.
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await page.evaluate(() => events.length), count);
  await context.clearPermissions();
  await context.grantPermissions([], { origin: `http://127.0.0.1:${port}` });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.tracker));
  assert.equal(await page.evaluate(() => events.length), 0, 'an unapproved browser does not upload positions');
  await page.evaluate(() => tracker.update({ enabled: true, active: true }));
  await page.locator('#notice').waitFor({ state: 'visible' });
  const noticeBox = await page.locator('#notice').boundingBox();
  assert.ok(noticeBox.x <= 20 && noticeBox.y <= 20, 'notification sits in the upper left');
  await page.clock.install();
  await page.clock.runFor(10000);
  assert.equal(await page.locator('#notice').isVisible(), true, 'there is no automatic dismissal');
  await page.setViewportSize({ width: 640, height: 240 });
  await page.locator('[data-location-close]').click();
  assert.equal(await page.locator('#notice').isVisible(), false);
  await page.evaluate(() => tracker.update({ enabled: true, active: true }));
  assert.equal(await page.locator('#notice').isVisible(), false, 'dismissal survives another heartbeat');
  assert.deepEqual(errors, []);
  console.log('[geolocation-e2e] all checks passed');
} finally {
  await browser?.close();
  await closeServer(server);
}
