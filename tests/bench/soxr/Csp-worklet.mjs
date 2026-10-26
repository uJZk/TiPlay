// Independent real Chromium / AudioWorklet test under the repository production CSP.
// node Csp-worklet.mjs /absolute/candidate.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, relative, dirname, extname } from 'node:path';
import assert from 'node:assert/strict';
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const candidate = resolve(process.argv[2]);
assert.ok(candidate.startsWith(root + '/'), 'candidate served within repository root');
const url = '/' + relative(root, candidate);
const policy = (await readFile(resolve(directory, 'production-csp.txt'), 'utf8')).trim();
await writeFile(resolve(directory, 'Disable-wasm.mjs'), 'globalThis.WebAssembly = undefined;\n');
await writeFile(resolve(directory, 'Worklet.mjs'), `
import './Disable-wasm.mjs';
import factory from ${JSON.stringify(url)};
const module = await factory();
const api = {};
for (const name of ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done', 'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']) api[name] = module['_' + name];
class Probe extends AudioWorkletProcessor {
 constructor() {
  super(); this.handle=api.tiplay_create(1.05,1,2); this.input=api.malloc(4096*2*4); this.output=api.malloc(128*2*4);
  this.heap=new Float32Array(module.HEAPU8.buffer); this.blocks=0; this.produced=0; this.energy=0; this.nonfinite=0; this.failed=0;
  for(let i=0;i<4096;i++){this.heap[this.input/4+i*2]=Math.sin(i*.1)*.2;this.heap[this.input/4+i*2+1]=Math.sin(i*.16)*.1;}
 }
 process(_, outputs) {
  const target=outputs[0], count=target[0].length; let made=0, need=false;
  if(api.tiplay_ratio(this.handle,1+(this.blocks%200)*1e-6,count))this.failed++;
  for(let call=0;call<16&&made<count;call++){
   if(api.tiplay_process(this.handle,this.input,need?512:0,this.output,count-made))this.failed++;
   const used=api.tiplay_input_done(),got=api.tiplay_output_done();
   for(let i=0;i<got;i++)for(let c=0;c<2;c++){const value=this.heap[this.output/4+i*2+c];if(!Number.isFinite(value))this.nonfinite++;target[c][made+i]=value;this.energy+=value*value;}
   made+=got; if(!used&&!got&&need)break;need=true;
  }
  this.produced+=made;this.blocks++;
  if(this.blocks===200){this.port.postMessage({blocks:this.blocks,produced:this.produced,energy:this.energy,nonfinite:this.nonfinite,failed:this.failed,heapBytes:module.HEAPU8.byteLength,webAssembly:typeof WebAssembly});api.tiplay_delete(this.handle);api.free(this.input);api.free(this.output);return false;}
  return true;
 }
}
registerProcessor('soxr-review',Probe);
`);
await writeFile(resolve(directory, 'Main.mjs'), `
window.violations=[];document.addEventListener('securitypolicyviolation',e=>window.violations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));
(async()=>{const context=new AudioContext({sampleRate:48000});await context.audioWorklet.addModule('./Worklet.mjs');const node=new AudioWorkletNode(context,'soxr-review',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});node.port.onmessage=async e=>{window.result=e.data;node.disconnect();await context.close();window.done=true};node.onprocessorerror=e=>{window.failure='processorerror';window.done=true};node.connect(context.destination);await context.resume();})().catch(error=>{window.failure=String(error.stack||error);window.done=true});
`);
const testPath = '/' + relative(root, directory) + '/Index.html';
const server = createServer(async (request,response) => {
 try {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.'+pathname);
  assert.ok(file.startsWith(root+'/'));
  response.setHeader('Content-Security-Policy',policy);
  response.setHeader('Content-Type', extname(file)==='.mjs'||extname(file)==='.js'?'text/javascript':extname(file)==='.html'?'text/html':'application/octet-stream');
  if(pathname===testPath)response.end('<!doctype html><script type="module" src="./Main.mjs"></script>');
  else response.end(await readFile(file));
 } catch(error){response.statusCode=404;response.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--no-proxy-server','--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto('http://127.0.0.1:'+server.address().port+testPath);
 await page.waitForFunction(()=>window.done===true,null,{timeout:20000});
 const result=await page.evaluate(()=>({result:window.result,failure:window.failure,violations:window.violations}));result.errors=errors;result.policy=policy;result.browser=await browser.version();
 console.log(JSON.stringify(result,null,2));
 assert.equal(result.failure,undefined);assert.deepEqual(result.violations,[]);assert.deepEqual(errors,[]);assert.ok(result.result.energy>0);assert.equal(result.result.nonfinite,0);assert.equal(result.result.failed,0);assert.equal(result.result.webAssembly,'undefined');assert.ok(result.result.produced>=128*198);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
