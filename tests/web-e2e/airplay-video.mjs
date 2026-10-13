import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = fileURLToPath(new URL('../../site/play/', import.meta.url)).replace(/\/$/, '');
const sample = process.env.TEST_VIDEO_MP4;
if (!sample) throw new Error('Set TEST_VIDEO_MP4 to an ordinary playable MP4 fixture');
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
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
  const page = await browser.newPage();
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await page.goto(url+'/harness');
  const result = await page.evaluate(async () => {
    const {createAirPlayControls} = await import('/airplay-controls.js');
    window.events=[];
    window.controls=createAirPlayControls(document.getElementById('stage'),event=>events.push(event),'en', {
      fetchPhone:(route,init)=>fetch(route,init),
      credentials:()=>({code:'1234',session:'session'}),host:()=>location.host,
    });
    controls.update({id:1,resource:'0',revision:0,seekRevision:0,target:0,fraction:false,playing:true});
    await new Promise(r=>setTimeout(r,200));
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    return {version:videojs.VERSION,active:controls.videoActive(),fullscreen:document.querySelectorAll('.vjs-fullscreen-control').length,
      stop:document.querySelectorAll('.airplay-stop').length,spinner:document.querySelectorAll('.vjs-loading-spinner').length,
      fill:player.hasClass('vjs-fill')};
  });
  console.log(JSON.stringify({result,errors}));
  if(errors.length || result.fullscreen!==0 || result.stop!==1 || result.spinner!==1 || !result.fill) throw new Error('Player integration failed');
  await page.waitForFunction(()=>events.some(event=>event.k==='ap-state' && event.ready && event.duration>0));
  console.log('MP4 decoded and browser playback state reached the control path');
  const progress = await page.evaluate(() => {
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    player.pause(); player.currentTime(Math.min(0.25,player.duration()/3)); const before=player.currentTime();
    controls.update({id:1,resource:'0',revision:1,seekRevision:0,target:0,fraction:false,playing:false});
    const paused=player.currentTime();
    const target=Math.min(0.4,player.duration()/2);
    controls.update({id:1,resource:'0',revision:2,seekRevision:1,target,fraction:false,playing:false});
    return {before,paused,target,seeked:player.currentTime()};
  });
  if(Math.abs(progress.before-progress.paused)>0.01||Math.abs(progress.target-progress.seeked)>0.01)throw new Error('Rate change rolled back progress or new seek was ignored');
  const muted = await page.evaluate(async () => {
    const player=Object.values(videojs.getPlayers()).find(Boolean);
    controls.audioMuted(true); const blocked=player.muted();
    player.muted(false); await new Promise(resolve=>setTimeout(resolve,50)); const enforced=player.muted();
    controls.audioMuted(false); return {blocked,enforced,restored:!player.muted()};
  });
  if(!muted.blocked || !muted.enforced || !muted.restored) throw new Error('Bluetooth route did not gate HTML video audio');
  await page.evaluate(()=>controls.update(null));
  if(await page.locator('.video-js').count()) throw new Error('Player not disposed');
} finally {await browser.close();await new Promise(r=>server.close(r));}
