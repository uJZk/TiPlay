// SPDX-License-Identifier: GPL-3.0-only
// Actual browser WebCodecs smoke for ordinary AirPlay compressed audio.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const opusFixture=JSON.parse(readFileSync(new URL('../web/fixtures/airplay-opus.json',import.meta.url)));
const root=fileURLToPath(new URL('../../site/play/',import.meta.url)), fixture=JSON.parse(readFileSync(new URL('../web/fixtures/airplay-aac-lc.json',import.meta.url)));
const server=createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 if(pathname==='/harness'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>TiPlay AirPlay audio decoder smoke</title>');return;}
 const path=resolve(root,`.${pathname}`);if(!path.startsWith(root)){response.writeHead(403);response.end();return;}
 try{response.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'application/octet-stream');response.end(readFileSync(path));}catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--no-proxy-server','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
 const result=await page.evaluate(async fixture=>{
  const {createAirPlayAudioDecoder}=await import('/airplay-audio-decoder.js');
  const {PcmTimeline}=await import('/pcm-timeline.js');
  const timeline=new PcmTimeline(44100,2,()=>{},1000);
  const outputs=[],errors=[],decoder=createAirPlayAudioDecoder({onPcm:record=>{if(record.pcm?.byteLength){timeline.push({...record,sourceTime:record.presentationMs});outputs.push({samples:Array.from(new Int16Array(record.pcm)),rate:record.rate,channels:record.channels,epoch:record.epoch,presentationMs:record.presentationMs});}},onError:error=>errors.push(error.message)});
  const available=await decoder.configure({type:6,epoch:1,mode:'airplay-mirror',flags:2,rate:44100,channels:2,config:fixture.config});
  if(available){for(const packet of fixture.packets){const payload=Uint8Array.from(atob(packet.payload),c=>c.charCodeAt(0));await decoder.decode({type:6,epoch:1,mode:'airplay-mirror',flags:0,rate:44100,channels:2,decodeTimestampUs:packet.timestampUs,presentationMs:10000+packet.timestampUs/1000,payload:payload.buffer});}
   const deadline=performance.now()+5000;while(outputs.length<fixture.packets.length&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));}
  decoder.dispose();
  const capabilities={};for(const config of[{codec:'mp4a.40.39',sampleRate:44100,numberOfChannels:2,description:new Uint8Array([248,232,80,0])},{codec:'alac',sampleRate:44100,numberOfChannels:2,description:new Uint8Array(36)}]){try{capabilities[config.codec]=(await AudioDecoder.isConfigSupported(config)).supported;}catch{capabilities[config.codec]=false;}}
  return{available,errors,frames:outputs.length,timelineFrames:timeline.queue.length,totalSamples:outputs.reduce((n,r)=>n+r.samples.length,0),nonzero:outputs.some(r=>r.samples.some(n=>n!==0)),metadata:outputs.map(({samples,...metadata})=>metadata),capabilities};
 },fixture);
 const opus=await page.evaluate(async fixture=>{const{createAirPlayAudioDecoder}=await import('/airplay-audio-decoder.js');const{PcmTimeline}=await import('/pcm-timeline.js');const outputs=[],errors=[],timeline=new PcmTimeline(48000,2,()=>{},1000);const decoder=createAirPlayAudioDecoder({onPcm:r=>{if(r.pcm.byteLength){outputs.push(r);timeline.push({...r,sourceTime:r.presentationMs});}},onError:e=>errors.push(e.message)});const available=await decoder.configure({type:1,epoch:1,mode:'carplay',flags:2,rate:48000,channels:2,config:fixture.config});for(const packet of fixture.packets){const timestamp=packet.timestamp*1e6;await decoder.decode({type:1,epoch:1,mode:'carplay',flags:0,rate:48000,channels:2,decodeTimestampUs:timestamp,presentationMs:10000+timestamp/1000,payload:Uint8Array.from(atob(packet.payload),c=>c.charCodeAt(0)).buffer});}const deadline=performance.now()+5000;while(outputs.length<fixture.packets.length&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));const result={available,errors,frames:outputs.length,uniqueSequences:new Set(outputs.map(r=>r.sequence)).size,nonzero:outputs.some(r=>[...new Int16Array(r.pcm)].some(v=>v!==0))};decoder.dispose();timeline.clear();return result;},opusFixture);assert.equal(opus.available,true);assert.deepEqual(opus.errors,[]);assert.ok(opus.frames>1);assert.equal(opus.uniqueSequences,opus.frames);assert.equal(opus.nonzero,true);
 assert.equal(result.available,true,`AAC-LC unavailable: ${result.errors.join('; ')}`);assert.equal(result.errors.length,0);assert.ok(result.frames>1);assert.equal(result.timelineFrames,result.frames,'every asynchronous AAC output must survive the timeline sequence guard');assert.ok(result.totalSamples>2048);assert.equal(result.nonzero,true);assert.ok(result.metadata.every(r=>r.epoch===1&&r.rate===44100&&r.channels===2&&Number.isFinite(r.presentationMs)));assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({browser:await browser.version(),aacLc:{frames:result.frames,totalSamples:result.totalSamples,nonzero:result.nonzero},opus,capabilities:result.capabilities}));
}catch(error){process.exitCode=1;console.error(error);}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
