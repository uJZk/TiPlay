// SPDX-License-Identifier: GPL-3.0-only
// Production audio controls/CSS under the shipped page CSP. Synthetic metadata and artwork;
// this checks browser presentation/control delivery, not AirPlay negotiation or speaker output.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, closeServer } from './resources.mjs';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url));
const output = process.env.NOW_PLAYING_ARTIFACT_DIR || '/tmp/tiplay-now-playing';
const artwork = new Map(), slowResponses = [], resourceRequests = [];
let observeSlow = null;
async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 5000); })]);
  } finally { clearTimeout(timer); }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const syntheticCover = replacement => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${replacement ? '#4a2864' : '#1a3269'}"/><stop offset="1" stop-color="#102346"/></linearGradient>
  <linearGradient id="sun" x2="1" y2="1"><stop stop-color="#ffbe9e"/><stop offset="1" stop-color="#ed6d96"/></linearGradient></defs>
  <rect width="640" height="640" fill="url(#bg)"/><circle cx="350" cy="265" r="170" fill="url(#sun)"/>
  <path d="M0 380Q180 320 360 390T700 365V640H0Z" fill="#8797bd"/><path d="M0 450Q200 365 400 455T700 420V640H0Z" fill="#334e86"/>
  <text x="48" y="77" fill="#fff" font-family="sans-serif" font-size="25" letter-spacing="5">TIPLAY DEMO</text>
  <text x="48" y="550" fill="#fff" font-family="sans-serif" font-size="42" font-weight="bold">${replacement ? 'AFTERGLOW' : 'OCEAN DRIVE'}</text>
  <text x="50" y="589" fill="#dde7ff" font-family="sans-serif" font-size="19" letter-spacing="3">SYNTHETIC ARTWORK</text></svg>`;

const fixture = `
import { createAirPlayControls } from './airplay-controls.js';
const language = /^zh\\b/i.test(navigator.language) ? 'zh' : 'en';
const stage = document.getElementById('stage');
document.getElementById('panel').hidden = true; stage.hidden = false;
const canvas = document.getElementById('screen');
canvas.width = innerWidth; canvas.height = innerHeight;
const paint = canvas.getContext('2d'); paint.fillStyle = '#11203b'; paint.fillRect(0, 0, canvas.width, canvas.height);
const sent = [], fetched = [], cancelledBodies = [], urls = { created: [], revoked: [] };
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = value => { const url = create(value); urls.created.push(url); return url; };
URL.revokeObjectURL = url => { urls.revoked.push(url); revoke(url); };
let state = { id: 77, revision: 1, kind: 'audio', position: 121, duration: 245, playing: true,
  ready: true, buffering: false, outputAllowed: true, seekable: false, remotePending: false, controls: ['play', 'pause', 'stop', 'skip-back', 'skip-forward', 'previous', 'next'],
  title: language === 'zh' ? '海风慢行 · 演示曲目' : 'Ocean Drive · sample track',
  artist: language === 'zh' ? 'TiPlay 示例艺人' : 'TiPlay synthetic artist',
  album: language === 'zh' ? '演示专辑' : 'Demonstration album', artworkResource: 'audio-art-demo' };
