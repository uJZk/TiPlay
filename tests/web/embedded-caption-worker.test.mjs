import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demuxCaptionMethods } from '../../scripts/avplayer/caption-patches.mjs';
test('worker credit bounds messages without blocking media; ACK resumes with fresh epoch and drains EOF', () => {
  const sent=[];
  class Channel { postMessage(data){sent.push(data);} close(){} }
  const methods=demuxCaptionMethods({extractor:'var TiPlayCaptionExtractor={extractCaptionTriples:()=>[{type:0,a:65,b:66}]};',packetAPI:'packets',readAPI:'reads',memoryAPI:'memory'});
  const reads={f:[]};reads.f[15]=address=>({128:10,132:1,136:64,172:1,176:1000})[address];reads.f[17]=address=>address===108?2000n:1900n;
  const Pipeline=new Function('BroadcastChannel','reads','packets','memory',`return class Pipeline{${methods}}`)(Channel,reads,{iI:()=>new Uint8Array(10)},{});
  const pipeline=new Pipeline(),task={taskId:'task',formatOptions:{__tiplayCaptionChannel:'tiplay-captions-1234567890',__tiplayCaptionToken:'token-12345678901234567890'},formatContext:{streams:[{index:1,codecpar:{codecType:0,codecId:27}}]}};
  const previous=globalThis.__tiplayCaptionExtractor;delete globalThis.__tiplayCaptionExtractor;
  try{
    for(let i=0;i<100;i++)pipeline.__tiplayCaptionPacket(task,100);
    assert.equal(sent.length,8);assert.equal(task.__tiplayCaptions.pending.size,8);
    const state=task.__tiplayCaptions;
    state.channel.onmessage({data:{kind:'ack',task:'task',token:state.token,sequence:sent[0].sequence}});
    pipeline.__tiplayCaptionPacket(task,100);assert.equal(sent.length,9);assert.equal(sent.at(-1).epoch,1);
    pipeline.__tiplayCaptionEnd(task);assert.equal(sent.length,9);assert.equal(state.pendingEnd,true);
    state.channel.onmessage({data:{kind:'ack',task:'task',token:state.token,sequence:sent[1].sequence}});
    assert.equal(sent.length,10);assert.equal(sent.at(-1).kind,'end');assert.equal(state.pendingEnd,false);
    state.channel.onmessage({data:{kind:'ack',task:'wrong',token:state.token,sequence:sent[2].sequence}});
    assert.equal(state.pending.size,8);
    state.ended=false;pipeline.__tiplayCaptionPacket(task,100);assert.equal(state.lost,true);
    state.channel.onmessage({data:{kind:'ack',task:'task',token:state.token,sequence:sent[2].sequence}});
    pipeline.__tiplayCaptionEnd(task);assert.equal(sent.at(-1).kind,'end');assert.equal(sent.at(-1).epoch,2);
  }finally{globalThis.__tiplayCaptionExtractor=previous;}
});
test('actual HEVC Annex B worker extraction copies only caption bytes and source timestamps', async () => {
  const extractor=await readFile(new URL('../../site/play/vendor/captions/extractor.js',import.meta.url),'utf8'),sent=[];
  const methods=demuxCaptionMethods({extractor,packetAPI:'packets',readAPI:'reads',memoryAPI:'memory'});
  const bytes=new Uint8Array([0,0,0,1,78,1,4,13,181,0,49,71,65,57,52,3,65,255,4,72,73,128]);
  const original=bytes.slice(),reads={f:[]};reads.f[15]=address=>({128:bytes.length,132:1,136:64,172:1,176:1000})[address];reads.f[17]=()=>2500n;
  const Pipeline=new Function('BroadcastChannel','reads','packets','memory',`return class Pipeline{${methods}}`)(class{postMessage(data){sent.push(data);}},reads,{iI:()=>bytes},{});
  const previous=globalThis.__tiplayCaptionExtractor;delete globalThis.__tiplayCaptionExtractor;
  try{
    new Pipeline().__tiplayCaptionPacket({taskId:'hevc',formatOptions:{__tiplayCaptionChannel:'tiplay-captions-1234567890',__tiplayCaptionToken:'token-12345678901234567890'},formatContext:{streams:[{index:1,codecpar:{codecType:0,codecId:173}}]}},100);
    assert.deepEqual(sent[0].triples,[{type:0,a:72,b:73}]);assert.equal(sent[0].pts,2.5);assert.equal(sent[0].dts,2.5);assert.deepEqual(bytes,original);
    assert.equal('packet' in sent[0],false);
  }finally{globalThis.__tiplayCaptionExtractor=previous;}
});
