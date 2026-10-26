// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAudioRecords, MAX_AUDIO_RECORD } from '../../site/play/audio-protocol.js';
import { createBrowserAudio } from '../../site/play/audio.js';
const encode=text=>new TextEncoder().encode(text);
const pcmConfig={codec:'pcm',sampleRate:44100,channels:2,bitDepth:16,littleEndian:true};
function frame(kind,payload,{type=0,channels=2,flags=4,rate=44100,sequence=7,epoch=3,presentationMs=950,decodeTimestampUs=1000000}={}){
 const bytes=new Uint8Array((kind===7?36:28)+payload.length),view=new DataView(bytes.buffer);
 view.setUint32(0,bytes.length-4);bytes[4]=kind;bytes[5]=type;bytes[6]=channels;bytes[7]=flags;
 view.setUint32(8,rate);view.setUint32(12,sequence);view.setUint32(16,epoch);view.setFloat64(20,presentationMs);
 if(kind===7)view.setFloat64(28,decodeTimestampUs);
 bytes.set(payload,kind===7?36:28);return bytes;
}
const configFrame=(config=pcmConfig,options={})=>frame(6,encode(JSON.stringify(config)),{flags:6,...options});
const body=chunks=>new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}});
async function collect(chunks){const records=[];for await(const record of readAudioRecords(body(chunks)))records.push(record);return records;}
async function until(check){for(let turn=0;turn<1000;turn++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('Audio transport did not settle');}
function browser(t,{supported=false}={}){
 const original={AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode,AudioDecoder:globalThis.AudioDecoder,EncodedAudioChunk:globalThis.EncodedAudioChunk},messages=[],decoders=[];
 globalThis.AudioContext=class{constructor(){this.state='suspended';this.currentTime=0;this.audioWorklet={addModule:async()=>{}};this.destination={};}async resume(){this.state='running';}async close(){this.state='closed';}};
 globalThis.AudioWorkletNode=class{constructor(){this.port={postMessage:message=>{messages.push(message);if(message.prepare)queueMicrotask(()=>this.port.onmessage?.({data:{prepared:message.prepare.id}}));}};}connect(){}};
 globalThis.AudioDecoder=class{static async isConfigSupported(config){return{supported,config};}constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.decodeQueueSize=0;this.chunks=[];decoders.push(this);}configure(config){this.config=config;this.state='configured';}decode(chunk){this.chunks.push(chunk);}close(){this.state='closed';}};
 globalThis.EncodedAudioChunk=class{constructor(config){Object.assign(this,config);}};
 t.after(()=>Object.assign(globalThis,original));return{messages,decoders};
}
async function audioHarness(t,codecs){
 const mock=browser(t,codecs),states=[];let controller;
 const audio=createBrowserAudio({ credentials:()=>({code:'pair',session:'session'}),onState:state=>states.push(state),fetchPhone:async()=>({ok:true,body:new ReadableStream({start(value){controller=value;}})})});
 t.after(()=>audio.dispose());await audio.activate();audio.attach(new AbortController().signal,{audio:true});await until(()=>controller);
 return{...mock,audio,controller,states};
}

test('config and compressed records survive one-byte network chunks beside legacy PCM and keepalives',async()=>{
 const samples=new Int16Array([-32768,0,1234,32767]),frames=[new Uint8Array(4),configFrame(),frame(7,new Uint8Array(samples.buffer)),frame(2,new Uint8Array(samples.buffer),{flags:0,epoch:2})];
 const records=await collect(frames.flatMap(bytes=>Array.from(bytes,byte=>Uint8Array.of(byte))));
 assert.equal(records.length,3);assert.deepEqual(records.map(record=>record.kind),[6,7,2]);assert.deepEqual(records[0].config,pcmConfig);
 assert.equal(records[0].mode,'airplay-mirror');assert.equal(records[0].type,0);assert.equal(records[0].epoch,3);assert.equal(records[0].sequence,7);
 assert.equal(records[1].decodeTimestampUs,1000000);assert.equal(records[1].presentationMs,950);assert.deepEqual([...new Int16Array(records[1].payload)],[...samples]);
 assert.equal(records[2].mode,'carplay');assert.deepEqual([...new Int16Array(records[2].pcm)],[...samples]);
});

test('transport rejects short compressed timestamps, oversized configs, invalid JSON and truncated bodies',async()=>{
 const short=frame(7,new Uint8Array()).slice(0,32);new DataView(short.buffer).setUint32(0,short.length-4);
 await assert.rejects(collect([short]),/invalid audio format/);
 await assert.rejects(collect([frame(6,new Uint8Array(16*1024))]),/configuration too large/);
 await assert.rejects(collect([frame(6,encode('{not valid}'))]),/invalid AirPlay audio configuration/);
 const truncated=frame(7,new Uint8Array([1,2,3]));await assert.rejects(collect([truncated.slice(0,-1)]),/truncated audio/);
 const huge=new Uint8Array(4);new DataView(huge.buffer).setUint32(0,MAX_AUDIO_RECORD+1);await assert.rejects(collect([huge]),/invalid audio size/);
});