if (innerHeight <= 360) {
  state.title += language === 'zh' ? ' · 用于检查短屏适配的较长标题示例' : ' — a long title for the short-display layout check';
  state.artist += ' · Synthetic artist with an intentionally long name';
  state.album += ' · A long synthetic album name';
}
const tracks = [
  { title: state.title, artist: state.artist, artworkResource: 'audio-art-demo' },
  { title: language === 'zh' ? '暮色 · 下一首演示曲目' : 'Afterglow · next sample track',
    artist: language === 'zh' ? '下一位示例艺人' : 'Next synthetic artist', artworkResource: 'audio-art-next' },
];
let trackIndex = 0, holdConfirmation = false, pendingConfirmation = null;
const confirmState = next => {
  if (holdConfirmation) {
    pendingConfirmation = { ...next, remotePending: false };
    state = { ...state, remotePending: true }; controls.update(state); return;
  }
  state = { ...next, remotePending: false }; controls.update(state);
};
const controls = createAirPlayControls(stage, event => {
  sent.push(event);
  if (event.k === 'ap' && ['play', 'pause'].includes(event.a)) {
    state = { ...state, playing: event.a === 'play', revision: state.revision + 1 }; controls.update(state);
  } else if (event.k === 'ap' && ['skip-back', 'skip-forward'].includes(event.a)) {
    confirmState({ ...state, position: Math.max(0, Math.min(state.duration, state.position + (event.a === 'skip-back' ? -10 : 10))), revision: state.revision + 1 });
  } else if (event.k === 'ap' && ['previous', 'next'].includes(event.a)) {
    trackIndex = (trackIndex + (event.a === 'next' ? 1 : -1) + tracks.length) % tracks.length;
    confirmState({ ...state, ...tracks[trackIndex], position: 0, revision: state.revision + 1 });
  }
}, language, {
  host: () => location.host, credentials: () => ({ code: 'fixture-token', session: 'now-playing-fixture' }),
  async fetchPhone(route, init) {
    fetched.push(route); const response = await fetch(route, init);
    if (response.body) {
      const cancel = response.body.cancel.bind(response.body);
      response.body.cancel = (...args) => { cancelledBodies.push(route); return cancel(...args); };
    }
    return response;
  },
});
const controlStyles = surface => Object.fromEntries(['media-play-button', '.airplay-stop'].map(selector => {
  const element = surface.querySelector(selector), style = getComputedStyle(element);
  return [selector, Object.fromEntries(['width', 'height', 'padding', 'borderWidth', 'borderRadius', 'backgroundColor', 'fontFamily', 'fontSize'].map(name => [name, style[name]]))];
}));
window.nowPlaying = {
  update(patch) { state = { ...state, ...patch, revision: state.revision + 1 }; controls.update(state); },
  carplay(running) { controls.setCarPlayRunning(running); },
  clear() { controls.update(null); }, dispose() { controls.dispose(); },
  holdConfirmation() { holdConfirmation = true; },
  confirm() { holdConfirmation = false; const next = pendingConfirmation; pendingConfirmation = null; if (next) confirmState(next); },
  snapshot: () => ({ sent, fetched, cancelledBodies, urls, state }),
  controlStyles: () => controlStyles(stage.querySelector('.airplay-audio-surface')),
  async videoControlStyles() {
    const { createVideoPlayer } = await import('./videojs-player.js');
    const reference = document.createElement('div'); reference.className = 'airplay-player';
    Object.assign(reference.style, { position: 'fixed', left: '-3000px', width: innerWidth + 'px', height: innerHeight + 'px' });
    document.body.append(reference);
    const player = createVideoPlayer(reference, { lang: language, stop() {}, stopText: 'Stop casting' });
    await new Promise(requestAnimationFrame);
    const result = controlStyles(player.surface); player.dispose(); reference.remove(); return result;
  },
};
controls.update(state);
`;
const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replace('src="app.js"', 'src="now-playing-fixture.js"');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/synthetic-cover.svg') {
      response.setHeader('Content-Type', 'image/svg+xml'); response.end(syntheticCover(url.searchParams.has('replacement'))); return;
    }
    if (url.pathname === '/now-playing-fixture.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(fixture); return;
    }
    if (url.pathname === '/airplay-resource') {
      assert.equal(url.searchParams.get('id'), '77');
      assert.equal(url.searchParams.get('c'), 'fixture-token');
      assert.equal(url.searchParams.get('s'), 'now-playing-fixture');
      const resource = url.searchParams.get('r'); resourceRequests.push(resource);
      if (resource === 'audio-art-slow') { slowResponses.push(response); observeSlow?.(); return; }
      response.setHeader('Content-Type', resource === 'audio-art-invalid' ? 'image/svg+xml' : 'image/png');
      response.end(resource === 'audio-art-invalid' ? syntheticCover(false) : artwork.get(resource) || artwork.get('audio-art-demo')); return;
    }
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    const path = resolve(root, `.${url.pathname}`); assert.ok(path.startsWith(resolve(root) + sep));
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});

let browser;
const results = [];
try {
  await mkdir(output, { recursive: true });
  await listen(server, '127.0.0.1');
  const address = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  // Rasterize original vector artwork locally; production accepts PNG/JPEG only.
  const artPage = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  for (const replacement of [false, true]) {
    await artPage.goto(`${address}/synthetic-cover.svg${replacement ? '?replacement=1' : ''}`);
    await artPage.locator('svg').waitFor();
    artwork.set(replacement ? 'audio-art-next' : 'audio-art-demo', await artPage.screenshot());
  }
  await artPage.close();
  for (const locale of ['en-US', 'zh-CN']) for (const [width, height] of [[320, 640], [800, 480], [1440, 900], [800, 320]]) {
    const context = await browser.newContext({ locale, viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [], violations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('recordPolicyViolation', value => violations.push(value));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => {
      window.recordPolicyViolation({ directive: event.effectiveDirective, blocked: event.blockedURI });
    }));
    await page.goto(address);
    await page.waitForFunction(() => window.nowPlaying);
    const snapshot = () => page.evaluate(() => nowPlaying.snapshot());
    const update = patch => page.evaluate(patch => nowPlaying.update(patch), patch);
    const remoteSelectors = ['media-seek-button[seconds="-10"]', 'media-seek-button[seconds="10"]', '.airplay-previous', '.airplay-next'];
    const remotePending = async pending => {
      assert.equal((await snapshot()).state.remotePending, pending);
      const mark = (await snapshot()).sent.length;
      for (const selector of remoteSelectors) {
        const disabled = await page.locator(selector).evaluate(element => ({ native: element.hasAttribute('disabled'), aria: element.getAttribute('aria-disabled') }));
        assert.equal(disabled.native, pending);
        if (pending) assert.equal(disabled.aria, 'true');
        else assert.notEqual(disabled.aria, 'true', 'the official element may remove aria-disabled when enabled');
        if (pending) await page.locator(selector).evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      }
      if (pending) assert.equal((await snapshot()).sent.length, mark, 'one pending source command disables all four remote actions, including forced clicks');
    };
    const showControls = async () => {
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.move(width / 2, height - 24);
    };
    const liveUrls = async () => {
      const { urls } = await snapshot(); return urls.created.filter(url => !urls.revoked.includes(url));
    };
    await page.waitForFunction(() => document.querySelector('.airplay-now-playing img')?.naturalWidth > 0);
    const title = (await snapshot()).state.title;
    const artist = (await snapshot()).state.artist.trim();
    assert.ok((await page.locator('.airplay-now-playing').textContent()).includes(title));
    assert.equal(await page.locator('.airplay-audio-artist').textContent(), artist);
    assert.equal(await page.locator('.airplay-audio-artist').isVisible(), true);
    assert.equal(await page.locator('.airplay-audio-title').evaluate(element => getComputedStyle(element).textAlign), 'start');
    assert.equal(await page.locator('.airplay-photo-stop').count(), 0, 'no floating End Casting control remains');
    await showControls();
    assert.equal(await page.locator('.airplay-audio-surface .video-controls-primary').count(), 1, 'audio reuses the existing Video.js toolbar');
    assert.equal(await page.locator('.airplay-audio-actions, .airplay-audio-times').count(), 0, 'no custom audio control row remains');
    assert.deepEqual(await page.evaluate(() => nowPlaying.controlStyles()), await page.evaluate(() => nowPlaying.videoControlStyles()),
      'audio play/stop use the standard video toolbar dimensions and styles');
    const layout = await page.locator('.airplay-audio-surface').evaluate(element => {
      const area = element.getBoundingClientRect(), card = element.querySelector('.airplay-now-playing');
      return { fits: area.left >= 0 && area.top >= 0 && area.right <= innerWidth && area.bottom <= innerHeight,
        noOverflow: element.scrollWidth <= element.clientWidth && card.scrollWidth <= card.clientWidth,
        controls: [...element.querySelectorAll('media-play-button, media-time-slider, media-seek-button, .airplay-previous, .airplay-next, .airplay-stop')].every(control => {
          const rect = control.getBoundingClientRect(); return rect.width > 0 && rect.height > 0
            && rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= area.bottom;
        }) };
    });
    assert.deepEqual(layout, { fits: true, noOverflow: true, controls: true });
    assert.equal((await liveUrls()).length, 1);
    await showControls();
    await page.screenshot({ path: resolve(output, `now-playing-${locale}-${width}x${height}.png`) });

    await page.locator('media-play-button').click();
    await page.waitForFunction(() => nowPlaying.snapshot().sent.some(event => event.k === 'ap' && event.a === 'pause'));
    await page.locator('media-play-button').click();
    await page.waitForFunction(() => nowPlaying.snapshot().sent.some(event => event.k === 'ap' && event.a === 'play'));
    assert.equal(await page.locator('media-time-slider').getAttribute('aria-disabled'), 'true');
    for (const [position, direction, target] of [[121, -10, 111], [111, 10, 121], [3, -10, 0], [242, 10, 245]]) {
      await update({ position });
      await page.evaluate(() => nowPlaying.holdConfirmation());
      const sourceTime = await page.locator('media-time[type="current"]').textContent();
      await page.locator(`media-seek-button[seconds="${direction}"]`).click();
      const command = (await snapshot()).sent.filter(event => event.k === 'ap').at(-1);
      assert.deepEqual(command, { k: 'ap', id: 77, a: direction < 0 ? 'skip-back' : 'skip-forward' }, 'relative skips carry no browser-computed timestamp');
      await remotePending(true);
      assert.equal((await snapshot()).state.position, position, 'pending skip cannot change sender progress');
      assert.equal(await page.locator('media-time[type="current"]').textContent(), sourceTime, 'the UI waits for the source timeline');
      await page.evaluate(() => nowPlaying.confirm());
      await remotePending(false);
      assert.equal((await snapshot()).state.position, target, 'progress follows the synthetic sender confirmation');
      const expectedTime = `${Math.floor(target / 60)}:${String(target % 60).padStart(2, '0')}`;
      await page.waitForFunction(expected => document.querySelector('media-time[type="current"]')?.textContent.trim() === expected, expectedTime);
    }
    for (const [action, expectedTitle] of [['next', locale === 'zh-CN' ? '暮色 · 下一首演示曲目' : 'Afterglow · next sample track'], ['previous', title]]) {
      const currentTitle = await page.locator('.airplay-audio-title').textContent();
      await page.evaluate(() => nowPlaying.holdConfirmation());
      await page.locator(`.airplay-${action}`).click();
      assert.deepEqual((await snapshot()).sent.filter(event => event.k === 'ap').at(-1), { k: 'ap', id: 77, a: action });
      await remotePending(true);
      assert.equal(await page.locator('.airplay-audio-title').textContent(), currentTitle, 'track commands wait for source metadata');
      await page.evaluate(() => nowPlaying.confirm());
      await remotePending(false);
      assert.equal(await page.locator('.airplay-audio-title').textContent(), expectedTitle, 'track commands receive confirmed sender metadata');
      assert.equal(await page.locator('.airplay-audio-artist').textContent(), action === 'next'
        ? locale === 'zh-CN' ? '下一位示例艺人' : 'Next synthetic artist' : artist);
    }
    await page.waitForFunction(() => document.querySelector('.airplay-artwork')?.naturalWidth > 0
      && nowPlaying.snapshot().urls.created.some(url => !nowPlaying.snapshot().urls.revoked.includes(url)));
    await update({ controls: ['stop'], seekable: false });
    assert.equal(await page.locator('media-play-button').getAttribute('aria-disabled'), 'true');
    assert.equal(await page.locator('media-time-slider').getAttribute('aria-disabled'), 'true');
    const unsupportedMark = (await snapshot()).sent.length;
    for (const selector of ['media-play-button', 'media-seek-button[seconds="-10"]', 'media-seek-button[seconds="10"]', '.airplay-previous', '.airplay-next']) {
      assert.equal(await page.locator(selector).getAttribute('aria-disabled'), 'true');
      await page.locator(selector).evaluate(element => element.click());
    }
    await page.locator('media-time-slider').click({ force: true });
    assert.equal((await snapshot()).sent.length, unsupportedMark, 'unsupported controls cannot send commands');
    assert.equal((await snapshot()).sent.some(event => event.k === 'ap' && ['seek', 'rate'].includes(event.a)), false);
    await update({ controls: ['play', 'pause', 'stop', 'skip-back', 'skip-forward', 'previous', 'next'], seekable: false, position: 121 });

    const initialUrl = (await liveUrls())[0];
    const nextArtist = locale === 'zh-CN' ? '另一位示例艺人' : 'Another synthetic artist';
    await update({ artworkResource: 'audio-art-next', title: locale === 'zh-CN' ? '暮色 · 演示曲目' : 'Afterglow · sample track', artist: `  ${nextArtist}  ` });
    await page.waitForFunction(url => nowPlaying.snapshot().urls.revoked.includes(url), initialUrl);
    await page.waitForFunction(() => document.querySelector('.airplay-now-playing img')?.naturalWidth > 0);
    assert.equal((await liveUrls()).length, 1, 'replacement retires the previous artwork URL');
    assert.equal(await page.locator('.airplay-audio-artist').textContent(), nextArtist, 'new tracks replace and trim the sender artist');
    for (const missingArtist of [null, '', ' \n\t ']) {
      await update({ artist: missingArtist });
      assert.equal(await page.locator('.airplay-audio-artist').textContent(), '', 'missing artist never retains a previous name');
      assert.equal(await page.locator('.airplay-audio-artist').isVisible(), false);
      assert.equal(await page.locator('.airplay-audio-artist').evaluate(element => getComputedStyle(element).display), 'none', 'missing artist leaves no empty row');
    }

    const slowMark = resourceRequests.filter(resource => resource === 'audio-art-slow').length;
    const slowObserved = new Promise(resolve => { observeSlow = resolve; });
    await update({ artworkResource: 'audio-art-slow' });
    await bounded(slowObserved, 'Artwork request never started');
    observeSlow = null;
    assert.equal(resourceRequests.filter(resource => resource === 'audio-art-slow').length, slowMark + 1);
    await update({ artworkResource: 'audio-art-demo', title, artist });
    for (const response of slowResponses.splice(0)) { response.setHeader('Content-Type', 'image/png'); response.end(artwork.get('audio-art-next')); }
    await page.waitForFunction(title => document.querySelector('.airplay-now-playing')?.textContent.includes(title)
      && document.querySelector('.airplay-now-playing img')?.naturalWidth > 0, title);
    assert.equal((await liveUrls()).length, 1, 'late artwork cannot leak a retired URL');

    for (let count = 0; count < 3; count++) {
      const before = (await snapshot()).sent.length;
      await page.evaluate(() => nowPlaying.carplay(true));
      assert.equal(await page.locator('.airplay-now-playing').isVisible(), false, 'running CarPlay keeps the music UI hidden');
      assert.equal((await snapshot()).sent.length, before, 'hiding UI never stops or pauses audio');
      await page.evaluate(() => nowPlaying.carplay(false));
      assert.equal(await page.locator('.airplay-now-playing').isVisible(), true);
      assert.ok((await page.locator('.airplay-now-playing').textContent()).includes(title));
      assert.equal(await page.locator('.airplay-audio-artist').textContent(), artist);
      assert.ok((await liveUrls()).length <= 1);
    }
    await update({ artworkResource: null });
    await page.waitForFunction(() => nowPlaying.snapshot().urls.created.every(url => nowPlaying.snapshot().urls.revoked.includes(url)));
    assert.equal(await page.locator('.airplay-artwork-placeholder').isVisible(), true);
    assert.equal(await page.locator('.airplay-artwork').isVisible(), false);
    await showControls();
    await page.screenshot({ path: resolve(output, `now-playing-fallback-${locale}-${width}x${height}.png`) });
    const invalidResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('r') === 'audio-art-invalid');
    await update({ artworkResource: 'audio-art-invalid' });
    await invalidResponse;
    await page.waitForFunction(() => nowPlaying.snapshot().cancelledBodies.some(route => new URL(route, location.href).searchParams.get('r') === 'audio-art-invalid'));
    assert.equal((await liveUrls()).length, 0, 'unsupported artwork MIME never becomes an object URL');
    await page.locator('.airplay-stop').click();
    assert.ok((await snapshot()).sent.some(event => event.k === 'ap' && event.id === 77 && event.a === 'stop'));
    const retiredButtons = await page.locator('media-play-button, media-seek-button, .airplay-previous, .airplay-next, .airplay-stop').elementHandles();
    await update({ id: 78, artworkResource: null, title: 'New synthetic playback owner' });
    await page.waitForFunction(() => document.querySelector('.airplay-audio-title')?.textContent === 'New synthetic playback owner');
    const successorMark = (await snapshot()).sent.length;
    for (const button of retiredButtons) {
      await button.evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await button.dispose();
    }
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal((await snapshot()).sent.length, successorMark, 'retired callbacks cannot control the next playback owner');
    await page.evaluate(() => nowPlaying.clear());
    assert.equal(await page.locator('.airplay-now-playing').count(), 0);
    await page.evaluate(() => nowPlaying.dispose());
    assert.equal((await liveUrls()).length, 0);
    assert.deepEqual(errors, []); assert.deepEqual(violations, []);
    const result = { locale, width, height, checks: 'passed' }; results.push(result); console.log(JSON.stringify(result));
    await context.close();
  }
  await writeFile(resolve(output, 'now-playing-result.json'), JSON.stringify({ browser: browser.version(),
    scope: 'Production controls, CSS and CSP with synthetic song/artwork; no AirPlay transport or physical output claim.', results }, null, 2) + '\n');
} finally { await browser?.close(); await closeServer(server); }
