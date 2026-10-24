// SPDX-License-Identifier: GPL-3.0-only
// Production kernels versus scalar JS, including scratch copies and small-batch bypass.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AudioKernel, prepareAudioCore } from '../../../site/play/wasm/audio-core.js';
prepareAudioCore(await WebAssembly.compile(fs.readFileSync(new URL('../../../site/play/wasm/audio-core.wasm',import.meta.url))));const k=new AudioKernel();
function time(run,n=100000){for(let i=0;i<10000;i++)run();const start=performance.now();for(let i=0;i<n;i++)run();return (performance.now()-start)*1000/n;}
for(const frames of [64,128,512,4096])for(const channels of [1,2]) {
 const input=Float32Array.from({length:frames*channels},(_,i)=>Math.sin(i)*.2),pcm=Int16Array.from(input,x=>x*32768),output=new Float32Array(input.length);const state={channels,fadeFrames:240,gain:.2,recoveryRemaining:200,tailRemaining:240,last:new Float32Array(channels),recoveryTail:new Float32Array(channels)};
 const js=()=>{for(let i=0;i<frames;i++){state.gain=Math.min(1,state.gain+1/240);const e=state.recoveryRemaining>0?(state.recoveryRemaining-1)/state.recoveryRemaining:0;for(let c=0;c<channels;c++){state.recoveryTail[c]*=e;const v=input[i*channels+c]*state.gain+state.recoveryTail[c];output[i*channels+c]=v;state.last[c]=v;}state.recoveryRemaining=Math.max(0,state.recoveryRemaining-1);state.tailRemaining=240;}};
 const wasm=()=>k.fresh(input,0,output,0,frames,state);
 const jsConv=()=>{for(let i=0;i<pcm.length;i++)output[i]=pcm[i]/32768;};const wasmConv=()=>k.pcm16(pcm,0,output,0,pcm.length);
 const n=Math.max(2000,Math.floor(5e6/frames));console.log(JSON.stringify({frames,channels,fresh:{js:time(js,n),wasm:time(wasm,n)},pcm16:{js:time(jsConv,n),wasm:time(wasmConv,n)}}));
}
