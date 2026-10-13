import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url)).replace(/\/$/, '');
const sample = process.env.TEST_VIDEO_MP4;
const hls = process.env.TEST_VIDEO_HLS;
if (!sample) throw new Error('Set TEST_VIDEO_MP4 to an ordinary playable MP4 fixture');
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (hls && (path === '/airplay-resource' && new URL(req.url,'http://localhost').searchParams.get('r')==='hls' || /^\/part\d+\.ts$/.test(path))) {
    res.setHeader('Content-Type', path.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl');
    res.end(readFileSync(path.endsWith('.ts') ? join(dirname(hls),path.slice(1)) : hls)); return;
  }
  if(path === '/airplay-resource' && new URL(req.url,'http://localhost').searchParams.get('r')==='broken') {
    setTimeout(()=>{res.statusCode=502;res.end();},100);return;
  }
  if (path === '/airplay-resource') { const data=readFileSync(sample); res.setHeader('Content-Type','video/mp4'); res.setHeader('Accept-Ranges','bytes'); const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''); if(match){const start=+match[1],end=match[2]?+match[2]:data.length-1;res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${data.length}`);res.end(data.subarray(start,end+1));}else res.end(data);return; }
  if (path === '/harness') {
    res.setHeader('Content-Type', 'text/html');
    const csp=readFileSync(root+'/index.html','utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
    res.end(`${csp}<link rel="stylesheet" href="/vendor/videojs/video-js.min.css"><link rel="stylesheet" href="/airplay-controls.css"><script src="/vendor/videojs/video.min.js"></script><script src="/vendor/videojs/zh-CN.js"></script><div id="stage" style="position:relative;width:800px;height:480px"></div>`); return;
  }
  try { const data = readFileSync(root + path); res.setHeader('Content-Type', ({ '.js':'text/javascript', '.css':'text/css', '.wasm':'application/wasm' })[extname(path)] ?? 'application/octet-stream'); res.end(data); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true, args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
try {
  for (const mode of ['webgl', '2d', 'animation', ...(hls ? ['hls'] : [])]) {
  const page = await browser.newPage();
  await page.addInitScript(mode => {
    if (mode === 'animation') {
      HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
      HTMLVideoElement.prototype.cancelVideoFrameCallback = undefined;
    }
    window.pictures = [];
    window.mediaResource = mode === 'hls' ? 'hls' : '0';
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
          time: document.querySelector('video').currentTime, corner: Array.from(pixels.slice(0, 3)) });
        return result;
      };
      return context;
    };
  }, mode);
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await page.goto(url+'/harness');
  const result = await page.evaluate(async () => {
    const {createAirPlayControls} = await import('/airplay-controls.js');
    window.events=[];
    window.controls=createAirPlayControls(document.getElementById('stage'),event=>events.push(event),'en', {
      fetchPhone:(route,init)=>fetch(route,init),
      credentials:()=>({code:'1234',session:'session'}),host:()=>location.host,
    });
    controls.update({id:1,resource:mediaResource,revision:0,seekRevision:0,target:0,fraction:false,playing:true});
    await new Promise(r=>setTimeout(r,200));
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    return {version:videojs.VERSION,active:controls.videoActive(),fullscreen:document.querySelectorAll('.vjs-fullscreen-control').length,
      stop:document.querySelectorAll('.airplay-stop').length,spinner:document.querySelectorAll('.vjs-loading-spinner').length,
      fill:player.hasClass('vjs-fill')};
  });
  console.log(JSON.stringify({result,errors}));
  if(errors.length || result.fullscreen!==0 || result.stop!==1 || result.spinner!==1 || !result.fill) throw new Error('Player integration failed');
  await page.waitForFunction(()=>events.some(event=>event.k==='ap-state' && event.ready && event.duration>0));
  await page.waitForFunction(()=>new Set(pictures.filter(p=>p.colored).map(p=>p.hash)).size>=2);
  const picture = await page.evaluate(() => ({ ...pictures.at(-1), opacity: getComputedStyle(document.querySelector('video')).opacity,
    canvases: document.querySelectorAll('.airplay-canvas').length }));
  if (!picture.colored || picture.opacity !== '0' || picture.canvases !== 1 || picture.width > 320 || picture.corner.some(Boolean))
    throw new Error('Canvas pixels, source resolution cap, native video hiding or letterboxing failed');
  if ((mode === '2d') !== (picture.type === '2d')) throw new Error('Unexpected canvas renderer');
  console.log(`${mode}: moving video pictures reached the canvas with native video hidden`);
  const progress = await page.evaluate(() => {
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    player.pause(); player.currentTime(Math.min(0.25,player.duration()/3)); const before=player.currentTime();
    controls.update({id:1,resource:mediaResource,revision:1,seekRevision:0,target:0,fraction:false,playing:false});
    const paused=player.currentTime();
    const target=Math.min(0.4,player.duration()/2);
    controls.update({id:1,resource:mediaResource,revision:2,seekRevision:1,target,fraction:false,playing:false});
    return {before,paused,target,seeked:player.currentTime()};
  });
  if(Math.abs(progress.before-progress.paused)>0.01||Math.abs(progress.target-progress.seeked)>0.01)throw new Error('Rate change rolled back progress or new seek was ignored');
  await page.waitForFunction(target => !document.querySelector('video').seeking && Math.abs(pictures.at(-1).time-target)<0.03, progress.target);
  await page.waitForTimeout(150);
  const pausedFrames = await page.evaluate(()=>pictures.length);
  await page.waitForTimeout(150);
  if(await page.evaluate(()=>pictures.length)!==pausedFrames) throw new Error('Paused video keeps drawing');
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
  const muted = await page.evaluate(async () => {
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    controls.audioMuted(true); const blocked=player.muted();
    player.muted(false); await new Promise(resolve=>setTimeout(resolve,50)); const enforced=player.muted();
    controls.audioMuted(false); return {blocked,enforced,restored:!player.muted()};
  });
  if(!muted.blocked || !muted.enforced || !muted.restored) throw new Error('Bluetooth route did not gate HTML video audio');
  await page.locator('.vjs-play-control').click();
  await page.waitForFunction(target=>!document.querySelector('video').paused && pictures.at(-1).time>target+0.05, progress.target);
  await page.locator('.vjs-play-control').click();
  if(!await page.evaluate(()=>document.querySelector('video').paused)) throw new Error('Canvas intercepted player controls');
  await page.evaluate(()=>{
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    player.currentTime(player.duration()-0.15); player.play();
  });
  await page.waitForFunction(()=>document.querySelector('video').ended);
  await page.waitForTimeout(100);
  const endedFrames=await page.evaluate(()=>pictures.length);
  await page.waitForTimeout(100);
  if(await page.evaluate(()=>pictures.length)!==endedFrames) throw new Error('Ended video keeps drawing');
  await page.evaluate(()=>controls.update(null));
  if(await page.locator('.video-js').count()) throw new Error('Player not disposed');
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
  await page.evaluate(()=>controls.update(null));
  if(errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  await page.close();
  }
} finally {await browser.close();await new Promise(r=>server.close(r));}