test('encoded mirror stream 6 coexists with CarPlay codecs and rejects an unlabelled mirror',async()=>{
 const records=await collect([
  configFrame(pcmConfig,{type:0,flags:3}),frame(7,Uint8Array.of(1,2,3,4),{type:0,flags:1}),
  configFrame(pcmConfig,{type:6}),frame(7,Uint8Array.of(5,6,7,8),{type:6}),
 ]);
 assert.deepEqual(records.map(record=>[record.kind,record.type,record.mode]),[
  [6,0,'carplay'],[7,0,'carplay'],[6,6,'airplay-mirror'],[7,6,'airplay-mirror'],
 ]);
 await assert.rejects(collect([configFrame(pcmConfig,{type:6,flags:2})]),/invalid audio format/);
 await assert.rejects(collect([configFrame(pcmConfig,{type:5})]),/invalid audio format/);
});

test('modern AirPlay PCM configuration and packets reach the browser worklet with exact samples and timing',async t=>{
 const{audio,controller,messages}=await audioHarness(t),samples=new Int16Array([-32768,-1,1234,32767]);
 const now=performance.timeOrigin+performance.now();audio.clock({offset:now-1000,at:now,rtt:2});
 controller.enqueue(configFrame({...pcmConfig,sampleRate:48000},{rate:48000}));controller.enqueue(frame(7,new Uint8Array(samples.buffer),{rate:48000}));
 await until(()=>messages.some(record=>record.pcm?.byteLength));const record=messages.find(record=>record.pcm?.byteLength);
 assert.deepEqual([...new Int16Array(record.pcm)],[...samples]);assert.equal(record.mode,'airplay-mirror');assert.equal(record.epoch,3);assert.equal(record.sequence,7);assert.equal(record.rate,48000);assert.equal(record.channels,2);
 assert.equal(record.presentationMs,950);assert.ok(Number.isFinite(record.sourceTime));assert.equal(audio.stats().timedPackets,1);assert.equal(audio.stats().fallbackPackets,0);
 assert.ok(messages.some(record=>record.pcm?.byteLength===0&&(record.flags&2)));
});

test('unsupported compressed AirPlay codec surfaces browser audio error without PCM fallback',async t=>{
 const{audio,controller,messages,states,decoders}=await audioHarness(t);
 controller.enqueue(configFrame({codec:'alac',sampleRate:44100,channels:2,bitDepth:16,samplesPerFrame:352,cookie:Array(36).fill(0)}));controller.enqueue(frame(7,new Uint8Array([1,2,3])));
 await until(()=>audio.stats().error);assert.match(audio.stats().error,/ALAC/);assert.ok(states.some(state=>state.error?.includes('ALAC')));
 assert.equal(messages.filter(record=>record.pcm?.byteLength).length,0);assert.equal(decoders.length,0);assert.equal(audio.stats().fallbackPackets,0);
 for(let sequence=0;sequence<20;sequence++)controller.enqueue(frame(7,new Uint8Array([1,2,3]),{flags:5,sequence}));
 controller.enqueue(configFrame({ended:true},{epoch:4}));
 await until(()=>audio.stats().error===null);
 assert.equal(audio.stats().queuedBytes,0,'unsupported buffered packets release decoder reservations before END');
});

const pcmPacket = () => new Uint8Array(new Int16Array([100, 200]).buffer);
test('ended config retires the PCM NetEq epoch and rejects late codec records', async t=>{
 const {controller,messages,decoders}=await audioHarness(t,{supported:true});
 const c={codec:'pcm',sampleRate:48000,channels:1,bitDepth:16,littleEndian:true};
 controller.enqueue(configFrame(c,{rate:48000,channels:1}));
 controller.enqueue(frame(7,pcmPacket(),{rate:48000,channels:1}));
 await until(()=>messages.some(r=>r.pcm?.byteLength));
 controller.enqueue(configFrame({ended:true},{rate:48000,channels:1,epoch:4}));
 await until(()=>messages.some(r=>r.ended===true));
 const count=messages.filter(r=>r.pcm?.byteLength).length;
 controller.enqueue(frame(7,pcmPacket(),{rate:48000,channels:1,epoch:3}));
 await new Promise(r=>setTimeout(r,10));assert.equal(messages.filter(r=>r.pcm?.byteLength).length,count);
 assert.equal(decoders.length,0);
});
test('Bluetooth microphone demand preserves fallback PCM music and the NetEq epoch', async t=>{
 const {audio,controller,messages,decoders}=await audioHarness(t,{supported:true});
 const c={codec:'pcm',sampleRate:48000,channels:1,bitDepth:16,littleEndian:true};
 controller.enqueue(configFrame(c,{rate:48000,channels:1,flags:3}));
 controller.enqueue(frame(7,pcmPacket(),{rate:48000,channels:1,flags:1}));
 await until(()=>messages.some(r=>r.pcm?.byteLength));
 const resets=messages.filter(r=>r.reset).length;
 audio.status({voice:{revision:1,state:'active',muted:true}});
 controller.enqueue(frame(2,new Uint8Array(),{type:5,channels:1,flags:16,epoch:2}));
 controller.enqueue(frame(7,pcmPacket(),{rate:48000,channels:1,flags:1,sequence:8,decodeTimestampUs:1020000}));
 await until(()=>messages.filter(r=>r.pcm?.byteLength).length===2);
 assert.equal(decoders.length,0);assert.equal(messages.filter(r=>r.reset).length,resets);
 assert.equal(audio.stats().browserMuted,false);
});
