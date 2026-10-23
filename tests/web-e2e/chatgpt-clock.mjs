// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(fileURLToPath(new URL('../../site/play/chatgpt/', import.meta.url)));
const files = ['index.html', 'app.js', 'analysis.js', 'probe-worklet.js', 'style.css', 'report-share.js', 'qr.js', 'vendor/qrcode-generator.js'];
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await readFile(resolve(root, name)))])));
const before = await identity(), external = [], errors = [], consoleErrors = [], serverPaths = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    serverPaths.push(request.url);
    const path = resolve(root, url.pathname === '/chatgpt/' ? 'index.html' : url.pathname.replace(/^\/chatgpt\//, ''));
    if (!path.startsWith(root + sep) || !url.pathname.startsWith('/chatgpt/')) throw new Error('Path');
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/plain', 'Cache-Control': 'no-store' });
    response.end(await readFile(path));
  } catch (_) { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width:1280,height:720 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(() => {
    globalThis.WebAssembly = undefined;
    const Original = globalThis.AudioContext;
    globalThis.__labContexts = [];
    globalThis.AudioContext = class extends Original { constructor(options) { super(options); globalThis.__labContexts.push(this); } };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${origin}/chatgpt/`);
  const duration = Number(process.env.CLOCK_LAB_DURATION || 90);
  if (duration !== 90) await page.getByLabel('时长').selectOption(String(duration));
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await page.waitForFunction(() => globalThis.__clockLabResult?.completion === '已完成', null, { timeout: 110000 });
  const result = await page.evaluate(() => globalThis.__clockLabResult);
  assert.equal(result.durationSeconds, duration); assert.ok(result.elapsedMs >= duration * 1000);
  assert.ok(result.samples.length > duration * 30 && result.samples.length <= 30000);
  assert.ok(result.reports.length > duration * 5 && result.probes.length > duration);
  assert.deepEqual(result.caps, {});
  for (const phase of result.summary.phases) {
    assert.ok(phase.samples > duration * 5, `${phase.name}: bounded foreground samples`);
    assert.ok(phase.probes > duration / 6, `${phase.name}: process-event probes`);
    assert.ok(phase.getter?.spanMs > duration * 1000 / 3 - 1500);
    assert.ok(phase.frames?.minimumSpanMs > duration * 1000 / 3 - 1500);
  }
  assert.ok(result.summary.phases[1].loadTasks > duration);
  assert.equal(result.summary.phases[0].loadTasks, 0); assert.equal(result.summary.phases[2].loadTasks, 0);
  assert.equal(await page.evaluate(() => __labContexts[0].state), 'closed');
  assert.equal(await page.evaluate(() => typeof WebAssembly), 'undefined');
  await page.getByRole('button', {name:'大字结果卡 · 拍照'}).click();
  assert.equal(await page.locator('#photo-dialog').evaluate(node => node.open),true);
  assert.match(await page.locator('#photo-content').innerText(),/选段/);
  if (process.env.CLOCK_LAB_IMAGES) await page.screenshot({path:resolve(process.env.CLOCK_LAB_IMAGES,'v2-photo-card.png')});
  await page.getByRole('button',{name:'关闭结果卡'}).click();
  await page.getByRole('button',{name:'手机扫码取摘要',exact:true}).click();
  await page.waitForFunction(() => typeof globalThis.__clockLabShareUrl === 'string');
  const shareUrl = await page.evaluate(() => globalThis.__clockLabShareUrl);
  assert.ok(shareUrl.length <= 1900);
  if (process.env.CLOCK_LAB_IMAGES) {
    const png = await page.locator('#qr-canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
    await writeFile(resolve(process.env.CLOCK_LAB_IMAGES,'v2-qr-canvas.png'),Buffer.from(png,'base64'));
    await page.screenshot({path:resolve(process.env.CLOCK_LAB_IMAGES,'v2-qr-screen.png')});
  }
  const phone = await context.newPage();
  phone.on('pageerror',error => errors.push(error.message));
  await phone.goto(shareUrl);
  await phone.waitForFunction(() => globalThis.__clockLabReceivedReport?.rawIncluded === false);
  const received = await phone.evaluate(() => globalThis.__clockLabReceivedReport);
  assert.equal(await phone.evaluate(() => __labContexts.length),0,'importing a phone summary cannot start audio');
  assert.equal(received.labVersion,result.version); assert.equal(received.actualRate,result.rate);
  assert.equal(received.phases[0].actualFrameDelta,result.summary.phases[0].frames.actualFrameDelta);
  assert.equal(received.phases[0].getterDifferenceMs,Math.round(result.summary.phases[0].getter.differenceMs * 1000) / 1000);
  const [summaryDownload] = await Promise.all([phone.waitForEvent('download'),phone.getByRole('button',{name:'手机保存摘要 JSON'}).click()]);
  const summaryBytes = JSON.parse(await readFile(await summaryDownload.path(),'utf8'));
  assert.equal(summaryBytes.rawIncluded,false); assert.equal(summaryBytes.type,'TiPlay-clock-summary');
  assert.equal(Object.hasOwn(summaryBytes,'_wire'),false);
  await phone.goto(`${origin}/chatgpt/?v=2#clock-report=2.j.invalid`);
  await phone.getByText(/无法读取摘要/).waitFor();
  assert.equal(await phone.evaluate(() => __labContexts.length),0);
  await phone.evaluate(() => { location.hash = ''; });
  await phone.waitForFunction(() => document.getElementById('received').hidden && !document.getElementById('setup').hidden);
  assert.equal(await phone.evaluate(() => __labContexts.length),0);
  await phone.close();
  await page.getByRole('button',{name:'关闭二维码'}).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出 JSON' }).click()]);
  const downloadBytes = await readFile(await download.path());
  assert.equal(JSON.parse(downloadBytes).version, result.version);
  await page.getByLabel('上下文采样率').selectOption('44100');
  await page.getByLabel('时长').selectOption('15');
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await page.waitForFunction(() => __labContexts.length === 2 && __labContexts[1].state === 'running');
  await page.getByRole('button', { name: '刚才有爆音' }).click();
  await page.getByLabel('低音量测试音').uncheck();
  await page.getByRole('button', { name: '提前停止' }).click();
  await page.waitForFunction(() => globalThis.__clockLabResult?.completion === '已提前停止');
  const stopped = await page.evaluate(() => globalThis.__clockLabResult);
  assert.equal(stopped.requestedRate, 44100); assert.equal(stopped.rate, 44100);
  assert.equal(stopped.summary.marks.length, 1);
  assert.equal(await page.evaluate(() => __labContexts[1].state), 'closed');
  const after = await identity(); assert.deepEqual(after, before);
  assert.equal(serverPaths.some(path => path.includes('clock-report=')),false);
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(external, []);
  const output = { browser: await browser.version(), source: before,
    summary: result.summary, elapsedMs: result.elapsedMs, requestedRate: result.requestedRate, actualRate: result.rate,
    exportBytes: downloadBytes.length, stoppedAndRestarted: true, secondRate: stopped.rate,
    shareUrl, summaryImportedWithoutAudio: true, summaryExportBytes: JSON.stringify(summaryBytes).length,
    fragmentSentToServer: serverPaths.some(path => path.includes('clock-report=')),
    pageErrors: errors, consoleErrors, externalRequests: external, physicalOutputMeasured: false };
  if (process.env.CLOCK_LAB_RESULT) await writeFile(process.env.CLOCK_LAB_RESULT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
