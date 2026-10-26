// Benchmark actual old FDK and current libav ELD adapters in one browser Worker.
// node tests/bench/libav/eld-performance.mjs /tmp/eld-perf-baseline
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { loadFixtures } from './fixtures.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(import.meta.dirname, '../../..'), baseline = resolve(process.argv[2]);
const fixtures = (await loadFixtures()).filter(f => f.name.includes('ELD'));
const index = await readFile(resolve(root, 'site/play/index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)[1];
const worker = `
import {createEldDecoder as fdk} from '/baseline/aac-eld.js';
import {createEldDecoder as av} from '/tests/bench/libav/eld-adapter.mjs';
const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
onmessage=async({data:fixtures})=>{try{
const results=[];
for(const f of fixtures){
 const frameLength=Number(f.name.split(' ').at(-1));
 const processors=[await fdk({sampleRate:f.rate,channels:f.channels,frameLength}),await av({sampleRate:f.rate,channels:f.channels,frameLength,simd:false}),await av({sampleRate:f.rate,channels:f.channels,frameLength,simd:true})];
 const names=['fdk','libavPortable','libavSimd'];const times=[[],[],[]],tails=[[],[],[]],hashes=[],peaks=[];
 try{
 const packets=f.packets.map(p=>Uint8Array.from(p));
 for(let round=0;round<36;round++){
  // Rotate all three positions to distribute warmup and temporal scheduling bias.
  for(let position=0;position<3;position++){
   const k=(round+position)%3,decoder=processors[k],batch=[];let last;
   const start=performance.now();
   for(let repeat=0;repeat<20;repeat++)for(const p of packets){const before=performance.now();last=decoder.decode(p,true);batch.push(performance.now()-before);}
   const ms=performance.now()-start;
   if(round>=6){times[k].push(ms);tails[k].push(...batch);}
   // Hash the final PCM block outside timing. FDK is a different implementation;
   // do not require it to be byte-identical to FFmpeg.
   hashes[k]=await sha(new Uint8Array(last.buffer,last.byteOffset,last.byteLength));
   peaks[k]=Math.max(...Array.from(last,v=>Math.abs(v)));
  }
 }
 const metrics=Object.fromEntries(names.map((name,k)=>[name,{medianMs:median(times[k]),packetP95Ms:tails[k].toSorted((a,b)=>a-b)[Math.floor(tails[k].length*.95)],lastBlockSha256:hashes[k],lastBlockPeak:peaks[k]}]));
 if(hashes[1]!==hashes[2])throw Error('Portable/SIMD output mismatch');
 results.push({fixture:f.name,sourceAudioSeconds:20*packets.length*frameLength/f.rate,...metrics,libavVsFdkTimePercent:100*(metrics.libavPortable.medianMs/metrics.fdk.medianMs-1),simdVsPortableTimePercent:100*(metrics.libavSimd.medianMs/metrics.libavPortable.medianMs-1)});
 }finally{for(const decoder of processors)decoder.close();}
}
postMessage({userAgent:navigator.userAgent,warmup:6,rounds:30,packetRepeats:20,output:'interleaved PCM16 at source rate',loadingAndInitializationTimed:false,results});
}catch(e){postMessage({error:String(e),stack:e.stack});}};`;
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Content-Security-Policy', csp);
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html>'); return; }
    if (path === '/worker.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); return; }
    const base = path.startsWith('/baseline/') ? baseline : root;
    const full = resolve(base, path.startsWith('/baseline/') ? path.slice(10) : path.slice(1));
    if (!full.startsWith(base + sep)) throw Error('path');
    response.setHeader('Content-Type', ['.js', '.mjs'].includes(extname(full)) ? 'text/javascript' : 'application/wasm');
    response.end(await readFile(full));
  } catch { response.writeHead(404); response.end(); }
});
let browser;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:' + server.address().port);
  const result = await page.evaluate(fixtures => new Promise((resolve, reject) => {
    const worker = new Worker('/worker.mjs', { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
    worker.onerror = e => reject(Error(e.message)); worker.postMessage(fixtures);
  }), fixtures);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  result.artifacts = { baselineCommit: '6d4e5018', baselineSha256: {}, libavSha256: {} };
  for (const name of ['aac-eld.js', 'aac-eld.wasm'])
    result.artifacts.baselineSha256[name] = sha(await readFile(resolve(baseline, name)));
  for (const variant of ['tiplay', 'tiplay-simd']) {
    const name = `libav-6.10.9.0-${variant}.wasm.wasm`;
    result.artifacts.libavSha256[name] = sha(await readFile(resolve(root, 'site/play/vendor/libav', name)));
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exitCode = 1;
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
