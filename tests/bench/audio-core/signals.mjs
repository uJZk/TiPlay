// SPDX-License-Identifier: GPL-3.0-only
// Production kernels versus scalar JS, including scratch copies and small-batch bypass.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AudioKernel, prepareAudioCore } from '../../../site/play/wasm/audio-core.js';
prepareAudioCore(await WebAssembly.compile(fs.readFileSync(new URL('../../../site/play/wasm/audio-core.wasm',import.meta.url))));const k=new AudioKernel();
function time(run,n=100000){for(let i=0;i<10000;i++)run();const start=performance.now();for(let i=0;i<n;i++)run();return (performance.now()-start)*1000/n;}
for(const frames of [64,128,512,4096])for(const channels of [1,2]) {
 const input=Float32Array.from({length:frames*channels},(_,i)=>Math.sin(i)*.2),pcm=Int16Array.from(input,x=>x*32768),output=new Float32Array(input.length);
 const jsConv=()=>{for(let i=0;i<pcm.length;i++)output[i]=pcm[i]/32768;};const wasmConv=()=>k.pcm16(pcm,0,output,0,pcm.length);
 const n=Math.max(2000,Math.floor(5e6/frames));console.log(JSON.stringify({frames,channels,pcm16:{js:time(jsConv,n),wasm:time(wasmConv,n)}}));
}
