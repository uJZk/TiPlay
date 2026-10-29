// SPDX-License-Identifier: GPL-3.0-only

export function demuxCaptionMethods({ extractor, packetAPI, readAPI, memoryAPI }) {
  return `
__tiplayCaptionState(task){
  const options=task.formatOptions;
  if(!options || typeof options.__tiplayCaptionChannel!=='string' || typeof options.__tiplayCaptionToken!=='string'
    || !/^[a-z0-9-]{20,100}$/i.test(options.__tiplayCaptionChannel) || !/^[a-z0-9-]{20,100}$/i.test(options.__tiplayCaptionToken)
    || typeof BroadcastChannel!=='function')return null;
  if(!task.__tiplayCaptions){
    const state={channel:new BroadcastChannel(options.__tiplayCaptionChannel),token:options.__tiplayCaptionToken,epoch:0,stream:-1,ended:false,sequence:0,pending:new Set(),lost:false};
    state.channel.onmessage=({data})=>{if(data?.kind==='ack'&&data.token===state.token&&data.task===task.taskId&&Number.isSafeInteger(data.sequence)){
      state.pending.delete(data.sequence);
      if(state.pendingEnd&&state.pending.size<8){state.pendingEnd=false;if(state.lost){state.epoch++;state.lost=false;}this.__tiplayCaptionSend(task,state,{kind:'end'});}
    }};
    task.__tiplayCaptions=state;
  }
  return task.__tiplayCaptions;
}
__tiplayCaptionSend(task,state,message){
  if(state.pending.size>=8){return false;}
  const sequence=++state.sequence;state.pending.add(sequence);
  state.channel.postMessage({...message,task:task.taskId,stream:state.stream,token:state.token,epoch:state.epoch,sequence});
  return true;
}
__tiplayCaptionReset(task){const state=this.__tiplayCaptionState(task);if(!state)return;state.epoch++;state.ended=false;state.pendingEnd=false;
  if(state.stream>=0&&!this.__tiplayCaptionSend(task,state,{kind:'reset'}))state.lost=true;}
__tiplayCaptionEnd(task){const state=this.__tiplayCaptionState(task);if(!state||state.ended)return;state.ended=true;
  if(state.lost){state.epoch++;state.lost=false;}
  if(state.stream>=0)state.pendingEnd=!this.__tiplayCaptionSend(task,state,{kind:'end'});}
__tiplayCaptionPacket(task,packet){
  const state=this.__tiplayCaptionState(task);if(!state)return;
  try{
    const index=${readAPI}.f[15](packet+32),stream=task.formatContext.streams.find(stream=>stream.index===index);
    if(!stream||stream.codecpar.codecType!==0||![27,173].includes(stream.codecpar.codecId))return;
    const flags=${readAPI}.f[15](packet+36);if(flags&2){this.__tiplayCaptionReset(task);return;}
    const size=${readAPI}.f[15](packet+28);if(size<1||size>8388608)return;
    const numerator=${readAPI}.f[15](packet+72),denominator=${readAPI}.f[15](packet+76);
    if(numerator<=0||denominator<=0)return;
    const rawPts=${readAPI}.f[17](packet+8),rawDts=${readAPI}.f[17](packet+16);
    if(rawPts===-9223372036854775808n)return;
    const pts=Number(rawPts)*numerator/denominator,dts=rawDts===-9223372036854775808n?pts:Number(rawDts)*numerator/denominator;
    if(!Number.isFinite(pts)||!Number.isFinite(dts)||Math.abs(pts)>1e10||Math.abs(dts)>1e10)return;
    if(!globalThis.__tiplayCaptionExtractor){globalThis.__tiplayCaptionExtractor=(()=>{${extractor};return TiPlayCaptionExtractor;})();}
    let configuration=stream.sideData?.[1];
    if(!configuration&&stream.codecpar.extradata&&stream.codecpar.extradataSize>0&&stream.codecpar.extradataSize<=65536)
      configuration=${memoryAPI}.s3(stream.codecpar.extradata,stream.codecpar.extradataSize);
    const triples=globalThis.__tiplayCaptionExtractor.extractCaptionTriples(${packetAPI}.iI(packet),
      {ptsSeconds:pts,codec:stream.codecpar.codecId===27?'avc':'hevc',format:flags&64?'annexb':'length-prefixed',configuration});
    if(triples.length>256){state.lost=true;return;}
    if(!triples.length&&state.pending.size>=4)return;
    // A dropped watermark has no decoder state. Only losing actual cc_data
    // requires a new epoch; otherwise preloading would repeatedly erase cues.
    if(state.pending.size>=8){if(triples.length)state.lost=true;return;}
    if(state.lost){state.epoch++;state.lost=false;}
    state.stream=index;state.ended=false;state.pendingEnd=false;
    this.__tiplayCaptionSend(task,state,{kind:'packet',pts,dts,triples:triples.map(({type,a,b})=>({type,a,b}))});
  }catch(_){this.__tiplayCaptionReset(task);}
}
__tiplayCaptionClose(task){const state=task?.__tiplayCaptions;if(state){state.channel.close();delete task.__tiplayCaptions;}}
`;
}

export const subtitleCaptionMethods = `
__tiplaySetEmbedded(events){this.reset();for(const event of events)this.__tiplayPushEmbedded(event);}
__tiplayPushEmbedded(event){
  if(!this.options.__tiplayEmbedded||!event||typeof event.text!=='string'||event.text.length>8192||!Number.isFinite(event.time))return;
  const queue=this.__tiplayEmbeddedEvents ||= [];
  if(queue.length>=1024||queue.reduce((sum,value)=>sum+value.text.length,0)+event.text.length>262144){this.reset();return;}
  queue.push({pts:BigInt(Math.round(event.time*1000)),text:event.text});queue.sort((a,b)=>a.pts<b.pts?-1:a.pts>b.pts?1:0);
}
__tiplayTickEmbedded(){
  if(!this.options.__tiplayEmbedded)return;
  const queue=this.__tiplayEmbeddedEvents ||= [],currentTime=this.options.getCurrentTime()-this.delay;
  let update;
  while(queue.length&&queue[0].pts<=currentTime)update=queue.shift();
  if(update){this.render.clearAll();if(update.text){
    const event=this.text2AssEvent(update.text,update.pts,update.pts+1000n);
    event.__tiplayEmbeddedPersistent=true;this.render.render(event);
  }}
}
`;
