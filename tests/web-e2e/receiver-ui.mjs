// SPDX-License-Identifier: GPL-3.0-only
// Production presentation functions with real Chromium DOM/CSS and structured receiver events.
// This is a UI component harness: it does not pair, render media or claim DataChannel playback.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, closeServer } from './resources.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const source = await readFile(resolve(root, 'app.js'), 'utf8');
const extract = name => {
  const result = new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source);
  assert.ok(result, name); return result[0];
};
const fixture = `
import { airPlayContext, airPlayFailed, createReceiverNoticeTracker, videoProblemFor, videoReadyFor, videoSourceFor } from './receiver-presentation.js';
import { createBrowserNotice } from './browser-notice.js';
import { createAirPlayTrustNotification } from './airplay-trust.js';
import { createReconnectOverlay } from './reconnect.js';
import { rtcFailureSummary } from './rtc-diagnostics.js';
import { PAGE_VERSION } from './browser-diagnostics.js';
import { formatPerformanceMonitor } from './fps-window.js';
const STRINGS = ${/const STRINGS = (\{[\s\S]*?\n\});/.exec(source)[1]};
const lang = /^zh\\b/i.test(navigator.language) ? 'zh' : 'en';
const t = (key, ...args) => (STRINGS[lang][key] ?? STRINGS.en[key]).replace(/\\{(\\d)\\}/g, (_, index) => args[index]);
const $ = id => document.getElementById(id), stage = $('stage');
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
const browserNotice = createBrowserNotice($('browser-notice'), lang), receiverNotices = createReceiverNoticeTracker();
let active = true, live = false, phase = 'waiting', notice = null, status = null, config = null, unsupported = null, videoError = null;
let receiverFailure = false;
let videoStats = {}, fitRequestedAt = 0, statsVisible = false, rtcProgress = null, lastError = null, retryAt = 0;
let portalRevision = null, mediaTiming = null, session = null, attempt = 0, reconnects = 0, lastViewport = '', statsTimer;
const streamId = 1, videoPath = { path: 'component-fixture' }, link = { code: null };
const browserLocation = { update() {} }, browserAudio = { status() {}, debug() {} };
const airplayControls = { update() {}, videoActive: () => status?.airplay?.kind === 'audio' || Boolean(status?.airplay?.resource && status.airplay.outputAllowed !== false) };
const trustResponses = [], outbox = { push(event) { trustResponses.push(event); } };
const airplayTrust = createAirPlayTrustNotification($('airplay-trust'), event => outbox.push(event), lang);
const sink = { delay() {} }, timingFor = () => ({ plans() {}, started() {} });
const codecName = value => value, releaseTouches = () => {}, cancelViewport = () => {}, onResize = () => {}, keepScreenOn = () => {};
const resizeCanvas = () => {}, scheduleViewport = () => {}, reportDiagnostics = () => {}, newSessionId = () => 'component-fixture';
const connectVideo = () => { phase = 'connecting'; render(); };
const renderReconnect = createReconnectOverlay({ overlay: $('reconnect'), message: $('reconnect-message'), settings: $('reconnect-settings'), panel: $('panel'), stage, onSettings: showPortal });
${['start', 'showPortal', 'applyStatus', 'updateReceiverNotice', 'resetReceiverPresentation', 'onVideoMessage', 'render', 'renderStats', 'rtcStageText', 'rtcCandidateText', 'rtcRetryText', 'retryStatusText', 'connectionDetailsText', 'statusText'].map(extract).join('\n')}
$('stats-toggle').addEventListener('click', () => { statsVisible = !statsVisible; render(); });
$('diagnostics').addEventListener('toggle', render);
window.receiverUi = {
  reset() { resetReceiverPresentation(); browserNotice.reset(); airplayTrust.clear(); trustResponses.length = 0; config = status = unsupported = notice = videoError = null; phase = 'waiting'; live = false; active = true; $('panel').hidden = true; stage.hidden = false; render(); },
  injectStatus: applyStatus,
  trustResponses: () => trustResponses,
  componentDecoderEvent: value => onVideoMessage({ id: 1, ...value }),
  portal: showPortal,
  resume() { $('panel').hidden = true; stage.hidden = false; render(); },
  beginNewConnection() { active = false; start(); },
  snapshot: () => ({ text: $('status').textContent, hidden: $('status').hidden, waiting: !$('reconnect').hidden,
    problem: !$('browser-notice').hidden, problemText: $('browser-notice-message').textContent, live }),
};
window.receiverUi.reset();
`;
const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replace('src="app.js"', 'src="renderer-fixture.js"');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/renderer-fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixture); return; }
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    const path = resolve(root, `.${url.pathname}`);
    assert.ok(path.startsWith(resolve(root) + sep));
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
const receiver = (source, carplay, airplay, playback, revision) => ({ videoSource: source,
  receivers: { carplay: { state: carplay }, airplay: { state: airplay, ...(revision === undefined ? {} : { revision }) } }, ...(playback ? { airplay: playback } : {}) });
