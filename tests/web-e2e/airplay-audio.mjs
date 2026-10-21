// SPDX-License-Identifier: GPL-3.0-only
// Actual browser WebCodecs smoke for ordinary AirPlay compressed audio.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const opusFixture=JSON.parse(readFileSync(new URL('../web/fixtures/airplay-opus.json',import.meta.url)));
const root=fileURLToPath(new URL('../../site/play/',import.meta.url)), fixture=JSON.parse(readFileSync(new URL('../web/fixtures/airplay-aac-lc.json',import.meta.url)));
const runtimeFiles=['airplay-audio-decoder.js','audio-pcm-stats.js','aac-eld-software.js','aac-eld-worker.js','vendor/aac-eld/aac-eld.js'];
const runtimeIdentity=()=>Object.fromEntries(runtimeFiles.map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
const runtimeBefore=runtimeIdentity(),eldBytes=readFileSync(new URL('../web/fixtures/aac-eld/44100-2-480-tone.bin',import.meta.url)),eldPackets=[];
for(let offset=0;offset<eldBytes.length;){const length=eldBytes.readUInt32LE(offset);offset+=4;eldPackets.push(eldBytes.subarray(offset,offset+length));offset+=length;}
const eldFixture={config:{codec:'aac-eld',sampleRate:44100,channels:2,bitDepth:16,samplesPerFrame:480,asc:[...eldPackets.shift()]},
 packets:eldPackets.slice(0,4).map((payload,index)=>({payload:payload.toString('base64'),timestampUs:index*480e6/44100}))};
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
 const noData=[];
 for(const [source,software] of [[{...fixture,packets:fixture.packets.slice(0,4)},false],[eldFixture,true]]){
  const checked=await page.evaluate(async({source,software})=>{
   const {createAirPlayAudioDecoder}=await import('/airplay-audio-decoder.js');
   const frameUs=source.config.samplesPerFrame*1e6/source.config.sampleRate;
   async function render(silentPackets){
    const outputs=[],errors=[];
    const decoder=createAirPlayAudioDecoder({onPcm:record=>{if(record.pcm.byteLength)outputs.push(record);},onError:error=>errors.push(error.message),
     ...(software?{AudioDecoder:null,EncodedAudioChunk:null}:{})});
    try{
     decoder.debug(true);
     const common={type:6,mode:'airplay-mirror',epoch:7,rate:source.config.sampleRate,channels:source.config.channels};
     if(!await decoder.configure({...common,flags:6,config:source.config}))throw new Error('NoData oracle codec unavailable');
     let sequence=0;
     const submit=(payload,decodeTimestampUs)=>decoder.decode({...common,flags:4,sequence:sequence++,payload,
      decodeTimestampUs,presentationMs:10000+decodeTimestampUs/1000});
     for(const [index,packet] of source.packets.entries()){
      if(index===2)for(let silent=0;silent<silentPackets;silent++)
       if(!await submit(Uint8Array.of(0,0x68,0x34,0).buffer,source.packets[1].timestampUs+(silent+1)*frameUs))throw new Error('NoData rejected');
      const timestamp=packet.timestampUs+(index>=2?silentPackets*frameUs:0);
      if(!await submit(Uint8Array.from(atob(packet.payload),c=>c.charCodeAt(0)).buffer,timestamp))throw new Error('Real AAC packet rejected');
     }
     const expected=source.packets.length+silentPackets,deadline=performance.now()+5000;
     while(outputs.length<expected&&!errors.length&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
     if(errors.length||outputs.length!==expected)throw new Error(`NoData output count ${outputs.length}/${expected}, errors=${errors.length}`);
     return{outputs,stats:decoder.stats()};
    }finally{decoder.dispose();}
   }
   const baseline=await render(0),withSilence=await render(19);
   let maximumRealSampleDifference=0,silenceFrames=0,silenceAllZero=true,maximumGapUs=0,metadataValid=true;
   for(const [index,record]of withSilence.outputs.entries()){
    const samples=new Int16Array(record.pcm),silent=index>=2&&index<21;
    metadataValid&&=record.type===6&&record.epoch===7&&record.sequence===index&&record.flags===4
     &&record.channels===source.config.channels&&record.rate===source.config.sampleRate
     &&Math.abs(record.presentationMs-10000-record.decodeTimestampUs/1000)<1e-6;
    if(index){const previous=withSilence.outputs[index-1];maximumGapUs=Math.max(maximumGapUs,
     Math.abs(record.decodeTimestampUs-previous.decodeTimestampUs-previous.pcm.byteLength/2/previous.channels*1e6/previous.rate));}
    if(silent){silenceFrames+=samples.length/record.channels;silenceAllZero&&=samples.every(value=>value===0);}
    else{
     const expected=new Int16Array(baseline.outputs[index<2?index:index-19].pcm);
     if(samples.length!==expected.length)throw new Error('Native drain changed real AAC output size');
     for(let sample=0;sample<samples.length;sample++)maximumRealSampleDifference=Math.max(maximumRealSampleDifference,Math.abs(samples[sample]-expected[sample]));
    }
   }
   return{codec:source.config.codec,backend:withSilence.stats.stream6.backend,samplesPerFrame:source.config.samplesPerFrame,
    outputPackets:withSilence.outputs.length,noDataPackets:withSilence.stats.noDataPackets,noDataFrames:withSilence.stats.noDataFrames,
    silenceFrames,silenceAllZero,maximumRealSampleDifference,maximumGapUs,metadataValid,physicalOutputMeasured:false,
    ...(maximumGapUs>=2?{sourceCoordinates:withSilence.outputs.map(record=>({startUs:record.decodeTimestampUs,
     frames:record.pcm.byteLength/2/record.channels,sequence:record.sequence}))}:{})};
  },{source,software});
  if(checked.maximumGapUs>=2||checked.maximumRealSampleDifference)console.error(JSON.stringify({noDataOracle:checked}));
  assert.equal(checked.backend,software?'software':'webcodecs');assert.equal(checked.noDataPackets,19);
  assert.equal(checked.noDataFrames,19*source.config.samplesPerFrame);assert.equal(checked.silenceFrames,checked.noDataFrames);
  assert.equal(checked.silenceAllZero,true);assert.equal(checked.maximumRealSampleDifference,0,`${checked.codec}/${checked.backend} resumed real PCM differs from uninterrupted baseline`);
  assert.ok(checked.maximumGapUs<2,`${checked.codec}/${checked.backend} decoded source gap=${checked.maximumGapUs}us must remain below 2us`);
  assert.equal(checked.metadataValid,true);noData.push(checked);
 }
 assert.equal(result.available,true,`AAC-LC unavailable: ${result.errors.join('; ')}`);assert.equal(result.errors.length,0);assert.ok(result.frames>1);assert.equal(result.timelineFrames,result.frames,'every asynchronous AAC output must survive the timeline sequence guard');assert.ok(result.totalSamples>2048);assert.equal(result.nonzero,true);assert.ok(result.metadata.every(r=>r.epoch===1&&r.rate===44100&&r.channels===2&&Number.isFinite(r.presentationMs)));assert.deepEqual(pageErrors,[]);
 assert.deepEqual(runtimeIdentity(),runtimeBefore,'Runtime sources changed during native NoData verification');
 console.log(JSON.stringify({browser:await browser.version(),aacLc:{frames:result.frames,totalSamples:result.totalSamples,nonzero:result.nonzero},opus,capabilities:result.capabilities,
  noData,runtimeSha256:runtimeBefore,physicalOutputMeasured:false}));
}catch(error){process.exitCode=1;console.error(error);}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
