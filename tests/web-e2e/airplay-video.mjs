import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url)).replace(/\/$/, '');
const sample = process.env.TEST_VIDEO_MP4;
const hls = process.env.TEST_VIDEO_HLS;
const diagnosticFields = new Set(['k', 'id', 'revision', 'event', 'position', 'duration', 'paused', 'ended',
  'seeking', 'dragging', 'readyState', 'networkState', 'rate', 'errorCode', 'errorName', 'errorText']);
function checkDiagnostics(entries) {
  if (!entries.length || entries.some(entry => Object.keys(entry).some(key => !diagnosticFields.has(key))))
    throw new Error('AirPlay diagnostic schema contains an unexpected field');
  if (JSON.stringify(entries).includes('private.example') || JSON.stringify(entries).includes('private-session'))
    throw new Error('AirPlay diagnostics exposed private resource or exception text');
}
if (!sample) throw new Error('Set TEST_VIDEO_MP4 to an ordinary playable MP4 fixture');
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const resource = new URL(req.url, 'http://localhost').searchParams.get('r');
  if (hls && path === '/airplay-resource' && resource === 'hls') {
    const route = new URL(req.url, 'http://localhost'); route.searchParams.set('r', 'hls-media');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(`#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="text",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="?r=hls-text"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="text",NAME="中文",LANGUAGE="zh",DEFAULT=NO,AUTOSELECT=NO,URI="?r=hls-text-zh"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180,SUBTITLES="text"\n${route.pathname}${route.search}\n`); return;
  }
  if (hls && path === '/airplay-resource' && /^hls-(text|vtt)(-zh)?$/.test(resource)) {
    if (!['id', 'c', 's'].every(key => new URL(req.url, 'http://localhost').searchParams.has(key))) {
      res.statusCode = 403; res.end(); return;
    }
    const playlist = resource.startsWith('hls-text'), chinese = resource.endsWith('-zh');
    res.setHeader('Content-Type', playlist ? 'application/vnd.apple.mpegurl' : 'text/vtt');
    res.end(playlist ? `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n?r=hls-vtt${chinese ? '-zh' : ''}\n#EXT-X-ENDLIST\n`
      : `WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00.000,MPEGTS:270000\n\n00:01.300 --> 00:01.500\n<b>${chinese ? '中文字幕' : 'HLS caption'}</b>\n`); return;
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true, args:['--no-sandbox','--no-proxy-server','--autoplay-policy=no-user-gesture-required'] });
try {
  for (const mode of ['webgl', '2d', ...(hls ? ['hls'] : [])]) {
  const page = await browser.newPage({ hasTouch:true });
  await page.addInitScript(mode => {
    window.pictures = [];
    window.actualVideo = () => document.querySelector('tiplay-media')?.engine;
    window.mediaResource = mode === 'hls' ? 'hls' : '0';
    window.playerLanguage = mode === 'hls' ? 'zh' : 'en';
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      if (mode === '2d' && type.startsWith('webgl')) return null;
      const context = original.call(this, type, options);
      if (!context || context.recorded) return context;
      context.recorded = true;
      const canvas = this;
      const method = type === '2d' ? 'drawImage' : 'drawArrays';
      const draw = context[method];
      context[method] = function(...args) {
        const result = draw.apply(this, args);
        if (canvas.className !== 'airplay-canvas') return result;
        // Readback is test instrumentation only; production never reads video pixels into JS.
        const pixels = type === '2d' ? this.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8Array(canvas.width * canvas.height * 4);
        if (type !== '2d') this.readPixels(0, 0, canvas.width, canvas.height, this.RGBA, this.UNSIGNED_BYTE, pixels);
        let hash = 0, colored = false;
        for (let i = 0; i < pixels.length; i += 16) {
          colored ||= Boolean(pixels[i] || pixels[i + 1] || pixels[i + 2]);
          hash = (Math.imul(hash, 31) + pixels[i] + 3 * pixels[i + 1] + 7 * pixels[i + 2]) | 0;
        }
        pictures.push({ type, hash, colored, width: canvas.width, height: canvas.height,
          time: actualVideo().currentTime, corner: Array.from(pixels.slice(0, 3)) });
        return result;
      };
      return context;
    };
  }, mode);
  const requests=[]; page.on('request', request => requests.push(request.url()));
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') console.log('console:',message.text()); });

  await page.goto(url+'/harness');
  const result = await page.evaluate(async () => {
    const {createAirPlayControls} = await import('/airplay-controls.js');
    window.events=[];
    window.controls=createAirPlayControls(document.getElementById('stage'),event=>events.push(event),playerLanguage, {
      fetchPhone:(route,init)=>fetch(route,init),
      credentials:()=>({code:'1234',session:'session'}),host:()=>location.host,
    });
    controls.update({id:1,resource:mediaResource,revision:0,seekRevision:0,target:0,fraction:false,playing:true});
    for (let i=0; i<100 && !document.querySelector('video-player') && !events.some(e=>e.failed); i++) await new Promise(r=>setTimeout(r,50));
    const player=actualVideo();
    return {version:document.querySelector('video-player')?.dataset.version,active:controls.videoActive(),fullscreen:document.querySelectorAll('media-fullscreen-button,media-pip-button').length,
      stop:document.querySelectorAll('.airplay-stop').length,spinner:document.querySelectorAll('media-buffering-indicator').length,
      volume:document.querySelectorAll('media-volume-slider,media-mute-button').length,
      fill:document.querySelector('media-container')?.clientHeight === 480};
  });
  console.log(JSON.stringify({result,errors}));
  if(result.version !== '10.1.0' || errors.length || result.fullscreen!==0 || result.volume!==0 || result.stop!==1 || result.spinner!==1 || !result.fill) throw new Error('Player integration failed');
  await page.waitForFunction(()=>events.some(event=>event.k==='ap-state' && event.ready && event.duration>0));
  await page.waitForFunction(()=>events.some(event=>event.k==='ap-diag' && event.event==='play-resolved'));
  const openingDiagnostics = await page.evaluate(()=>events.filter(event=>event.k==='ap-diag'));
  checkDiagnostics(openingDiagnostics);
  for (const expected of ['open', 'probe-start', 'probe-ready', 'loadedmetadata', 'directive-seek', 'directive-play', 'play', 'playing', 'play-resolved'])
    if (!openingDiagnostics.some(entry=>entry.event===expected)) throw new Error(`Missing initial AirPlay diagnostic: ${expected}`);
  await page.waitForFunction(()=>new Set(pictures.filter(p=>p.colored).map(p=>p.hash)).size>=2);
  const picture = await page.evaluate(() => ({ ...pictures.at(-1), nativeVideos: document.querySelectorAll('video').length,
    canvases: document.querySelectorAll('.airplay-canvas').length }));
  if (!picture.colored || picture.nativeVideos !== 0 || picture.canvases !== 1 || picture.width > 320 || picture.corner.some(Boolean))
    throw new Error('Canvas pixels, source resolution cap, single engine or letterboxing failed');
  if ((mode === '2d') !== (picture.type === '2d')) throw new Error('Unexpected canvas renderer');
  console.log(`${mode}: decoded video pictures reached the canvas without a native video clock`);
  if (mode === 'hls' && !/[\u4e00-\u9fff]/.test(await page.locator('media-play-button').getAttribute('aria-label')))
    throw new Error('Chinese controls did not use the bundled locale');
  if (mode === 'webgl') {
    await page.evaluate(() => {
      window.policyEngine = actualVideo();
      controls.update({id:1,resource:mediaResource,revision:0,seekRevision:0,target:0,fraction:false,
        playing:true,proxyOnly:true,directUrl:'http://127.0.0.1:1/iphone-private.mp4'});
    });
    await page.waitForFunction(() => actualVideo() !== policyEngine && actualVideo()?.readyState >= 2);
    if (requests.some(url => url.includes('iphone-private.mp4')) || !requests.some(url => url.includes('proxy=1')))
      throw new Error('Debug mode did not force active playback through Android');
    await page.evaluate(() => {
      window.policyEngine = actualVideo();
      controls.update({id:1,resource:mediaResource,revision:0,seekRevision:0,target:0,fraction:false,
        playing:true,proxyOnly:false,directUrl:location.origin+'/airplay-resource?r=0&direct=1'});
    });
    await page.waitForFunction(() => actualVideo() !== policyEngine && actualVideo()?.readyState >= 2);
    if (!requests.some(url => url.includes('direct=1'))) throw new Error('Disabling debug did not restore direct playback');
    console.log('debug switch: active media reopened through Android and direct playback returned when disabled');
  }
  const progress = await page.evaluate(() => {
    const player=actualVideo();
    player.pause(); player.currentTime = Math.min(0.25,player.duration/3); const before=player.currentTime;
    controls.update({id:1,resource:mediaResource,revision:1,seekRevision:0,target:0,fraction:false,playing:false});
    const paused=player.currentTime;
    const target=Math.min(0.4,player.duration/2);
    controls.update({id:1,resource:mediaResource,revision:2,seekRevision:1,target,fraction:false,playing:false});
    return {before,paused,target,seeked:player.currentTime};
  });
  if(Math.abs(progress.before-progress.paused)>0.01||Math.abs(progress.target-progress.seeked)>0.01)throw new Error('Rate change rolled back progress or new seek was ignored');
  await page.waitForFunction(target => !actualVideo().seeking && Math.abs(pictures.at(-1).time-target)<0.03, progress.target);
  await page.waitForTimeout(150);
  const pausedFrames = await page.evaluate(()=>pictures.length);
  await page.waitForTimeout(150);
  if(await page.evaluate(()=>pictures.length)!==pausedFrames) throw new Error('Paused video keeps drawing');
  const pausedDiagnostics = await page.evaluate(()=>events.filter(event=>event.k==='ap-diag').length);
  await page.waitForTimeout(500);
  if(await page.evaluate(()=>events.filter(event=>event.k==='ap-diag').length)!==pausedDiagnostics)
    throw new Error('Periodic AirPlay reports emitted extra diagnostics');
  await page.evaluate(()=>document.getElementById('stage').style.height='800px');
  await page.waitForFunction(()=>pictures.at(-1).width===320 && pictures.at(-1).height===320);
  if(mode==='webgl') {
    await page.evaluate(()=>{
      const canvas=document.querySelector('.airplay-canvas');
      const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      const extension=gl.getExtension('WEBGL_lose_context');
      if(!extension) throw new Error('Context loss fixture unavailable');
      window.beforeRestore=pictures.length;
      extension.loseContext(); setTimeout(()=>extension.restoreContext(),300);
    });
    await page.waitForFunction(()=>pictures.length>beforeRestore && pictures.at(-1).colored);
  }
  if (mode === 'hls') {
    await page.evaluate(() => { actualVideo().currentTime = 1.35; });
    await page.waitForFunction(() => !actualVideo().seeking && document.querySelector('.airplay-captions')?.textContent === 'HLS caption');
    if (await page.locator('.airplay-captions b').count()) throw new Error('Discovered HLS cue markup was inserted');
    await page.locator('media-captions-button').click();
    await page.waitForFunction(() => document.querySelector('media-menu').open);
    await page.locator('media-menu-radio-item[data-track="subtitle-1"]').click();
    await page.waitForFunction(() => document.querySelector('.airplay-captions').textContent === '中文字幕');
    await page.evaluate(() => { actualVideo().currentTime = 1.6; });
    await page.waitForFunction(() => !actualVideo().seeking && document.querySelector('.airplay-captions').hidden);
    await page.evaluate(target => {
      for (const track of actualVideo().textTracks) track.mode = 'disabled';
      actualVideo().currentTime = target;
    }, progress.target);
    await page.waitForFunction(() => !actualVideo().seeking);
    console.log('HLS: authenticated WebVTT, native language selection and pure-text timed cues verified');
  }
  await page.evaluate(() => {
    const track = actualVideo().addTextTrack('captions', 'English', 'en');
    track.addCue(new VTTCue(0, 3, '<b>caption</b>')); track.mode = 'showing';
  });
  await page.waitForFunction(() => document.querySelector('.airplay-captions')?.textContent === 'caption');
  if (mode === 'webgl' && process.env.TEST_PLAYER_SCREENSHOT)
    await page.screenshot({ path: process.env.TEST_PLAYER_SCREENSHOT, fullPage: true });
  if (await page.locator('.airplay-captions b').count()) throw new Error('Caption text was interpreted as markup');
  await page.locator('media-captions-button').click();
  if (mode === 'hls') {
    await page.waitForFunction(() => document.querySelector('media-menu').open);
    await page.locator('media-menu-radio-item[data-track="off"]').click();
  }
  await page.waitForFunction(() => document.querySelector('.airplay-captions').hidden);

  await page.locator('media-playback-rate-button').click();
  await page.waitForFunction(() => actualVideo().playbackRate === 1.25 &&
    events.some(event => event.k === 'ap-state' && event.rate === 1.25));
  await page.waitForFunction(() => actualVideo().readyState >= 2 && !actualVideo().seeking);
  await page.evaluate(() => { actualVideo().playbackRate = 1; });
  await page.waitForFunction(() => actualVideo().readyState >= 2);

  await page.locator('media-play-button').click();
  await page.waitForFunction(target=>!actualVideo().paused && pictures.at(-1).time>target+0.05, progress.target);
  await page.locator('media-play-button').click();
  if(!await page.evaluate(()=>actualVideo().paused)) throw new Error('Canvas intercepted player controls');
  const slider = page.locator('media-time-slider');
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  await slider.click({ position: { x: bounds.width * 0.55, y: bounds.height / 2 } });
  await page.waitForFunction(() => Math.abs(actualVideo().currentTime / actualVideo().duration - 0.55) < 0.05);
  const dragMark = await page.evaluate(()=>events.length);
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(mark=>events.slice(mark).some(event=>event.k==='ap-diag' && event.event==='drag-end'), dragMark);
  await page.waitForFunction(()=>!actualVideo().seeking && Math.abs(actualVideo().currentTime / actualVideo().duration - 0.65)<0.05);
  const dragDiagnostics = await page.evaluate(mark=>events.slice(mark).filter(event=>event.k==='ap-diag'), dragMark);
  if (dragDiagnostics.filter(entry=>entry.event==='drag-start' && entry.dragging).length!==1 ||
      dragDiagnostics.filter(entry=>entry.event==='drag-end' && !entry.dragging).length!==1 ||
      !dragDiagnostics.some(entry=>entry.event==='seeking' && entry.seeking) ||
      !dragDiagnostics.some(entry=>entry.event==='seeked' && !entry.seeking))
    throw new Error('Time-slider gesture or seek edges were not diagnosed');
  console.log(JSON.stringify({mode, drag:dragDiagnostics.map(({event,position,duration,seeking,dragging})=>
    ({event,position,duration,seeking,dragging}))}));

  const skipStart = await page.evaluate(() => actualVideo().currentTime);
  await page.locator('media-seek-button[seconds="-10"]').click();
  await page.waitForFunction(target => !actualVideo().seeking && Math.abs(actualVideo().currentTime - target) < 0.03, Math.max(0, skipStart - 10));
  await page.locator('media-seek-button[seconds="10"]').click();
  await page.waitForFunction(target => !actualVideo().seeking && Math.abs(actualVideo().currentTime - target) < 0.03, Math.max(0, skipStart - 10) + 10);
  const surface = page.locator('media-container');
  const area = await surface.boundingBox();
  const point = side => ({ x: area.width * (side === 'left' ? .25 : .75), y: area.height * .4 });
  await page.evaluate(() => { actualVideo().currentTime = 12; });
  await page.waitForFunction(() => !actualVideo().seeking);
  await surface.dblclick({ position: point('left') });
  await page.waitForFunction(() => !actualVideo().seeking && Math.abs(actualVideo().currentTime - 2) < .03);
  await surface.click({ position: point('right') });
  await page.waitForTimeout(300);
  if (!await page.evaluate(() => actualVideo().paused && Math.abs(actualVideo().currentTime - 2) < .03))
    throw new Error('Single tap changed playback instead of only showing controls');
  const right = point('right');
  await page.touchscreen.tap(area.x + right.x, area.y + right.y);
  await page.touchscreen.tap(area.x + right.x, area.y + right.y);
  await page.waitForFunction(() => !actualVideo().seeking && Math.abs(actualVideo().currentTime - 12) < .03);
  await page.waitForTimeout(850);
  await page.evaluate(() => { actualVideo().currentTime = 0; });
  await page.waitForFunction(() => !actualVideo().seeking);
  await surface.dblclick({ position: point('right') });
  await surface.dblclick({ position: point('right') });
  const indicator = page.locator('media-seek-indicator');
  if (await indicator.getAttribute('data-direction') !== 'forward' || !/^20/.test(await indicator.textContent()))
    throw new Error('Rapid right-side seeking did not accumulate feedback');
  await page.waitForFunction(() => !actualVideo().seeking && Math.abs(actualVideo().currentTime - 20) < .03);
  await surface.dblclick({ position: point('right') });
  await page.waitForFunction(() => !actualVideo().seeking && Math.abs(actualVideo().currentTime - actualVideo().duration) < .03);
  await surface.dblclick({ position: point('left') });
  await page.waitForFunction(() => !actualVideo().seeking && Math.abs(actualVideo().currentTime - (actualVideo().duration - 10)) < .03);
  console.log(`${mode}: mouse/touch half-screen seeking, single-tap isolation, accumulation and duration clamp passed`);
  const style = await page.locator('.airplay-stop').evaluate(button => {
    const stop = getComputedStyle(button), play = getComputedStyle(document.querySelector('media-play-button'));
    return { padding: stop.padding, border: stop.borderWidth, radius: stop.borderRadius,
      playRadius: play.borderRadius, width: button.getBoundingClientRect().width,
      icon: button.querySelector('svg').getBoundingClientRect().width };
  });
  if (style.padding !== '0px' || style.border !== '0px' || style.radius !== style.playRadius || style.icon > style.width)
    throw new Error('Page styles overrode the official Video.js stop control: ' + JSON.stringify(style));
  // The skin must remain usable on a narrow browser with the production page CSS.
  await page.evaluate(() => { document.getElementById('stage').style.width = '320px'; });
  for (const selector of ['media-seek-button[seconds="-10"]', 'media-seek-button[seconds="10"]', '.airplay-stop', 'media-time-slider']) {
    const visible = await page.locator(selector).evaluate(control => {
      const r = control.getBoundingClientRect(), parent = document.getElementById('stage').getBoundingClientRect();
      return r.width > 0 && r.left >= parent.left && r.right <= parent.right;
    });
    if (!visible) throw new Error('Narrow Video.js layout clipped ' + selector);
  }
  await page.evaluate(() => { document.getElementById('stage').style.width = '800px'; });
  console.log(`${mode}: +/-10 seeking, matching skin controls and narrow layout passed`);

  await page.evaluate(()=>{
    const player=actualVideo();
    player.currentTime = player.duration-0.15; player.play();
  });
  await page.waitForFunction(()=>actualVideo().ended);
  if (!await page.evaluate(() => events.some(event => event.k === 'ap-state' && event.ended && !event.buffering && !event.playing)))
    throw new Error('Ended playback was reported as loading');
  await page.waitForTimeout(100);
  const endedFrames=await page.evaluate(()=>pictures.length);
  await page.waitForTimeout(100);
  if(await page.evaluate(()=>pictures.length)!==endedFrames) throw new Error('Ended video keeps drawing');
  await page.locator('.airplay-stop').click();
  if (!await page.evaluate(() => events.some(event => event.k === 'ap' && event.id === 1 && event.a === 'stop')))
    throw new Error('Stop control did not reach the iPhone');
  if (!await page.evaluate(()=>events.some(event=>event.k==='ap-diag' && event.event==='ended' && event.ended) &&
      events.some(event=>event.k==='ap-diag' && event.event==='explicit-stop')))
    throw new Error('Media completion and explicit stop were not distinguished');
  const retiredDiagnostics = await page.evaluate(()=>{
    const retired = actualVideo();
    controls.update(null);
    const mark=events.filter(event=>event.k==='ap-diag').length;
    for (const type of ['play','pause','loadedmetadata','seeking','seeked','ended','error']) retired.dispatchEvent(new Event(type));
    return {mark,after:events.filter(event=>event.k==='ap-diag').length};
  });
  if (retiredDiagnostics.mark!==retiredDiagnostics.after) throw new Error('Retired player emitted late diagnostics');
  if(await page.locator('video-player').count()) throw new Error('Player not disposed');
  if(await page.locator('.airplay-canvas').count()) throw new Error('Canvas not disposed');
  const disposedFrames=await page.evaluate(()=>pictures.length);
  await page.waitForTimeout(100);
  if(await page.evaluate(()=>pictures.length)!==disposedFrames) throw new Error('Disposed canvas keeps drawing');
  await page.evaluate(()=>controls.update({id:3,resource:mediaResource,revision:0,seekRevision:0,target:0,fraction:false,playing:true}));
  await page.waitForFunction(count=>events.some(event=>event.id===3&&event.ready)&&pictures.length>count, disposedFrames);
  if(await page.locator('.airplay-canvas').count()!==1) throw new Error('Replacement did not create exactly one canvas');
  await page.evaluate(()=>controls.update({id:4,kind:'photo'}));
  if(await page.locator('.airplay-canvas').count()) throw new Error('Photo handoff retained video canvas');
  await page.evaluate(()=>{
    controls.update({id:2,resource:'broken',revision:0,seekRevision:0,target:0,fraction:false,playing:true});
    controls.update({id:2,resource:'broken',revision:1,seekRevision:0,target:0,fraction:false,playing:false});
  });
  await page.waitForFunction(()=>events.some(event=>event.id===2&&event.revision===1&&event.failed));
  if (!await page.evaluate(()=>events.some(event=>event.k==='ap-diag' && event.id===2 && event.revision===1 && event.event==='open-error')))
    throw new Error('Resource-open failure did not preserve its active revision');
  checkDiagnostics(await page.evaluate(()=>events.filter(event=>event.k==='ap-diag')));
  await page.evaluate(()=>controls.update(null));
  if(errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  await page.close();
  }
  for (const scenario of ['autoplay-rejection', 'canvas-failure', 'retired-play-promise']) {
    const page=await browser.newPage();
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.addInitScript(scenario=>{
      const secret='https://private.example/media?code=private-code&session=private-session';
      if (scenario==='canvas-failure') {
        const original=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,options){
          if(type.startsWith('webgl'))return null;
          const context=original.call(this,type,options);
          if(context)context.drawImage=()=>{throw new DOMException(secret,'SecurityError');};
          return context;
        };
      } else {
        const listen = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, ...args) {
          if (type === 'loadedmetadata' && this.constructor === EventTarget && typeof this.play === 'function' && !this.mockedPlay) {
            this.mockedPlay = true;
            const media = this;
            window.originalPlay = media.play;
            media.play = () => {
              window.retiredMedia = media;
              if(scenario==='autoplay-rejection')return Promise.reject(new DOMException(secret,'NotAllowedError'));
              return new Promise((resolve,reject)=>{window.rejectRetiredPlay=()=>reject(new DOMException(secret,'AbortError'));});
            };
          }
          return listen.call(this, type, ...args);
        };
      }
    },scenario);
    await page.goto(url+'/harness');
    await page.evaluate(async()=>{
      const {createAirPlayControls}=await import('/airplay-controls.js');
      window.events=[];
      window.controls=createAirPlayControls(document.getElementById('stage'),event=>events.push(event),'en',{
        fetchPhone:(route,init)=>fetch(route,init), credentials:()=>({code:'private-code',session:'private-session'}),host:()=>location.host,
      });
      controls.update({id:9,resource:'0',revision:0,seekRevision:0,target:0,fraction:false,playing:true});
    });
    if(scenario==='retired-play-promise'){
      await page.waitForFunction(()=>typeof rejectRetiredPlay==='function');
      const retired=await page.evaluate(async()=>{
        controls.update(null); const mark=events.length;
        rejectRetiredPlay();
        for(const type of ['ended','error','seeked'])retiredMedia.dispatchEvent(new Event(type));
        await new Promise(resolve=>setTimeout(resolve,50));
        retiredMedia.play=originalPlay;
        return {mark,after:events.length};
      });
      if(retired.mark!==retired.after)throw new Error('Retired play promise reported into a closed player');
    }else{
      const expected=scenario==='autoplay-rejection'?'play-rejected':'canvas-error';
      const errorName=scenario==='autoplay-rejection'?'NotAllowedError':'SecurityError';
      await page.waitForFunction(expected=>events.some(event=>event.k==='ap-diag' && event.event===expected),expected);
      if(!await page.evaluate(({expected,errorName})=>events.some(event=>event.k==='ap-diag' && event.event===expected && event.errorName===errorName),{expected,errorName}))
        throw new Error('Failure diagnostic omitted its safe exception name');
      if(scenario==='autoplay-rejection' && !await page.evaluate(()=>document.querySelector('tiplay-media').paused && !events.some(event=>event.k==='ap-state' && event.failed)))
        throw new Error('Autoplay rejection diagnostics changed playback failure behavior');
      if(scenario==='canvas-failure')
        await page.waitForFunction(()=>events.some(event=>event.k==='ap-state' && event.failed));
      console.log(JSON.stringify({scenario, failure:await page.evaluate(expected=>events.find(event=>
        event.k==='ap-diag' && event.event===expected),expected)}));
    }
    checkDiagnostics(await page.evaluate(()=>events.filter(event=>event.k==='ap-diag')));
    await page.evaluate(()=>controls.dispose());
    if(errors.length)throw new Error(`Diagnostic scenario browser errors: ${errors.join('; ')}`);
    await page.close();
    console.log(`${scenario}: safe diagnostic edges and existing playback behavior verified`);
  }
  console.log('AirPlay MP4/HLS Video.js v10 checks passed');
} finally {await browser.close();await new Promise(r=>server.close(r));}