let browser;
const results = [];
try {
  await listen(server, '127.0.0.1');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  for (const locale of ['en-US', 'zh-CN']) for (const width of [320, 800]) {
    const context = await browser.newContext({ locale, viewport: { width, height: width === 320 ? 640 : 480 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.receiverUi);
    const state = () => page.evaluate(() => receiverUi.snapshot());
    const inject = value => page.evaluate(value => receiverUi.injectStatus(value), value);
    const video = value => page.evaluate(value => receiverUi.componentDecoderEvent(value), value);
    const reset = () => page.evaluate(() => receiverUi.reset());
    const trustLabels = locale === 'zh-CN' ? ['总是允许', '允许一次', '拒绝'] : ['Always allow', 'Allow once', 'Reject'];
    for (const verified of [true, false]) for (const mediaType of ['audio', 'mirror']) {
      for (const [action, allow, remember] of [['allow', true, true], ['once', true, false], ['reject', false, false]]) {
        const id = `trust-${verified}-${mediaType}-${action}`;
        await inject({ ...receiver('carplay', 'connected', 'listening'),
          airplayTrust: { id, verified, mediaType, name: 'Living-room iPhone with a long device name', remainingMillis: 5000 } });
        const card = page.locator('#airplay-trust');
        await card.waitFor({ state: 'visible' });
        assert.deepEqual(await card.locator('button').allTextContents(), trustLabels);
        assert.equal(await card.locator('button:visible').count(), 3);
        assert.equal(await card.locator('[data-trust-heading]').textContent(), locale === 'zh-CN'
          ? mediaType === 'audio' ? '允许 AirPlay 音频投屏？' : '允许 AirPlay 屏幕镜像？'
          : mediaType === 'audio' ? 'Allow AirPlay audio?' : 'Allow AirPlay screen mirroring?');
        assert.equal(await card.locator('[data-trust-details]').textContent(), locale === 'zh-CN'
          ? mediaType === 'audio' ? '仅播放声音，CarPlay 画面将继续显示。' : '将显示设备屏幕，暂时代替 CarPlay 画面。'
          : mediaType === 'audio' ? 'Plays audio while keeping the CarPlay picture.' : 'Shows the device screen in place of the CarPlay picture.');
        assert.doesNotMatch(await card.textContent(), /verif|identity|identif|验证|身份|校验/i);
        const layout = await card.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const detailsStyle = getComputedStyle(element.querySelector('[data-trust-details]'));
          return { cardFits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
            contentFits: element.scrollWidth <= element.clientWidth,
            detailsReadable: detailsStyle.color === getComputedStyle(element).color && Number(detailsStyle.opacity) >= .8,
            buttonsFit: [...element.querySelectorAll('button')].every(button => {
              const rect = button.getBoundingClientRect();
              return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top
                && rect.bottom <= bounds.bottom && button.scrollWidth <= button.clientWidth;
            }) };
        });
        assert.deepEqual(layout, { cardFits: true, contentFits: true, detailsReadable: true, buttonsFit: true }, `${locale} ${width}px ${mediaType} consent fits`);
        if (process.env.RECEIVER_UI_ARTIFACT_DIR && !verified && action === 'allow') {
          await mkdir(process.env.RECEIVER_UI_ARTIFACT_DIR, { recursive: true });
          await page.screenshot({ path: resolve(process.env.RECEIVER_UI_ARTIFACT_DIR, `airplay-trust-${mediaType}-${locale}-${width}.png`) });
        }
        await card.locator(`[data-trust-${action}]`).click();
        assert.equal(await card.isVisible(), false);
        assert.deepEqual(await page.evaluate(() => receiverUi.trustResponses().at(-1)), { k: 'ap-trust', id, allow, remember });
      }
    }
    await reset();
    await inject(receiver('carplay', 'connected', 'listening'));
    await video({ type: 'config', config: { epoch: 1, mode: 'carplay' } });
    assert.equal((await state()).waiting, true, 'new epoch waits for its own first frame');
    await video({ type: 'decoded', epoch: 1 });
    assert.deepEqual({ text: (await state()).text, hidden: (await state()).hidden, waiting: (await state()).waiting },
      { text: '', hidden: true, waiting: false }, 'a picture has no success message or empty status row');
    await inject(receiver('carplay', 'suspended', 'loading'));
    assert.equal((await state()).waiting, false, 'a pending borrow cannot cover the still-authoritative CarPlay picture');
    assert.equal((await state()).text, '');
    await inject(receiver(null, 'suspended', 'loading'));
    assert.equal((await state()).waiting, true, 'old CarPlay live evidence cannot hide AirPlay preparation');
    assert.match((await state()).text, locale === 'zh-CN' ? /AirPlay.*连接/ : /AirPlay.*connecting/);
    await inject(receiver('airplay', 'suspended', 'mirror'));
    await video({ type: 'config', config: { epoch: 2, mode: 'airplay-mirror' } });
    await video({ type: 'decoded', epoch: 1 });
    assert.equal((await state()).waiting, true, 'old decoder callback cannot satisfy a replacement epoch');
    await video({ type: 'decoded', epoch: 2 });
    assert.equal((await state()).text, ''); assert.equal((await state()).waiting, false);
    await inject(receiver('carplay', 'connected', 'listening'));
    assert.equal((await state()).waiting, true, 'return to CarPlay does not reuse AirPlay config/readiness');
    await video({ type: 'config', config: { epoch: 3, mode: 'carplay' } });
    await video({ type: 'decoded', epoch: 3 });
    await inject(receiver('carplay', 'connected', 'failed'));
    assert.equal((await state()).problem, false, 'background AirPlay fault does not override normal CarPlay');
    assert.equal((await state()).text, '');
    await inject(receiver(null, 'failed', 'permission'));
    assert.match((await state()).text, locale === 'zh-CN' ? /CarPlay.*失败/ : /CarPlay.*failed/);
    await inject(receiver(null, 'suspended', 'permission'));
    assert.match((await state()).text, locale === 'zh-CN' ? /本地网络访问权限/ : /local-network access/);
    await reset();
    const item = { id: 1, revision: 1, kind: 'video', resource: 'item', ready: false, playing: true, outputAllowed: true };
    await inject(receiver(null, 'suspended', 'loading', item));
    assert.match((await state()).text, locale === 'zh-CN' ? /连接/ : /connecting/);
    await inject(receiver(null, 'suspended', 'playing', { ...item, ready: true }));
    assert.equal((await state()).text, ''); assert.equal((await state()).hidden, true);
    await inject(receiver(null, 'suspended', 'paused', { ...item, ready: true, playing: false }));
    assert.match((await state()).text, locale === 'zh-CN' ? /暂停/ : /paused/);
    await inject(receiver(null, 'suspended', 'loading', { ...item, buffering: true }));
    assert.match((await state()).text, locale === 'zh-CN' ? /缓冲/ : /buffering/);
    await inject({ ...receiver(null, 'suspended', 'playback-failed'), details: 'https://private.test/media?token=secret' });
    assert.equal((await state()).problem, true);
    assert.match((await state()).problemText, locale === 'zh-CN' ? /iPhone.*重新投屏/ : /try casting again from your iPhone/);
    assert.doesNotMatch((await state()).problemText, /private|secret|https:/);
    await page.click('[data-browser-close]');
    for (let i = 0; i < 10; i++) await inject(receiver(null, 'suspended', 'playback-failed'));
    assert.equal((await state()).problem, false, 'polls cannot reopen the dismissed casting fault');
    await inject(receiver(null, 'suspended', 'loading', { ...item, id: 2, resource: 'replacement' }));
    await inject(receiver(null, 'suspended', 'playback-failed'));
    assert.equal((await state()).problem, true, 'a new resource allows a fresh actionable fault');
    await page.click('[data-browser-close]');
    await page.evaluate(() => receiverUi.beginNewConnection());
    assert.equal((await state()).problem, false);
    await inject(receiver('airplay', 'suspended', 'playback-failed'));
    assert.equal((await state()).problem, true, 'an explicit new connection resets dismissal');
    await page.click('[data-browser-close]');
    await reset();
    await inject(receiver(null, 'suspended', 'loading', { ...item, id: 20 }, 10));
    await inject(receiver(null, 'suspended', 'playback-failed', undefined, 11));
    assert.equal((await state()).problem, true);
    await page.click('[data-browser-close]');
    const replacement = { ...item, id: 21, resource: 'next', ready: true, playing: true };
    for (let i = 0; i < 3; i++) {
      await inject(receiver(null, 'suspended', 'playback-failed', replacement, 11));
      assert.equal((await state()).problem, false, 'repeating the previous publication does not fault the replacement');
      assert.equal((await state()).text, '', 'main status uses the same attributed fault as the notice');
    }
    await inject(receiver(null, 'suspended', 'playback-failed', replacement, 12));
    assert.equal((await state()).problem, true, 'a new publication proves a new same-label failure');
    assert.match((await state()).text, locale === 'zh-CN' ? /无法继续/ : /could not continue/);
    await page.click('[data-browser-close]');
    await reset();
    await inject(receiver('carplay', 'connected', 'listening'));
    await video({ type: 'config', config: { epoch: 4, mode: 'carplay' } });
    await video({ type: 'unsupported', codec: 'hvc1' });
    assert.equal((await state()).problem, true);
    await inject(receiver('carplay', 'suspended', 'loading'));
    assert.equal((await state()).problem, true, 'pending borrowing cannot retire the actual producer codec failure');
    assert.match((await state()).text, locale === 'zh-CN' ? /画面暂不可用/ : /Picture unavailable/);
    await inject(receiver(null, 'suspended', 'photo', { id: 9, kind: 'photo', resource: 'photo', outputAllowed: true }));
    assert.equal((await state()).text, '');
    assert.equal((await state()).problem, false, 'a retired codec fault cannot cover an independent photo');
    await page.evaluate(() => receiverUi.portal());
    assert.equal(await page.$eval('#diagnostics', element => element.open), false);
    await page.click('#diagnostics > summary');
    const pageVersion = await page.evaluate(async () => (await import('./browser-diagnostics.js')).PAGE_VERSION);
    await page.waitForFunction(version => document.getElementById('connection-details').textContent.split('\n')[0] === version, pageVersion);
    await page.click('#stats-toggle');
    assert.equal(await page.getAttribute('#stats-toggle', 'aria-checked'), 'true');
    await page.click('#stats-toggle');
    assert.equal(await page.getAttribute('#stats-toggle', 'aria-checked'), 'false');
    assert.equal(await page.evaluate(() => document.getElementById('panel').scrollWidth <= document.getElementById('panel').clientWidth), true);
    assert.deepEqual(errors, []);
    const record = { locale, width, checks: 'passed', trustPrompts: 12 }; results.push(record); console.log(JSON.stringify(record));
    if (process.env.RECEIVER_UI_ARTIFACT_DIR) {
      await mkdir(process.env.RECEIVER_UI_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.RECEIVER_UI_ARTIFACT_DIR, `receiver-ui-${locale}-${width}.png`) });
    }
    await context.close();
  }
  if (process.env.RECEIVER_UI_ARTIFACT_DIR) await writeFile(resolve(process.env.RECEIVER_UI_ARTIFACT_DIR, 'receiver-ui-result.json'),
    JSON.stringify({ browser: browser.version(), scope: 'Production presentation functions and actual DOM; no pairing, RTC or media playback success is claimed.', results }, null, 2) + '\n');
} finally { await browser?.close(); await closeServer(server); }
