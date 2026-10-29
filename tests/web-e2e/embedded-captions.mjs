import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureVideoDecoder } from './avplayer-hardware-override.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root=fileURLToPath(new URL('../../site/play/',import.meta.url));
const fixture=process.env.CAPTION_FIXTURE;if(!fixture)throw new Error('Set CAPTION_FIXTURE from embedded-caption-fixture.mjs');
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/harness'){res.setHeader('Content-Type','text/html');const csp=readFileSync(join(root,'index.html'),'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];res.end(csp+'<div id="stage" style="position:relative;width:800px;height:480px"></div>');return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.vtt':'text/vtt'})[extname(path)]||'application/octet-stream');
    res.end(readFileSync(path.startsWith('/fixture/')?join(fixture,path.slice(9)):join(root,path)));}
  catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--no-proxy-server','--autoplay-policy=no-user-gesture-required']});
try{
  const page=await browser.newPage(), errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
  if(process.env.AVPLAYER_DEBUG)page.on('console',e=>console.log(e.type(),e.text()));
  await page.addInitScript(()=>{window.videoCreates=0;const create=Document.prototype.createElement;Document.prototype.createElement=function(name,...args){if(String(name).toLowerCase()==='video')videoCreates++;return create.call(this,name,...args);};});
  await configureVideoDecoder(page);await page.goto(origin+'/harness');
  await page.evaluate(async()=>{
    const {default:Player}=await import('/vendor/libmedia/avplayer.js');
    window.player=new Player({container:document.querySelector('#stage'),checkUseMSE:()=>false,enableWorker:true,enableWebGPU:false,enableAudioWorklet:true,preLoadTime:4});
    window.startup = player.load(location.origin+'/fixture/master.m3u8').then(()=>player.play());
  });
  await page.waitForFunction(()=>player.getEmbeddedSubtitleList().length===2,null,{timeout:30000}).catch(async e=>{console.log('startup',await page.evaluate(()=>({status:player.getStatus(),time:String(player.currentTime),tracks:player.getEmbeddedSubtitleList(),diag:player.getEmbeddedCaptionDiagnostics()})));throw e;});
  await page.evaluate(async()=>{const factory=player.__tiplayCreateEmbeddedSubtitleRender.bind(player);player.__tiplayCreateEmbeddedSubtitleRender=async()=>window.captionRender=await factory();await player.selectEmbeddedSubtitle('cea608-1');});
  const timing=await page.evaluate(()=>({clock:Number(player.currentTime),pts:Number(captionRender.__tiplayEmbeddedEvents.find(e=>e.text==='HI')?.pts),text:document.querySelector('#stage').textContent}));
  if(!Number.isFinite(timing.pts)||timing.clock>=timing.pts||timing.text.includes('HI'))throw new Error('Caption was not queued ahead of source PTS');
  await page.waitForFunction(()=>document.querySelector('#stage').textContent.includes('HI'),null,{timeout:15000}).catch(async e=>{console.log('render',await page.evaluate(()=>({status:player.getStatus(),time:String(player.currentTime),diag:player.getEmbeddedCaptionDiagnostics(),queue:captionRender.__tiplayEmbeddedEvents,started:captionRender.loop.isStarted(),clock:String(captionRender.options.getCurrentTime()),store:captionRender.render.store,html:document.querySelector('#stage').innerHTML})));throw e;});
  const canvas=page.locator('#stage canvas'),firstPicture=await canvas.screenshot();
  await page.waitForTimeout(1300);
  if(firstPicture.equals(await canvas.screenshot()))throw new Error('AVC Canvas pictures did not advance');
  if(!await page.evaluate(()=>document.querySelector('#stage').textContent.includes('HI')))throw new Error('Caption expired at its ASS compile duration');
  await page.evaluate(()=>player.pause());
  const paused=await page.evaluate(()=>({time:Number(player.currentTime),text:document.querySelector('#stage').textContent}));
  await page.waitForTimeout(300);
  if(!paused.text.includes('HI')||!await page.evaluate(()=>document.querySelector('#stage').textContent.includes('HI')))throw new Error('Pause lost displayed caption');
  await page.evaluate(()=>player.selectEmbeddedSubtitle('cea708-1'));
  await page.waitForFunction(()=>document.querySelector('#stage').textContent.includes('DTV')&&!document.querySelector('#stage').textContent.includes('HI'));
  await page.evaluate(()=>player.setSubtitleEnable(false));
  await page.waitForFunction(()=>!document.querySelector('#stage').textContent.trim());
  await page.evaluate(()=>player.setSubtitleEnable(true));
  await page.waitForFunction(()=>document.querySelector('#stage').textContent.includes('DTV'));
  await page.evaluate(()=>{captionRender.__tiplaySetEmbedded([{time:Number(player.currentTime)/1000,text:'<img src=x onerror=alert(1)> {\\pos(1,1)}'}]);captionRender.__tiplayTickEmbedded();});
  if(!await page.evaluate(()=>document.querySelector('#stage').textContent.includes('<img src=x onerror=alert(1)> {\\pos(1,1)}')&&!document.querySelector('#stage img')))throw new Error('Caption markup was interpreted');
  for(let i=0;i<2;i++){
    await page.evaluate(async()=>{await player.selectSubtitle(0);player.setSubtitleEnable(true);});
    await page.waitForFunction(()=>document.querySelector('#stage').textContent.includes('External caption')&&!document.querySelector('#stage').textContent.includes('DTV'));
    await page.evaluate(()=>player.selectEmbeddedSubtitle('cea708-1'));
    await page.waitForFunction(()=>document.querySelector('#stage').textContent.includes('DTV')&&!document.querySelector('#stage').textContent.includes('External caption'));
    await page.evaluate(()=>player.setSubtitleEnable(false));
    await page.waitForFunction(()=>!document.querySelector('#stage').textContent.trim());
  }
  await page.evaluate(async()=>{await player.seek(5000n);await player.selectEmbeddedSubtitle('cea608-1');await player.play();});
  await page.waitForFunction(()=>Number(player.currentTime)>9500,null,{timeout:15000});
  if(await page.evaluate(()=>document.querySelector('#stage').textContent.includes('HI')))throw new Error('Explicit608 clear failed');
  await page.evaluate(async()=>{await player.load(location.origin+'/fixture/clean.m3u8');await player.play();});
  await page.waitForFunction(()=>Number(player.currentTime)>2000,null,{timeout:15000});
  if(await page.evaluate(()=>player.getEmbeddedSubtitleList().length||document.querySelector('#stage').textContent.trim()))throw new Error('Replacement no-SEI source retained captions');
  await page.evaluate(()=>player.stop());
  if(await page.evaluate(()=>document.querySelector('#stage').textContent.trim()))throw new Error('Stop retained captions');
  await page.evaluate(()=>player.destroy());
  if(await page.evaluate(()=>window.videoCreates||typeof SharedArrayBuffer!=='undefined'))throw new Error('Expected Canvas without video elements or SAB');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS real AVC HLS608/708 source-PTS rendering, dwell, pause, native WebVTT coexistence, literal text, off/on, seek, clear, no-SEI replacement, stop/destroy; non-SAB Canvas.');
}finally{await browser.close();server.close();}
