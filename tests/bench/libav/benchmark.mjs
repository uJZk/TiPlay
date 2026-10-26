// Run with Node 22: node tests/bench/libav/benchmark.mjs PORTABLE.mjs SIMD.mjs
// Each round owns fresh codec/filter state; timed region includes packet calls,
// PCM copy-out and resampler flush, but excludes loading, setup and hashing.
import {loadFixtures} from './fixtures.mjs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {run} from './core.mjs';
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error('Supply portable and SIMD module paths');
const fixtures = await loadFixtures();
const libs=[];
for(const path of paths){const {default:factory}=await import(pathToFileURL(path));libs.push(await factory());}
const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
const results=[];
for(const fixture of fixtures){
 try{
 const errors=libs.map(lib=>{try{run(lib,fixture);return null;}catch(e){return String(e);}});
 if(errors.some(Boolean)){results.push({fixture:fixture.name,errors:{portable:errors[0],simd:errors[1]}});continue;}
 const timings=[[],[]], packetTimes=[[],[]], checks=[];
 for(let round=0;round<50;round++)for(const index of (round%2?[1,0]:[0,1])){
 const r=run(libs[index],fixture); const hash=createHash('sha256');for(const chunk of r.chunks)hash.update(chunk);r.hash=hash.digest('hex');checks[index]=r;
 if(round>=10){timings[index].push(r.ms);packetTimes[index].push(...r.batches);}
 }
 if(checks[0].hash!==checks[1].hash||checks[0].samples!==checks[1].samples)throw new Error('Output mismatch');
 results.push({fixture:fixture.name,samples:checks[0].samples,sha256:checks[0].hash,portableMedianMs:median(timings[0]),simdMedianMs:median(timings[1]),speedup:median(timings[0])/median(timings[1]),portablePacketP95Ms:packetTimes[0].toSorted((a,b)=>a-b)[Math.floor(packetTimes[0].length*.95)],simdPacketP95Ms:packetTimes[1].toSorted((a,b)=>a-b)[Math.floor(packetTimes[1].length*.95)]});
 }catch(error){results.push({fixture:fixture.name,error:String(error)});}
}
console.log(JSON.stringify({runtime:process.version,platform:process.platform,arch:process.arch,warmup:10,rounds:40,results},null,2));
if(results.some(r=>r.error||r.errors))process.exitCode=1;
