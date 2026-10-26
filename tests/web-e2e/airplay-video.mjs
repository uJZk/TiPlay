import { createServer } from 'node:http';
import { SOFTWARE_VIDEO, configureVideoDecoder } from './avplayer-hardware-override.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url)).replace(/\/$/, '');
const sample = process.env.TEST_VIDEO_MP4;
const hls = process.env.TEST_VIDEO_HLS;
const diagnosticFields = new Set(['k', 'id', 'revision', 'event', 'position', 'duration', 'paused', 'ended',
  'seeking', 'dragging', 'readyState', 'networkState', 'rate', 'errorCode', 'errorName', 'errorText', 'engine']);
function checkDiagnostics(entries) {
  if (!entries.length || entries.some(entry => Object.keys(entry).some(key => !diagnosticFields.has(key))))
    throw new Error('AirPlay diagnostic schema contains an unexpected field');
  for (const entry of entries) if (entry.engine && (typeof entry.engine !== 'object' || Array.isArray(entry.engine) ||
    Object.entries(entry.engine).some(([key, value]) => /^(?:url|src|resourceUrl|resourceToken|token|session|password|secret|path)$/i.test(key) ||
      !(typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ||
        typeof value === 'string' && value.length <= 128 && !/[\r\n]/.test(value) && !/(?:https?:|bearer |[?&](?:c|s)=)/i.test(value)))))
    throw new Error('AirPlay engine diagnostics contain unsafe or non-scalar data');
  if (JSON.stringify(entries).includes('private.example') || JSON.stringify(entries).includes('private-session'))
    throw new Error('AirPlay diagnostics exposed private resource or exception text');
}
if (process.env.TEST_CAST_MODE && !['mp4', 'hls'].includes(process.env.TEST_CAST_MODE)) throw new Error('Unknown TEST_CAST_MODE');
if (process.env.TEST_CAST_MODE === 'hls' && !hls) throw new Error('HLS mode needs TEST_VIDEO_HLS');
if (!sample) throw new Error('Set TEST_VIDEO_MP4 to an ordinary playable MP4 fixture');
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const resource = new URL(req.url, 'http://localhost').searchParams.get('r');
  const resourceRoute = name => {
    const route = new URL(req.url, 'http://localhost'); route.pathname = '/airplay-resource';
    route.searchParams.set('r', name); return route.pathname + route.search;
  };
  if (hls && path === '/airplay-resource' && resource === 'hls') {
    const route = new URL(req.url, 'http://localhost'); route.searchParams.set('r', 'hls-media');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(`#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="text",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="${resourceRoute('hls-text')}"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="text",NAME="中文",LANGUAGE="zh",DEFAULT=NO,AUTOSELECT=NO,URI="${resourceRoute('hls-text-zh')}"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180,SUBTITLES="text"\n${route.pathname}${route.search}\n`); return;
  }
  if (hls && path === '/airplay-resource' && /^hls-(text|vtt)(-zh)?$/.test(resource)) {
    if (!['id', 'c', 's'].every(key => new URL(req.url, 'http://localhost').searchParams.has(key))) {
      res.statusCode = 403; res.end(); return;
    }
    const playlist = resource.startsWith('hls-text'), chinese = resource.endsWith('-zh');
    res.setHeader('Content-Type', playlist ? 'application/vnd.apple.mpegurl' : 'text/vtt');
    // Valid WebVTT EOF boundaries: English has one final LF; Chinese has none.
    res.end(playlist ? `#EXTM3U\n#EXT-X-TARGETDURATION:30\n#EXTINF:30,\n${resourceRoute('hls-vtt'+(chinese ? '-zh' : ''))}\n#EXT-X-ENDLIST\n`
      : `WEBVTT\n\n00:00.000 --> 00:30.000\n<b>${chinese ? '中文字幕' : 'HLS caption'}</b>${chinese ? '' : '\n'}`); return;
  }
  if (hls && (path === '/airplay-resource' && resource === 'hls-media' || /^\/part\d+\.ts$/.test(path))) {
    res.setHeader('Content-Type', path.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl');
    res.end(readFileSync(path.endsWith('.ts') ? join(dirname(hls),path.slice(1)) : hls)); return;
  }
  if(path === '/airplay-resource' && new URL(req.url,'http://localhost').searchParams.get('r')==='broken') {
    setTimeout(()=>{res.statusCode=502;res.end();},100);return;
  }
  if (path === '/airplay-resource') { const data=readFileSync(sample); res.setHeader('Content-Type','video/mp4'); res.setHeader('Accept-Ranges','bytes'); const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''); if(match){const start=+match[1],end=Math.min(match[2]?+match[2]:data.length-1,data.length-1);if(start>=data.length||end<start){res.statusCode=416;res.setHeader('Content-Range',`bytes */${data.length}`);res.end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${data.length}`);res.end(data.subarray(start,end+1));}else res.end(data);return; }
  if (path === '/harness') {
    res.setHeader('Content-Type', 'text/html');
    const csp=readFileSync(root+'/index.html','utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
    res.end(`${csp}<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/vendor/videojs/skin.min.css"><link rel="stylesheet" href="/airplay-controls.css"><div id="stage" style="position:relative;width:800px;height:480px"></div>`); return;
  }
  try { const data = readFileSync(root + path); res.setHeader('Content-Type', ({ '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm' })[extname(path)] ?? 'application/octet-stream'); res.end(data); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless:true,
  args:['--no-sandbox','--no-proxy-server','--autoplay-policy=no-user-gesture-required'] });
try {
  for (const mode of ['mp4', ...(hls ? ['hls'] : [])].filter(mode => !process.env.TEST_CAST_MODE || mode === process.env.TEST_CAST_MODE)) {
    const page = await browser.newPage({ hasTouch: true });
    const errors = [], requests = [];
    page.on('pageerror', error => { errors.push(error.stack || error.message); console.log('PAGEERROR:', error.stack || error.message); });
    page.on('request', request => requests.push(request.url()));
    if (process.env.AVPLAYER_DEBUG) page.on('console', message => console.log('browser:', message.type(), message.text()));
    await page.addInitScript(() => {
      window.videoCreates = 0;
      const create = Document.prototype.createElement;
      Document.prototype.createElement = function(name, ...args) {
        if (String(name).toLowerCase() === 'video') window.videoCreates++;
        return create.call(this, name, ...args);
      };
    });
    await configureVideoDecoder(page);
    await page.goto(url+'/harness');
    await page.evaluate(async mode => {
      const { createAirPlayControls } = await import('/airplay-controls.js');
      window.events = [];
      window.actualVideo = () => document.querySelector('tiplay-media')?.engine;
      window.mediaResource = mode === 'hls' ? 'hls' : '0';
      window.controls = createAirPlayControls(document.querySelector('#stage'), event => events.push(event), 'en', {
        fetchPhone: (route, init) => fetch(route, init),
        credentials: () => ({ code: '1234', session: 'session' }), host: () => location.host,
      });
      controls.update({ id: 1, resource: mediaResource, revision: 0, seekRevision: 0, target: 0,
        fraction: false, playing: true });
    }, mode);
    await page.waitForFunction(() => actualVideo()?.readyState >= 2 && actualVideo().currentTime > .4, null, { timeout: 30000 })
      .catch(async error => { console.log('controls-startup:', await page.evaluate(() => ({ events, engine: actualVideo()?.getPlaybackDiagnostics(), error: actualVideo()?.error, layer: document.querySelector('.airplay-player')?.textContent })), errors, requests.slice(-20)); throw error; });
    if (await page.locator('media-fullscreen-button,media-pip-button,media-volume-slider,media-mute-button').count())
      throw new Error('Removed controls were restored');
    if (await page.locator('.airplay-stop').count() !== 1) throw new Error('Missing stop control');
    const surface = page.locator('media-container');
    const clickControl = async selector => {
      // Exercise the official touch gesture when playback has auto-hidden the toolbar.
      if (!await page.locator('media-controls-content').evaluate(element => element.hasAttribute('data-visible')))
        await surface.tap({ position: { x: 20, y: 20 } });
      await page.locator(selector).click();
    };
    const canvas = page.locator('#stage canvas');
    if (await canvas.count() !== 1) throw new Error('Expected exactly one Canvas renderer');
    const first = await canvas.screenshot();
    await page.waitForFunction(() => actualVideo().currentTime > 1);
    if (first.equals(await canvas.screenshot())) throw new Error('Canvas video did not change');
    if (await page.evaluate(() => videoCreates || document.querySelectorAll('video').length))
      throw new Error('URL playback created a video element');
    await clickControl('media-play-button');
    await page.waitForFunction(() => actualVideo().paused);
    const before = await page.evaluate(() => actualVideo().currentTime);
    await page.waitForTimeout(250);
    if (Math.abs(await page.evaluate(() => actualVideo().currentTime) - before) > .1) throw new Error('Pause clock advanced');
    await page.evaluate(() => controls.update({ id: 1, resource: mediaResource, revision: 1,
      seekRevision: 1, target: .5, fraction: true, playing: false }));
    await page.waitForFunction(() => !actualVideo().seeking && Math.abs(actualVideo().currentTime / actualVideo().duration - .5) < .04);
    await clickControl('media-playback-rate-button');
    await page.waitForFunction(() => actualVideo().playbackRate === 1.25 && events.some(event => event.k === 'ap-state' && event.rate === 1.25));
    await page.evaluate(() => { actualVideo().playbackRate = 1; });
    const seekPosition = await page.evaluate(() => actualVideo().currentTime), seekPicture = await canvas.screenshot();
    await clickControl('media-play-button');
    await page.waitForFunction(position => !actualVideo().paused && actualVideo().currentTime > position + .3, seekPosition);
    if (seekPicture.equals(await canvas.screenshot())) throw new Error('Paused seek/resume did not produce new Canvas pictures');
    await clickControl('media-play-button');
    await page.waitForFunction(() => actualVideo().paused);
    await clickControl('media-seek-button[seconds="-10"]');
    await page.waitForFunction(() => !actualVideo().seeking);
    const position = await page.evaluate(() => actualVideo().currentTime);
    await surface.dblclick({ position: { x: 120, y: 100 } });
    await page.waitForTimeout(250);
    if (!await page.evaluate(position => actualVideo().paused && Math.abs(actualVideo().currentTime - position) < .1, position))
      throw new Error('Canvas double click changed playback');
    await page.evaluate(() => { document.querySelector('#stage').style.width = '320px'; });
    for (const selector of ['.airplay-stop', 'media-time-slider']) {
      const fits = await page.locator(selector).evaluate(control => {
        const bounds = control.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
        return bounds.width > 0 && bounds.left >= stage.left && bounds.right <= stage.right;
      });
      if (!fits) throw new Error('Narrow layout overflow: '+selector);
    }
    if (mode === 'hls') {
      await page.evaluate(async () => { await actualVideo().play(); });
      await page.evaluate(() => {
        const track = [...actualVideo().textTracks].find(track => /en/i.test(track.language));
        if (!track) throw new Error('HLS subtitle track missing');
        track.mode = 'showing';
      });
      await page.waitForFunction(() => !actualVideo().seeking && [...document.querySelectorAll('.airplay-avplayer .ASS-box')]
        .some(box => box.textContent.includes('HLS caption')), null, { timeout: 5000 })
        .catch(async error => { console.log('subtitle-native-state:', await page.evaluate(async () => {
          const { default: Player } = await import('/vendor/libmedia/avplayer.js');
          const raw = Player.Instances[0], renderer = raw?.subtitleRender;
          return JSON.stringify({ currentTime:raw?.currentTime, taskId:raw?.taskId, subtitleTaskId:raw?.subtitleTaskId,
            selectedSubtitleStream:raw?.selectedSubtitleStream && {id:raw.selectedSubtitleStream.id,index:raw.selectedSubtitleStream.index},
            streams:raw?.getStreams().map(stream => ({id:stream.id,mediaType:stream.mediaType,startTime:stream.startTime,
              timeBase:stream.timeBase,codecId:stream.codecparProxy?.codecId,codecType:stream.codecparProxy?.codecType})),
            renderer:renderer && {queue:renderer.queue,ended:renderer.ended,pulling:renderer.pulling,delay:renderer.delay,
              currentPort:typeof renderer.currentPort,loopStarted:renderer.loop?.isStarted?.(),keys:Object.keys(renderer)}},
            (_,value)=>typeof value==='bigint'?String(value):value);
        })); console.log('subtitle-state:', await page.evaluate(() => ({
          tracks: [...actualVideo().textTracks].map(track => ({id:track.id,label:track.label,language:track.language,mode:track.mode})),
          dom: document.querySelector('.airplay-avplayer')?.innerHTML.slice(0,5000), engine: actualVideo().getPlaybackDiagnostics(), error: actualVideo().error
        }))); throw error; });
      await page.evaluate(() => {
        const track = [...actualVideo().textTracks].find(track => track.language === 'zh');
        if (!track) throw new Error('Chinese HLS subtitle track missing');
        track.mode = 'showing';
      });
      await page.waitForFunction(() => [...document.querySelectorAll('.airplay-avplayer .ASS-box')]
        .some(box => box.textContent.includes('中文字幕')), null, { timeout: 5000 });
      await page.evaluate(() => {
        [...actualVideo().textTracks].find(track => track.language === 'en').mode = 'showing';
        actualVideo().currentTime = 1.35;
      });
      await page.waitForFunction(() => !actualVideo().seeking && actualVideo().currentTime >= 1.35
        && actualVideo().currentTime < 3 && [...document.querySelectorAll('.airplay-avplayer .ASS-box')]
          .some(box => box.textContent.includes('HLS caption')), null, { timeout: 5000 }).catch(async error => {
            console.log('subtitle-seek-state:', await page.evaluate(() => ({
              position: actualVideo().currentTime, paused: actualVideo().paused, seeking: actualVideo().seeking,
              tracks: [...actualVideo().textTracks].map(track => ({ id: track.id, mode: track.mode, language: track.language })),
              captions: [...document.querySelectorAll('.airplay-avplayer .ASS-box')].map(box => box.textContent),
              engine: actualVideo().getPlaybackDiagnostics(), error: actualVideo().error,
            })));
            throw error;
          });
    }
    await page.evaluate(() => {
      window.retainedEngine = actualVideo();
      window.pictureReturnPosition = actualVideo().currentTime;
      controls.update({ id: 1, resource: mediaResource, revision: 2, seekRevision: 1,
        target: 0, fraction: false, playing: true, videoShown: false, muted: true });
    });
    await page.waitForFunction(() => actualVideo() === retainedEngine && !actualVideo().paused
      && actualVideo().currentTime > pictureReturnPosition + .2);
    if (!await page.evaluate(() => document.querySelector('.airplay-player').hidden
      && !controls.videoActive() && actualVideo().muted)) throw new Error('Picture return did not preserve hidden URL audio');
    await page.evaluate(() => controls.update({ id: 1, resource: mediaResource, revision: 3, seekRevision: 1,
      target: 0, fraction: false, playing: true, videoShown: true, muted: false }));
    if (!await page.evaluate(() => actualVideo() === retainedEngine && !actualVideo().paused
      && !document.querySelector('.airplay-player').hidden && controls.videoActive() && !actualVideo().muted))
      throw new Error('Regaining picture ownership replaced or paused URL audio');
    await page.evaluate(() => controls.update({ id: 1, resource: mediaResource, revision: 3, seekRevision: 1,
      target: 0, fraction: false, playing: true, outputAllowed: false }));
    await page.waitForFunction(() => actualVideo().paused && !controls.videoActive());
    await page.evaluate(() => controls.update({ id: 1, resource: mediaResource, revision: 3, seekRevision: 1,
      target: 0, fraction: false, playing: true, outputAllowed: true }));
    await page.waitForFunction(() => !actualVideo().paused && controls.videoActive()).catch(async error => {
      console.log('permission-resume-state:', await page.evaluate(() => ({
        position: actualVideo()?.currentTime, paused: actualVideo()?.paused,
        active: controls.videoActive(), engine: actualVideo()?.getPlaybackDiagnostics(), error: actualVideo()?.error,
        events: events.slice(-15),
      })));
      throw error;
    });
    checkDiagnostics(await page.evaluate(() => events.filter(event => event.k === 'ap-diag')));
    if (process.env.TEST_PLAYER_SCREENSHOT) await page.screenshot({ path: process.env.TEST_PLAYER_SCREENSHOT, fullPage: true });
    await clickControl('.airplay-stop');
    if (!await page.evaluate(() => events.some(event => event.k === 'ap' && event.a === 'stop'))) throw new Error('Stop did not reach AirPlay control channel');
    await page.evaluate(() => controls.update(null));
    await page.waitForFunction(() => !document.querySelector('#stage canvas'));
    await page.evaluate(() => controls.update({ id: 2, resource: mediaResource, revision: 0, seekRevision: 0,
      target: 0, fraction: false, playing: false }));
    await page.waitForFunction(() => actualVideo()?.paused && actualVideo().readyState >= 1 && !document.querySelector('.airplay-preparation'));
    if (!await page.evaluate(() => actualVideo().paused && actualVideo().currentTime === 0))
      throw new Error('An initially paused URL source started playback');
    await page.evaluate(() => controls.dispose());
    await page.waitForFunction(() => !document.querySelector('#stage canvas'));
    if (errors.length) throw new Error('Page errors: '+errors.join(' | '));
    if (requests.some(request => request.includes('/vendor/mediabunny/') || request.includes('/vendor/soundtouch/')))
      throw new Error('URL playback loaded an obsolete engine dependency');
    console.log(JSON.stringify({ mode, softwareVideoOverride: SOFTWARE_VIDEO, canvasOnly: true, controls: true, pause: true, seek: true, rate: true,
      captions: mode === 'hls', narrowLayout: true, audioOnlyPictureReturn: true, outputRevocation: true, disposal: true }));
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
