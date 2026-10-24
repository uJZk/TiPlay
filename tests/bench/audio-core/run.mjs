// SPDX-License-Identifier: GPL-3.0-only
// Includes all JS<->WASM scratch copies. No decoder/resampler time in either path.
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { AudioKernel, prepareAudioCore } from '../../../site/play/wasm/audio-core.js';
prepareAudioCore(await WebAssembly.compile(await readFile(new URL('../../../site/play/wasm/audio-core.wasm', import.meta.url))));
const kernel = new AudioKernel();
function original(continuous, retiring, output, gain, step, debug) {
  const frames=output[0].length;
  for(const channel of output)channel.fill(0);
  for(let i=0;i<frames;i++) {
    let voice=false;
    for(const [type,t,produced] of continuous)if(type>=1&&type<=4) {
      if(t.state==='playing'||i<produced)voice=true;
      else for(let c=0;c<t.channels;c++)if(t.block[i*t.channels+c])voice=true;
    }
    const target=voice?.2:1;
    gain+=Math.sign(target-gain)*Math.min(step,Math.abs(target-gain));
    for(const [type,t] of continuous)for(let c=0;c<output.length;c++)output[c][i]+=t.block[i*t.channels+Math.min(c,t.channels-1)]*((type===0||type===6)?gain:1);
  }
  for(const channel of output)for(let i=0;i<channel.length;i++){
    channel[i]=Math.max(-1,Math.min(1,channel[i]));
    if(debug){if(channel[i])debug.renderNonzero++;debug.renderPeak=Math.max(debug.renderPeak,Math.abs(channel[i]));}
  }
  return gain;
}
function measure(run, iterations) {
  for(let i=0;i<1000;i++)run();
  const start=performance.now();for(let i=0;i<iterations;i++)run();return (performance.now()-start)*1000/iterations;
}
for(const frames of [64,128,256,1024])for(const count of [1,2,4,8])for(const debug of [false,true]) {
  const active=Array.from({length:count},(_,s)=>[s===0?0:s%2?1:6,{channels:s%2+1,state:'playing',block:Float32Array.from({length:frames*(s%2+1)},(_,i)=>Math.sin((i+s)*.17)*.1)},frames]);
  const output=[new Float32Array(frames),new Float32Array(frames)],metrics=debug?{renderPeak:0,renderNonzero:0}:null;
  let gain=1;const step=.8/240;
  const js=()=>{gain=original(active,[],output,gain,step,metrics);};
  const wasm=()=>{gain=kernel.mix(active,[],output,gain,step,metrics);};
  const n=Math.max(3000,Math.floor(2e6/frames));
  const samples=[];
  for(let trial=0;trial<5;trial++) samples.push(trial%2?{wasm:measure(wasm,n),js:measure(js,n)}:{js:measure(js,n),wasm:measure(wasm,n)});
  const median=key=>samples.map(s=>s[key]).sort((a,b)=>a-b)[2];
  console.log(JSON.stringify({frames,streams:count,debug,jsUs:median('js'),wasmUs:median('wasm'),speedup:median('js')/median('wasm')}));
}
