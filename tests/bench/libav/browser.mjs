// Usage: node tests/bench/libav/browser.mjs BUILD_DIST_DIRECTORY
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {loadFixtures} from './fixtures.mjs';
const {chromium}=createRequire(import.meta.url)('playwright-core');
const repo=resolve(import.meta.dirname,'../../..'), dist=resolve(process.argv[2]);
const fixtures=(await loadFixtures()).filter(f=>!process.argv[3]||new RegExp(process.argv[3]).test(f.name));
if(!fixtures.length)throw Error('No matching fixtures');
if(process.env.LIBAV_BENCH_PLANAR)for(const fixture of fixtures)fixture.outputFormat=8;
const index=await readFile(resolve(repo,'site/play/index.html'),'utf8');
const csp=/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)[1];
const worker=`import {run} from '/bench/core.mjs';
onmessage=async ({data:fixtures})=>{try{
const libs=[];for(const name of ['tiplay','tiplay-simd']){const {default:factory}=await import('/dist/libav-6.10.9.0-'+name+'.wasm.mjs');libs.push(await factory());}
const results=[];const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
for(const f of fixtures){try{
const errors=libs.map(lib=>{try{run(lib,f);return null;}catch(e){return String(e);}});if(errors.some(Boolean)){results.push({fixture:f.name,errors:{portable:errors[0],simd:errors[1]}});continue;}
const times=[[],[]], tails=[[],[]], hashes=[], counts=[];
for(let round=0;round<25;round++)for(const index of (round%2?[1,0]:[0,1])){
const r=run(libs[index],f);const all=new Uint8Array(r.chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of r.chunks){all.set(c,at);at+=c.length;}
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',all)),x=>x.toString(16).padStart(2,'0')).join('');
if(hashes[index]&&hash!==hashes[index])throw Error('Nondeterministic output');hashes[index]=hash;counts[index]=r.samples;
if(round>=5){times[index].push(r.ms);tails[index].push(...r.batches);}}
if(hashes[0]!==hashes[1]||counts[0]!==counts[1])throw Error('SIMD output mismatch');
results.push({fixture:f.name,samples:counts[0],sha256:hashes[0],portableMedianMs:median(times[0]),simdMedianMs:median(times[1]),speedup:median(times[0])/median(times[1]),portablePacketP95Ms:tails[0].toSorted((a,b)=>a-b)[Math.floor(tails[0].length*.95)],simdPacketP95Ms:tails[1].toSorted((a,b)=>a-b)[Math.floor(tails[1].length*.95)]});
}catch(e){results.push({fixture:f.name,error:String(e)});}}
postMessage({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,outputFormat:fixtures[0]?.outputFormat===8?'f32-planar':'s16',warmup:5,rounds:20,packetRepeats:20,results});
}catch(e){postMessage({error:String(e),stack:e.stack});}};`;
const server=createServer(async(req,res)=>{try{
res.setHeader('Content-Security-Policy',csp);
const url=new URL(req.url,'http://localhost');
if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html>');return;}
if(url.pathname==='/worker.mjs'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}
const base=url.pathname.startsWith('/dist/')?dist:repo;
const path=url.pathname.startsWith('/dist/')?url.pathname.slice(6):url.pathname.replace('/bench/','/tests/bench/libav/').slice(1);
const full=resolve(base,path);if(!full.startsWith(base+sep))throw Error('path');
res.setHeader('Content-Type',extname(full)==='.wasm'?'application/wasm':'text/javascript');res.end(await readFile(full));
}catch{res.writeHead(404);res.end();}});
let browser;
try{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--no-proxy-server']});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);const result=await page.evaluate(fixtures=>new Promise((resolve,reject)=>{const worker=new Worker('/worker.mjs',{type:'module'});worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.onerror=e=>reject(Error(e.message));worker.postMessage(fixtures);}),fixtures);console.log(JSON.stringify(result,null,2));if(result.error)process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
