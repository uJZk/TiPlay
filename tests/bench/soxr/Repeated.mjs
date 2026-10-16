// Five fresh-process repetitions, rotating engine order. Writes raw JSON beside this script.
import { spawnSync } from 'node:child_process';
import { writeFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const reportDirectory=resolve(process.env.SOXR_BENCH_RESULTS_DIR||directory);mkdirSync(reportDirectory,{recursive:true});
const engines=[['Wasm','wasm'],['Baseline',resolve(directory,'baseline.mjs')],[process.argv[3]||'Optimized',resolve(process.argv[2]||resolve(directory,'../soxr.asm.js'))]];
const runs=[];
for(let repetition=0;repetition<5;repetition++)for(let offset=0;offset<3;offset++){
 const [label,backend]=engines[(offset+repetition)%3];
 const run=spawnSync(process.execPath,['--disallow-code-generation-from-strings',resolve(directory,'Benchmark.mjs'),backend,'4000','500'],{encoding:'utf8',maxBuffer:20*1024*1024,env:{...process.env,SOXR_BENCH_MATRIX:'core'}});
 if(run.error||run.status!==0)throw new Error(label+' '+String(run.error||run.stderr));
 const result=JSON.parse(run.stdout);writeFileSync(resolve(reportDirectory,`${label}-repeat-${repetition+1}.json`),JSON.stringify(result,null,2)+'\n');
 runs.push({label,repetition:repetition+1,result});
}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summary={method:'5 fresh-process repetitions; rotating engine order; 4000 steady blocks and 500 warmup per case; per-block timing includes OS scheduling',engines:[]};
for(const [label]of engines){
 const data=runs.filter(x=>x.label===label).map(x=>x.result);
 const cases=data[0].cases.map((first,i)=>({rate:first.rate,outputRate:first.outputRate,channels:first.channels,medianMeanMs:median(data.map(x=>x.cases[i].meanMs)),medianP50Ms:median(data.map(x=>x.cases[i].p50Ms)),medianP95Ms:median(data.map(x=>x.cases[i].p95Ms)),medianP99Ms:median(data.map(x=>x.cases[i].p99Ms)),worstObservedBlockMs:Math.max(...data.map(x=>x.cases[i].maxMs)),deadlineMisses:data.reduce((sum,x)=>sum+x.cases[i].deadlineMisses,0),medianCpuMsPerAudioSecond:median(data.map(x=>x.cases[i].cpuMsPerAudioSecond))}));
 summary.engines.push({label,cases,concurrent:{medianMeanMs:median(data.map(x=>x.concurrent.meanMs)),medianP99Ms:median(data.map(x=>x.concurrent.p99Ms)),worstObservedBlockMs:Math.max(...data.map(x=>x.concurrent.maxMs)),deadlineMisses:data.reduce((sum,x)=>sum+x.concurrent.deadlineMisses,0)}});
}
writeFileSync(resolve(reportDirectory,'Repeated-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
