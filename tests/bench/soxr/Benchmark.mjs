// Independent, wrapper-identical engine benchmark. JSON stdout; one engine per process.
// node --disallow-code-generation-from-strings Benchmark.mjs wasm|/absolute/factory.mjs [blocks=4000] [warmup=500]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SoxrRuntime, StreamingResampler } from './Pinned-streaming-resampler.mjs';
const backend=process.argv[2]||'wasm', blocks=Number(process.argv[3]||4000), warmup=Number(process.argv[4]||500);
const heapStart=process.memoryUsage(), started=performance.now();
let runtime, startup={};
if(backend==='wasm') {
 const bytes=readFileSync(new URL('./Existing.wasm',import.meta.url));
 const loaded=performance.now(), module=await WebAssembly.compile(bytes), compiled=performance.now();
 runtime=new SoxrRuntime(module);startup={readMs:loaded-started,compileMs:compiled-loaded,factoryMs:performance.now()-compiled,assetBytes:bytes.byteLength};
} else {
 // Any attempt by the candidate to instantiate WASM fails; JS dynamic compilation is also forbidden by the command-line flag.
 globalThis.WebAssembly=undefined;
 const factory=(await import(pathToFileURL(backend).href)).default, imported=performance.now();
 const module=await factory(), initialized=performance.now();
 const api={memory:module.exports?.memory||{get buffer(){return module.HEAPU8.buffer;}}};
 for(const name of ['tiplay_create','tiplay_process','tiplay_ratio','tiplay_input_done','tiplay_output_done','tiplay_delete','malloc','free'])api[name]=module['_'+name];
 runtime={exports:api,calibrations:new Map(),create(rate,outputRate,channels){return new StreamingResampler(this,rate,outputRate,channels);},filterDelay:SoxrRuntime.prototype.filterDelay};
 startup={importMs:imported-started,factoryMs:initialized-imported,assetBytes:readFileSync(backend).byteLength};
}
const initializedMemory=process.memoryUsage();
const matrix=process.env.SOXR_BENCH_MATRIX||'full';
const fixedHeapBytes=runtime.exports.memory.buffer.byteLength;
function state(rate,outputRate,channels){
 const start=performance.now(),stream=runtime.create(rate,outputRate,channels),created=performance.now();
 const input=new Float32Array(4096*channels),output=new Float32Array(128*channels);
 for(let i=0;i<input.length;i++)input[i]=Math.sin(i*.07)*.2;
 return {stream,input,output,rate,outputRate,channels,constructMs:created-start,totalConsumed:0,totalProduced:0};
}
function block(s,index){
 const ratio=s.rate/s.outputRate*(1+Math.sin(index/1000)*500e-6);
 s.stream.setRatio(ratio,128);
 let produced=0,need=false;
 for(let call=0;call<16&&produced<128;call++){
  const available=need?Math.min(4096,Math.ceil((128-produced)*ratio)+Math.ceil(s.rate*.006)):0;
  const result=s.stream.process(s.input,available,s.output,128-produced);
  produced+=result.produced;s.totalConsumed+=result.consumed;s.totalProduced+=result.produced;
  if(!result.consumed&&!result.produced&&need)break;
  need=true;
 }
 return produced;
}
function summary(times,deadlineMs){
 const sorted=Array.from(times).sort((a,b)=>a-b),at=q=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)];
 const totalMs=sorted.reduce((a,b)=>a+b,0);
 return {blocks:sorted.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99),maxMs:sorted.at(-1),meanMs:totalMs/sorted.length,totalTimedBlockElapsedMs:totalMs,deadlineMs,deadlineMisses:sorted.filter(x=>x>deadlineMs).length,workletBudgetFraction:(totalMs/sorted.length)/deadlineMs};
}
const result={backend,startup,metadata:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,blocks,warmup,matrix,codeGenerationFromStringsForbidden:process.execArgv.includes('--disallow-code-generation-from-strings'),wrapper:'production StreamingResampler; 128 frames; drain before feed; all engines identical',timings:'P percentiles are per-block elapsed wall time including scheduling. processCpuMs measures process CPU over steady loops. Budget fraction excludes timeline/mixing and cannot certify a whole AudioWorklet deadline.'},memory:{before:heapStart,initialized:initializedMemory,fixedHeapBytes},cases:[]};
for(const rate of [8000,16000,24000,32000,44100,48000,96000])for(const outputRate of [44100,48000])for(const channels of [1,2]){
 if(matrix==='core' && !(outputRate===48000 && ((rate===8000&&channels===1)||((rate===44100||rate===48000)&&channels===2))))continue;
 const delayStarted=performance.now(),filterDelayMs=runtime.filterDelay(rate,outputRate),calibrationMs=performance.now()-delayStarted;
 const s=state(rate,outputRate,channels),firstStart=performance.now(),firstFrames=block(s,0),firstOutputMs=performance.now()-firstStart;
 assert.equal(firstFrames,128,'startup outputs one full quantum');
 for(let i=0;i<warmup;i++)assert.equal(block(s,i),128);
 const times=new Float64Array(blocks);let shortBlocks=0;const cpuBefore=process.cpuUsage();
 for(let i=0;i<blocks;i++){const at=performance.now();const count=block(s,i+warmup);times[i]=performance.now()-at;if(count!==128)shortBlocks++;}
 const cpu=process.cpuUsage(cpuBefore),cpuMs=(cpu.user+cpu.system)/1000;
 assert.equal(shortBlocks,0,'no shortage during steady feed');
 result.cases.push({rate,outputRate,channels,constructMs:s.constructMs,firstOutputMs,calibrationMs,filterDelayMs,shortBlocks,totalInputFrames:s.totalConsumed,totalOutputFrames:s.totalProduced,processCpuMs:cpuMs,cpuMsPerAudioSecond:cpuMs/(blocks*128/outputRate),...summary(times,128*1000/outputRate)});
 s.stream.dispose();
}
const media=state(48000,48000,2),navigation=state(16000,48000,1);
for(let i=0;i<warmup;i++){block(media,i);block(navigation,i);}
const concurrent=new Float64Array(blocks);let concurrentShortBlocks=0;const concurrentCpuBefore=process.cpuUsage();for(let i=0;i<blocks;i++){const start=performance.now();const a=block(media,i+warmup),b=block(navigation,i+warmup);concurrent[i]=performance.now()-start;if(a!==128||b!==128)concurrentShortBlocks++;}const concurrentCpu=process.cpuUsage(concurrentCpuBefore);assert.equal(concurrentShortBlocks,0);
result.concurrent={streams:'48000 stereo media + 16000 mono navigation; 48000 output',shortBlocks:concurrentShortBlocks,processCpuMs:(concurrentCpu.user+concurrentCpu.system)/1000,...summary(concurrent,128*1000/48000)};media.stream.dispose();navigation.stream.dispose();
// Fixed heap does not expose allocator live/high-water. Repeated lifetime tests prove functional reuse only.
for(let i=0;i<1000;i++){const stream=runtime.create(48000,48000,2);stream.dispose();}
assert.equal(runtime.exports.memory.buffer.byteLength,fixedHeapBytes,'heap must not grow');
result.memory.after=process.memoryUsage();result.memory.heapAfterBytes=runtime.exports.memory.buffer.byteLength;result.memory.allocatorLiveBytes=null;result.memory.allocatorHighWaterBytes=null;result.memory.note='RSS includes JIT/runtime and is not allocator usage; repeated create/delete proves functional reuse, not exact leak absence.';
result.lifecycleCreateDeleteCount=1000;result.totalWallMs=performance.now()-started;
console.log(JSON.stringify(result,null,2));
