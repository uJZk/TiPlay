// SPDX-License-Identifier: GPL-3.0-only
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import { simple, ancestor } from 'acorn-walk';

const root = new URL('./', import.meta.url);
const destination = new URL('../../site/play/vendor/libmedia/', root);
const lock = JSON.parse(await readFile(new URL('wasm.lock.json', root), 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
// Dependency-free adapter remains valid in upstream serialized workers.
// The optional bridge changes only the Android resource fetch boundary; AVPlayer
// retains HTTP retry, buffering, and cancellation ownership.
const fetchAdapter = `((url, init) => {
  const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url, globalThis.location.href);
  const headers = new Headers(init?.headers);
  const marker = headers.get('X-TiPlay-Proxy-Origin');
  const bridge = headers.get('X-TiPlay-Fetch-Bridge');
  const proxyOrigin = marker ? new URL(marker).origin : null;
  headers.delete('X-TiPlay-Proxy-Origin');
  headers.delete('X-TiPlay-Fetch-Bridge');
  if (proxyOrigin && (target.origin !== proxyOrigin || target.pathname !== '/airplay-resource'))
    throw new DOMException('Debug media must pass through Android.', 'SecurityError');
  const hostname = target.hostname;
  const [a,b] = hostname.split(/[.:]/).map(Number);
  const space = a === 127 || /^localhost$/i.test(hostname) ? 'loopback'
    : a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
      || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ? 'local' : undefined;
  const { __tiplaySourceSignal, ...requestInit } = init || {};
  const signal = requestInit.signal || __tiplaySourceSignal;
  if (bridge && target.protocol === 'http:' && target.pathname === '/airplay-resource' && typeof BroadcastChannel === 'function') {
    return new Promise((resolve, reject) => {
      const channel = new BroadcastChannel(bridge), id = crypto.randomUUID();
      let streamController, settled = false, closed = false;
      const send = type => { if (!closed) channel.postMessage({ id, type }); };
      const cleanup = () => { if (closed) return; closed = true; signal?.removeEventListener('abort', abort); channel.close(); };
      const fail = error => { if (streamController) streamController.error(error); else if (!settled) { settled = true; reject(error); } cleanup(); };
      const abort = () => { send('cancel'); fail(new DOMException('Media request interrupted.', 'AbortError')); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      channel.onmessage = ({ data }) => {
        if (!data || data.id !== id || closed) return;
        if (data.type === 'error') { fail(new DOMException('Media resource request failed.', data.name === 'SecurityError' ? 'SecurityError' : data.name === 'AbortError' ? 'AbortError' : 'NetworkError')); return; }
        if (data.type === 'response') {
          try {
            const body = data.body ? new ReadableStream({ start(controller) { streamController = controller; },
              pull() { send('pull'); }, cancel() { send('cancel'); cleanup(); } }) : null;
            const response = new Response(body, { status: data.status, statusText: data.statusText, headers: data.headers });
            Object.defineProperties(response, { url: { value: data.url }, redirected: { value: data.redirected }, type: { value: data.responseType } });
            settled = true; resolve(response); if (!body) cleanup();
          } catch (_) { send('cancel'); fail(new DOMException('Invalid media resource response.', 'NetworkError')); }
        } else if (data.type === 'chunk') streamController?.enqueue(data.value);
        else if (data.type === 'end') { streamController?.close(); cleanup(); }
      };
      channel.postMessage({ id, type: 'request', url: target.href, range: headers.get('Range'), proxyOnly: Boolean(proxyOrigin) });
    });
  }
  return globalThis.fetch(url, { ...requestInit, signal, cache: 'no-store', referrerPolicy: 'no-referrer',
    credentials: 'omit', headers, ...(proxyOrigin ? { redirect: 'error' } : {}), ...(space ? { targetAddressSpace: space } : {}) });
})`;
// Select from the upstream-parsed master, before any variant URI is requested.
const sdrVariants = `((playlist)=>{
  const permitted=playlist.variants.filter(variant=>{
    const range=String(variant.videoRange||'').toUpperCase();
    const dolby=String(variant.codecs||'').split(',').some(codec=>/^(?:dvhe|dvh1|dvav|dva1)(?:[.\\s]|$)/i.test(codec.trim()));
    return range!=='PQ' && range!=='HLG' && !dolby;
  });
  if(!permitted.length){const error=new DOMException('No SDR video variant is available.','NotSupportedError');error.__tiplaySdrRequired=true;throw error;}
  const explicit=permitted.filter(variant=>String(variant.videoRange||'').toUpperCase()==='SDR');
  playlist.variants=explicit.length?explicit:permitted;
  return playlist;
})`;
// Fixed scalar evidence survives the IO worker boundary; source URLs and exception messages do not.
const manifestFailure = `((failure)=>{
  const phase=['request','body','parse','playlist'].includes(this.__tiplayOpenPhase)?this.__tiplayOpenPhase:'request';
  const status=Number.isInteger(this.__tiplayOpenStatus)&&this.__tiplayOpenStatus>=0&&this.__tiplayOpenStatus<=599?this.__tiplayOpenStatus:0;
  const cause=['AbortError','SecurityError','TypeError','SyntaxError','NetworkError','NotSupportedError'].includes(failure?.name)?failure.name:'Error';
  return {phase,status,cause};
})`;
const checkManifestFailure = `if(classification?.tiplayManifestFailure){
  const failure=classification.tiplayManifestFailure;
  const phase=['request','body','parse','playlist'].includes(failure.phase)?failure.phase:'request';
  const status=Number.isInteger(failure.status)&&failure.status>=0&&failure.status<=599?failure.status:0;
  const cause=['AbortError','SecurityError','TypeError','SyntaxError','NetworkError','NotSupportedError'].includes(failure.cause)?failure.cause:'Error';
  throw new DOMException('URL manifest open failed: phase='+phase+' status='+status+' cause='+cause+'.',
    cause==='SecurityError'?'SecurityError':phase==='request'||phase==='body'||status>=400?'NetworkError':'EncodingError');
}`;
// A packed HLS AAC segment can begin with an ID3 transport timestamp. Upstream
// otherwise classifies every ID3-prefixed input as MP3 before its AAC demuxer
// gets a chance to parse the timestamp. Only inspect bounded slice input; keep
// the existing MP3 decision for all other ID3 streams.
const packedAacProbe = (reader, original) => `{if((${reader}.flags&2)!==0){try{
  const h=await ${reader}.peekBuffer(10);
  if((h[3]===3||h[3]===4)&&h.subarray(6,10).every(x=>(x&128)===0)){
    const length=(h[6]<<21)|(h[7]<<14)|(h[8]<<7)|h[9];
    const offset=10+length+(h[3]===4&&(h[5]&16)?10:0);
    if(offset<=Math.min(65536,${reader}.size-2)){
      const b=await ${reader}.peekBuffer(offset+2);
      if(b[offset]===255&&(b[offset+1]&246)===240)return 15;
    }
  }
}catch(_){}}${original}}`;
const artifacts = [];
await mkdir(destination, { recursive: true });
for (const name of await readdir(destination)) {
  if (/\.js$/.test(name) || ['decode','resample','stretchpitch'].includes(name))
    await rm(new URL(name, destination), { recursive: true, force: true });
}
async function output(name, data) {
  await mkdir(new URL('./', new URL(name, destination)), { recursive: true });
  await writeFile(new URL(name, destination), data);
  artifacts.push({ path: name, bytes: Buffer.byteLength(data), sha256: sha(data) });
}
const source = new URL('node_modules/@libmedia/avplayer/dist/esm/', root);
let fetchSites = 0, workletSites = 0, liveSites = 0, cleanupSites = 0, cancellationSites = 0, contextGuardSites = 0, lifecycleSites = 0, lifecycleAwaits = 0, rpcErrorSites = 0, subtitleEofSites = 0, seekReplySites = 0, subtitlePacketBridgeSites = 0, subtitleReleaseSites = 0, subtitleDrainSites = 0, subtitleSeekSites = 0, sdrPolicySites = 0, manifestFailureSites = 0, packedAacProbeSites = 0;
for (const name of (await readdir(source)).filter(name => name.endsWith('.js')).sort()) {
  let code = await readFile(new URL(name, source), 'utf8');
  const edits = [];
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  let originalAwaits = 0, addedAwaits = 0;
  simple(ast, { AwaitExpression() { originalAwaits++; } });
  simple(ast, {
    CatchClause(caught) {
      if (caught.param?.type !== 'Identifier') return;
      simple(caught.body, { ObjectExpression(object) {
        if (object.properties.length !== 1) return;
        const property=object.properties[0];
        if (property.key?.name !== 'message' || property.value.type !== 'MemberExpression'
          || property.value.object.name !== caught.param.name || property.value.property.name !== 'message') return;
        const error=caught.param.name;
        edits.push({start:object.start,end:object.end,
          value:`({message:typeof ${error}?.message==='string'?${error}.message:'Media task failed.',name:typeof ${error}?.name==='string'?${error}.name:'Error'})`});
        rpcErrorSites++;
      } });
    },
    FunctionDeclaration(node) {
      const original = code.slice(node.start,node.end);
      if (name === 'avplayer.js' && original.includes('/^ID3/') && original.includes('/^FLV/')) {
        if (!node.async || node.params[0]?.type !== 'Identifier') throw new Error('Upstream format probe changed');
        simple(node.body, { IfStatement(statement) {
          if (!code.slice(statement.test.start, statement.test.end).includes('/^ID3/') ||
            statement.consequent.type !== 'ReturnStatement' || statement.consequent.argument?.value !== 14) return;
          edits.push({ start: statement.consequent.start, end: statement.consequent.end,
            value: packedAacProbe(node.params[0].name, code.slice(statement.consequent.start, statement.consequent.end)) });
          addedAwaits += 2;
          packedAacProbeSites++;
        } });
      }
      if (name !== '272.avplayer.js' || !original.includes('referrerPolicy') || !original.includes('credentials')) return;
      if (node.params.length !== 1 || node.params[0].type !== 'Identifier')
        throw new Error('Upstream HLS request options changed');
      const info = node.params[0].name;
      simple(node.body, { ReturnStatement(statement) {
        const original = code.slice(statement.argument.start,statement.argument.end);
        edits.push({start: statement.argument.start,end: statement.argument.end,
          value: `((params)=>({...params,__tiplaySourceSignal:${info}.__tiplaySourceSignal}))((${original}))`});
        cancellationSites++;
      } });
    },
    ClassDeclaration(node) {
      const methods = node.body.body.map(method => method.key?.name);
      if (methods.includes('getDemuxerPort') && methods.includes('setDemuxTask')) {
        const pull=node.body.body.find(method=>method.key?.name==='pull');
        // Drain the previous generation on the same port before any demux seek.
        // The marker follows the old pull even when its request is still in transit.
        edits.push({start:pull.key.start,end:pull.key.end,value:'__tiplayPullPacket'});
        edits.push({start:node.body.end-1,end:node.body.end-1,
          value:`pull(){if(this.pulling)return this.__tiplayPullDone;const pending=this.__tiplayPullPacket();this.__tiplayPullDone=pending;return pending;}async __tiplayBeforeSeek(){this.pause();const port=this.leftPorts.get(this.currentPort);if(port){const result=await port.request('__tiplaySubtitleDrain');if(result<0)throw new Error('Unable to drain subtitle playback.');}await this.__tiplayPullDone;this.reset();}`});
        addedAwaits+=2;
        subtitleDrainSites++;
        const imports=code.slice(code.lastIndexOf('var ',node.start),node.start);
        const packetImport=/([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(46564\)/.exec(imports);
        if(!packetImport)throw new Error('Upstream subtitle AVPacket import changed');
        const packetAPI=packetImport[1], require=packetImport[2];
        edits.push({start:node.start,end:node.start,value:`const __tiplayUnserializePacket=${require}(26669).r0;`});
        const start=pull.value.body.body.find(statement=>statement.type==='ExpressionStatement'
          && statement.expression.type==='AssignmentExpression' && statement.expression.left.property?.name==='pulling');
        if(!start)throw new Error('Upstream subtitle pull ownership changed');
        edits.push({start:start.end,end:start.end,value:'let __tiplayOwnedPacket=0;try{'});
        edits.push({start:pull.value.body.end-1,end:pull.value.body.end-1,
          value:`}finally{try{if(__tiplayOwnedPacket){const pointer=__tiplayOwnedPacket;__tiplayOwnedPacket=0;this.avpacketPool?this.avpacketPool.release(pointer):${packetAPI}.Qe(pointer);}}finally{this.pulling=false;}}`});
        simple(pull.value.body,{
          VariableDeclarator(declaration){
            if(declaration.init?.type!=='AwaitExpression' || !code.slice(declaration.init.start,declaration.init.end).includes('this.leftPorts'))return;
            const original=code.slice(declaration.init.start,declaration.init.end);
            edits.push({start:declaration.init.start,end:declaration.init.end,
              value:`((packet)=>{if(packet && typeof packet==='object'){const pointer=this.avpacketPool?this.avpacketPool.alloc():${packetAPI}._5();__tiplayOwnedPacket=pointer;return __tiplayUnserializePacket(packet,pointer);}if(typeof packet==='number' && packet>0 || typeof packet==='bigint' && packet>0n)__tiplayOwnedPacket=packet;return packet;})(${original})`});
            const statement=pull.value.body.body.find(statement=>statement.type==='VariableDeclaration'
              && statement.declarations.includes(declaration));
            if(!statement)throw new Error('Upstream subtitle status response changed');
            edits.push({start:statement.end,end:statement.end,value:`if(${declaration.id.name}===-1048575)return;`});
            subtitleDrainSites++;
            subtitlePacketBridgeSites++;
          },
          CallExpression(call){
            const callee=call.callee;
            const pooled=callee.type==='MemberExpression' && callee.property.name==='release'
              && callee.object.type==='MemberExpression' && callee.object.object.type==='ThisExpression'
              && callee.object.property.name==='avpacketPool';
            const last=callee.type==='SequenceExpression'?callee.expressions.at(-1):null;
            const unpooled=last?.type==='MemberExpression' && last.object.name===packetAPI && last.property.name==='Qe';
            if(!pooled && !unpooled)return;
            const original=code.slice(call.start,call.end);
            edits.push({start:call.start,end:call.end,value:`(__tiplayOwnedPacket=0,${original})`});
            subtitleReleaseSites++;
          },
        });
      }
      if (methods.includes('doDemux') && methods.includes('replyAVPacket')) {
        const connect=node.body.body.find(method=>method.key?.name==='connectStreamTask');
        simple(connect.value.body,{SwitchStatement(statement){
          if(statement.discriminant.type!=='MemberExpression' || statement.discriminant.property.name!=='method')return;
          const request=code.slice(statement.discriminant.object.start,statement.discriminant.object.end);
          const pull=statement.cases.find(branch=>branch.test?.value==='pull');
          if(!pull)throw new Error('Upstream subtitle drain request dispatch changed');
          const body=code.slice(pull.start,pull.end);
          const match=/([\w$]+)\.cacheAVPackets\.get\(([\w$]+)\.streamIndex\)/.exec(body);
          if(!match)throw new Error('Upstream stream request ownership changed');
          const task=match[1],port=match[2];
          edits.push({start:pull.start,end:pull.start,
            value:`case '__tiplaySubtitleDrain':{const stream=${task}.formatContext.streams.find(stream=>stream.index===${port}.streamIndex);if(stream?.codecpar.codecType!==3){${port}.reply(${request},-1048575);break;}const pending=${task}.cacheRequests.get(${port}.streamIndex);if(pending){${port}.reply(pending,-1048575);${task}.cacheRequests.delete(${port}.streamIndex);}${port}.reply(${request},0);break;}`});
          subtitleDrainSites++;
        }});
        const seek=node.body.body.find(method=>method.key?.name==='seek');
        simple(seek.value.body,{ReturnStatement(statement){
          const expressions=statement.argument?.expressions;
          const first=expressions?.[0];
          if (first?.type!=='CallExpression' || first.callee.type!=='MemberExpression' || first.callee.property.name!=='push'
            || !code.slice(first.start,first.end).includes('.cacheAVPackets.get('))return;
          if(expressions.length!==5)throw new Error('Upstream seek packet handoff changed');
          const get=first.callee.object;
          const task=code.slice(get.callee.object.object.start,get.callee.object.object.end);
          const stream=code.slice(get.arguments[0].start,get.arguments[0].end);
          const packet=code.slice(first.arguments[0].start,first.arguments[0].end);
          const queue=code.slice(first.start,first.end);
          const stats=code.slice(expressions[1].start,expressions[1].end);
          const finish=expressions.slice(2,4).map(expression=>code.slice(expression.start,expression.end)).join(';');
          const timestamp=code.slice(expressions[4].start,expressions[4].end);
          edits.push({start:statement.argument.start,end:statement.argument.end,
            value:`(()=>{const __tiplaySeekTime=${timestamp};if(${task}.cacheRequests.has(${stream})){this.replyAVPacket(${task},${task}.rightIPCPorts.get(${stream}),${task}.cacheRequests.get(${stream}),${packet});${task}.cacheRequests.delete(${stream});}else{${queue};${stats};}${finish};return __tiplaySeekTime;})()`});
          seekReplySites++;
        }});
      }

      if (methods.includes('fetchMasterPlayList') && methods.includes('createLoader')) {
        const open = node.body.body.find(method => method.key?.name === 'open');
        const abort = node.body.body.find(method => method.key?.name === 'abort');
        simple(open.value.body, { AssignmentExpression(expression) {
          if (expression.left.type !== 'MemberExpression' || expression.left.object.type !== 'ThisExpression'
            || expression.left.property.name !== 'info') return;
          const original = code.slice(expression.start,expression.end);
          edits.push({start: expression.start,end: expression.end,
            value: `(${original},this.__tiplayAbortController=new AbortController(),this.info.__tiplaySourceSignal=this.__tiplayAbortController.signal)`});
          cancellationSites++;
        } });
        edits.push({start: abort.value.body.start+1,end: abort.value.body.start+1,
          value: 'this.aborted=true;this.__tiplayAbortController?.abort();'});
        cancellationSites++;
      }
      if (methods.includes('openReader') && methods.includes('getTotalSize') && methods.includes('abortSleep')) {
        const method = node.body.body.find(method => method.key?.name === 'abort');
        edits.push({start: method.value.body.start, end: method.value.body.end,
          value: '{this.abortSleep();if(!this.reader){if(this.abortController){this.abortController.abort();this.abortController=null;}return;}await this.reader.cancel();if(this.abortController){this.abortController.abort();this.abortController=null;}this.reader=null;}'});
        cancellationSites++;
      }
      if (methods.includes('getCurrentProtection') && methods.includes('registerTask')) {
        if (methods.includes('abort')) throw new Error('Upstream IO abort method now exists; review local extension');
        edits.push({start: node.body.end-1, end: node.body.end-1,
          value: 'async abort(taskId){const task=this.tasks.get(taskId);if(task)await task.ioLoader.stop();}'});
        cancellationSites++;
        addedAwaits++;

        const method = node.body.body.find(method => method.key?.name === 'open');
        simple(method.value.body, { ReturnStatement(statement) {
          const expressions = statement.argument?.expressions;
          if (!expressions || expressions.length !== 2 || expressions[1].value !== 0)
            throw new Error('Upstream IO open result changed');
          const call = expressions[0].argument;
          const loader = code.slice(call.callee.object.start, call.callee.object.end);
          edits.push({ start: expressions[1].start, end: expressions[1].end,
            value: `({tiplayLive:${loader}.mainLoader?.mediaPlayList ? !${loader}.mainLoader.mediaPlayList.endlist : undefined,tiplaySdrRequired:${loader}.__tiplaySdrRequired===true,tiplayManifestFailure:${loader}.__tiplayOpenFailure})` });
          const opening=expressions[0];
          const original=code.slice(opening.start,opening.end);
          edits.push({start:opening.start,end:opening.end,
            value:`(${loader}.__tiplaySdrRequired=false,${loader}.__tiplayOpenFailure=undefined,${original}.catch(error=>{if(error?.__tiplaySdrRequired){${loader}.__tiplaySdrRequired=true;return;}if(${loader}.__tiplayOpenFailure&&error?.name!=='AbortError')return;throw error;}))`});
          manifestFailureSites++;
          sdrPolicySites++;
          liveSites++;
        } });
      }
    },
    MethodDefinition(node) {
      if(node.key.name==='doSeek'){
        edits.push({start:node.value.body.start+1,end:node.value.body.start+1,
          value:'await this.subtitleRender?.__tiplayBeforeSeek();'});
        addedAwaits++;
        subtitleSeekSites++;
      }
      if(node.key.name==='selectSubtitle')simple(node.value.body,{AssignmentExpression(expression){
        if(expression.left.type!=='MemberExpression' || expression.left.object.type!=='ThisExpression'
          || expression.left.property.name!=='lastStatus')return;
        const original=code.slice(expression.start,expression.end);
        edits.push({start:expression.start,end:expression.end,
          value:`(await this.subtitleRender?.__tiplayBeforeSeek(),${original})`});
        addedAwaits++;
        subtitleSeekSites++;
      }});
      if(node.key.name==='fetchMasterPlayList'){
        edits.push({start:node.value.body.start+1,end:node.value.body.start+1,
          value:"this.__tiplayOpenFailure=undefined;this.__tiplayOpenPhase='request';this.__tiplayOpenStatus=0;"});
        manifestFailureSites++;
        const attempt=node.value.body.body[0];
        const declaration=attempt.block?.body[0];
        const declarations=declaration?.declarations;
        if(attempt.type!=='TryStatement'||declarations?.length!==3
          ||declarations[0].init?.type!=='AwaitExpression'||declarations[0].init.argument.callee?.name!=='fetch'
          ||declarations[1].init?.type!=='AwaitExpression'||declarations[1].init.argument.callee?.property?.name!=='text'
          ||declarations[2].init?.type!=='CallExpression')throw new Error('Upstream HLS manifest read/parse stages changed');
        const request=declarations[0].init,parsed=declarations[2].init;
        edits.push({start:request.start,end:request.start,value:"((response)=>{this.__tiplayOpenStatus=response.status;this.__tiplayOpenPhase='body';return response;})("},
          {start:request.end,end:request.end,value:')'});
        manifestFailureSites++;
        edits.push({start:parsed.start,end:parsed.start,value:"(this.__tiplayOpenPhase='parse',"},
          {start:parsed.end,end:parsed.end,value:')'},
          {start:declaration.end,end:declaration.end,value:"this.__tiplayOpenPhase='playlist';"});
        manifestFailureSites++;
        simple(node.value.body,{
          AssignmentExpression(expression){
            if(expression.left.type!=='MemberExpression' || expression.left.object.type!=='ThisExpression'
              || expression.left.property.name!=='masterPlaylist')return;
            const original=code.slice(expression.right.start,expression.right.end);
            edits.push({start:expression.right.start,end:expression.right.end,value:`${sdrVariants}(${original})`});
            sdrPolicySites++;
          },
          CatchClause(caught){
            if(caught.param?.type!=='Identifier')throw new Error('Upstream HLS error boundary changed');
            const error=caught.param.name;
            edits.push({start:caught.body.start+1,end:caught.body.start+1,value:`if(${error}?.__tiplaySdrRequired)throw ${error};this.__tiplayOpenFailure=${manifestFailure}(${error});`});
            manifestFailureSites++;
            sdrPolicySites++;
          },
        });
      }
      if (node.key.name==='readLine' && node.value.async && code.slice(node.start,node.end).includes('this.readString')) {
        const declaration=node.value.body.body[0];
        if(declaration.type!=='VariableDeclaration' || declaration.declarations.length!==1
          || declaration.declarations[0].init.value!=='')throw new Error('Upstream line reader changed');
        const accumulator=declaration.declarations[0].id.name;
        edits.push({start:declaration.end,end:declaration.end,value:'try{'});
        edits.push({start:node.value.body.end-1,end:node.value.body.end-1,
          value:`}catch(__tiplayLineError){if(this.error===-1048576 && ${accumulator}.length)return ${accumulator};throw __tiplayLineError;}`});
        subtitleEofSites++;
      }
      if (name==='790.avplayer.js' && node.key.name==='readChunk' && node.value.async) {
        const declaration=node.value.body.body[0];
        const loop=node.value.body.body.find(statement=>statement.type==='ForStatement');
        if(!loop || declaration.type!=='VariableDeclaration' || declaration.declarations[0].init.value!=='')
          throw new Error('Upstream WebVTT chunk reader changed');
        const accumulator=declaration.declarations[0].id.name;
        const context=node.value.params[0].name;
        const original=code.slice(loop.start,loop.end);
        edits.push({start:loop.start,end:loop.end,
          value:`try{${original}}catch(__tiplayChunkError){if(${context}.ioReader.error!==-1048576 || !${accumulator}.trim())throw __tiplayChunkError;}`});
        subtitleEofSites++;
      }
      if (!node.static && node.key.name === 'stop' && code.slice(node.start,node.end).includes('this.stopPending')) {
        const owner = /([A-Za-z_$][\w$]*)\.IOThread/.exec(code.slice(node.start,node.end))?.[1];
        if (!owner) throw new Error('Upstream stop IO owner changed');
        simple(node.value.body, { AssignmentExpression(expression) {
          if (expression.left.type !== 'MemberExpression' || expression.left.object.type !== 'ThisExpression'
            || expression.left.property.name !== 'stopPending' || expression.right.type !== 'NewExpression') return;
          const original = code.slice(expression.start,expression.end);
          edits.push({start: expression.start, end: expression.end,
            value: `(${original},${owner}.IOThread && await ${owner}.IOThread.abort(this.taskId))`});
          addedAwaits++;
          cancellationSites++;
        } });
      }
      if (node.static && node.key.name === 'stopPipelines') {
        simple(node.value.body, { AssignmentExpression(expression) {
          if (expression.left.type !== 'MemberExpression' || expression.left.property.name !== 'audioContext'
            || expression.right.type !== 'Literal' || expression.right.value !== null) return;
          const owner = code.slice(expression.left.object.start, expression.left.object.end);
          const context = code.slice(expression.left.start, expression.left.end);
          edits.push({start: expression.start, end: expression.end,
            value: `((${context} && ${context}.state !== 'closed' ? await ${context}.close() : undefined),${context}=null,${owner}.VideoRenderThread=null,${owner}.AudioRenderThread=null)` });
          cleanupSites++;
          addedAwaits++;
        } });
      }
      if (node.key.name === 'setMediaPlayList') {
        simple(node.value.body, { LogicalExpression(expression) {
          if (expression.left.type === 'MemberExpression' && expression.left.property.name === 'endlist'
            && expression.right.type === 'AssignmentExpression'
            && expression.right.left.property?.name === 'isLive') {
            edits.push({start: expression.start, end: expression.end,
              value: '(this.options.isLive=!this.mediaPlayList.endlist)'});
            liveSites++;
          }
        } });
      }
      if (node.key.name === 'load') {
        simple(node.value.body, { AwaitExpression(expression) {
          const call = expression.argument;
          if (call.type !== 'CallExpression' || call.callee.type !== 'MemberExpression'
            || call.callee.property.name !== 'open' || call.callee.object.type !== 'MemberExpression'
            || call.callee.object.property.name !== 'IOThread') return;
          const original = code.slice(expression.start, expression.end);
          edits.push({start: expression.start, end: expression.end,
            value: `((classification)=>{if(classification?.tiplaySdrRequired)throw new DOMException('No SDR video variant is available.','NotSupportedError');${checkManifestFailure}if(typeof classification==='number' && classification<0)throw new Error('Unable to open media source.');if(this.isHls() && typeof classification?.tiplayLive === 'boolean')this.isLive_=classification.tiplayLive;})(${original})` });
          manifestFailureSites++;
          liveSites++;
        } });
      }

      if (node.key.name !== 'startAudioContext') return;
      simple(node.value.body, {
        CallExpression(call) {
          if (call.callee.type !== 'MemberExpression' || call.callee.property.name !== 'addEventListener'
            || call.arguments[0]?.value !== 'statechange') return;
          const context = code.slice(call.callee.object.start,call.callee.object.end);
          const callback = code.slice(call.arguments[1].start,call.arguments[1].end);
          edits.push({start:call.arguments[1].start,end:call.arguments[1].end,
            value:`((ownedContext)=>()=>{if(${context}===ownedContext)(${callback})();})(${context})`});
          contextGuardSites++;
        },
        AwaitExpression(awaited) {
          const call = awaited.argument;
          if (call.type !== 'CallExpression' || call.arguments.length !== 2 || call.arguments[1].type !== 'ConditionalExpression')
            throw new Error('Upstream Worklet registration changed');
          const context = code.slice(call.arguments[0].start, call.arguments[0].end);
          const condition = code.slice(call.arguments[1].test.start, call.arguments[1].test.end);
          edits.push({ start: call.start, end: call.end,
            value: `(${context}.audioWorklet.addModule(new URL((${condition}) ? 'AudioSourceWorkletProcessorWorklet.js' : 'AudioSourceWorkletProcessor2Worklet.js', import.meta.url)))` });
          workletSites++;
        },
      });
    },
  });
  simple(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }), {
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
        edits.push({ start: node.callee.start, end: node.callee.end, value: fetchAdapter });
        fetchSites++;
      }
    },
  });
  for (const edit of edits.sort((a,b) => b.start - a.start))
    code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
  // Prevent cancelled load/play continuations from creating tasks after teardown.
  const lifecycleEdits = [];
  simple(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }), {
    ClassDeclaration(owner) {
      const methods = owner.body.body.map(method => method.key?.name);
      if (!methods.includes('playUseDecoder') || !methods.includes('stopPipelines')) return;
      for (const method of owner.body.body) {
        if (method.key?.name === 'stop' && !method.static) {
          lifecycleEdits.push({start:method.value.body.start+1,end:method.value.body.start+1,
            value:'this.__tiplayLifecycle=(this.__tiplayLifecycle||0)+1;'});
          lifecycleSites++;
        }
        if (!['load','play'].includes(method.key?.name) || method.static) continue;
        const loading = method.key.name === 'load';
        lifecycleEdits.push({start:method.value.body.start+1,end:method.value.body.start+1,
          value: loading ? 'let __tiplayEpoch;' : 'const __tiplayEpoch=this.__tiplayLifecycle||0;'});
        lifecycleSites++;
        if (loading) simple(method.value.body, { AssignmentExpression(expression) {
          if (expression.left.type === 'MemberExpression' && expression.left.object.type === 'ThisExpression'
            && expression.left.property.name === 'status' && expression.right.value === 3) {
            const original=code.slice(expression.start,expression.end);
            lifecycleEdits.push({start:expression.start,end:expression.end,
              value:`(${original},__tiplayEpoch=this.__tiplayLifecycle||0,this.status)`});
            lifecycleSites++;
          }
        } });
        ancestor(method.value.body, { AwaitExpression(expression, ancestors) {
          if (ancestors.some(node => node !== expression && ['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression','AwaitExpression'].includes(node.type))) return;
          const original=code.slice(expression.start,expression.end);
          lifecycleEdits.push({start:expression.start,end:expression.end,
            value:`((value)=>{if(__tiplayEpoch!==undefined && __tiplayEpoch!==(this.__tiplayLifecycle||0))throw new DOMException('Media operation was cancelled.','AbortError');return value;})(${original})`});
          lifecycleAwaits++;
        } });
      }
    },
  });
  for (const edit of lifecycleEdits.sort((a,b)=>b.start-a.start))
    code=code.slice(0,edit.start)+edit.value+code.slice(edit.end);
  // Wrapper supplies getWasm; remove the unreachable CDN default too.
  code = code.replace(/`https:\/\/cdn\.jsdelivr\.net\/gh\/zhaohappy\/libmedia@\$\{[^`]+`/g,
    '"/unsupported-libmedia-wasm"');
  if (code.includes('cdn.jsdelivr.net')) throw new Error(`Unreviewed CDN reference: ${name}`);
  let patchedAwaits = 0;
  simple(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }), { AwaitExpression() { patchedAwaits++; } });
  if (patchedAwaits !== originalAwaits + addedAwaits) throw new Error(`Patch changed await structure in ${name}`);
  await output(name === 'avplayer.js' ? 'upstream.js' : name, code);
}
if (sdrPolicySites !== 3) throw new Error(`Upstream SDR selection/error sites changed: ${sdrPolicySites}`);
if (manifestFailureSites !== 6) throw new Error(`Upstream HLS failure evidence sites changed: ${manifestFailureSites}`);
if (packedAacProbeSites !== 1) throw new Error(`Upstream packed AAC probe sites changed: ${packedAacProbeSites}`);
if (subtitlePacketBridgeSites !== 1 || subtitleReleaseSites !== 4) throw new Error(`Upstream subtitle packet ownership sites changed: ${subtitlePacketBridgeSites}/${subtitleReleaseSites}`);
if (subtitleDrainSites !== 3 || subtitleSeekSites !== 3) throw new Error(`Upstream subtitle drain/seek sites changed: ${subtitleDrainSites}/${subtitleSeekSites}`);
if (subtitleEofSites !== 3 || seekReplySites !== 1) throw new Error(`Upstream subtitle EOF/seek sites changed: ${subtitleEofSites}/${seekReplySites}`);
if (rpcErrorSites !== 2) throw new Error(`Upstream RPC error serializers changed: ${rpcErrorSites}`);
if (lifecycleSites !== 4 || lifecycleAwaits < 10) throw new Error(`Upstream lifecycle sites changed: ${lifecycleSites}/${lifecycleAwaits}`);
if (cancellationSites !== 6) throw new Error(`Upstream cancellation sites changed: ${cancellationSites}`);
if (contextGuardSites !== 1) throw new Error(`Upstream context event registration sites changed: ${contextGuardSites}`);
if (cleanupSites !== 1) throw new Error(`Upstream pipeline cleanup sites changed: ${cleanupSites}`);
if (liveSites !== 3) throw new Error(`Upstream HLS classification sites changed: ${liveSites}`);
if (workletSites !== 1) throw new Error(`Upstream Worklet registration count changed: ${workletSites}`);
if (fetchSites !== 13) throw new Error(`Upstream fetch call count changed: ${fetchSites}`);
for (const name of ['AudioSourceWorkletProcessorWorklet.js', 'AudioSourceWorkletProcessor2Worklet.js'])
  await output(name, await readFile(new URL(`node_modules/@libmedia/avrender/dist/${name}`, root)));
await output('avplayer.js', await readFile(new URL('entry.js', root)));
const cache = new URL('.cache/', root);
await mkdir(cache, { recursive: true });
for (const asset of lock.assets) {
  const cached = new URL(asset.path.replaceAll('/', '_'), cache);
  let data;
  try { data = await readFile(cached); } catch {
    execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--output', fileURLToPath(cached), asset.url]);
    data = await readFile(cached);
  }
  if (sha(data) !== asset.sha256 || data.length !== asset.bytes)
    throw new Error(`WASM integrity mismatch: ${asset.path}`);
  await output(asset.path, data);
}
await copyFile(new URL('node_modules/@libmedia/avplayer/COPYING.LGPLv3', root), new URL('COPYING.LGPLv3', destination));
const notices = [];
const modules = new URL('node_modules/', root);
const packages = [...(await readdir(new URL('@libmedia/', modules))).map(name => `@libmedia/${name}`),
  'ass-compiler', 'assjs'];
for (const name of packages.sort()) {
  const directory = new URL(`${name}/`, modules);
  const metadata = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  let license;
  for (const filename of ['COPYING.LGPLv3','LICENSE','LICENSE.md','LICENSE.txt']) {
    try { license = await readFile(new URL(filename, directory), 'utf8'); break; } catch {}
  }
  if (!license) throw new Error(`Missing license ${name}`);
  notices.push(`===== ${name}@${metadata.version} (${metadata.license}) =====\n${license}\n`);
}
for (const name of ['LGPL-2.1.txt','GPL-3.0.txt']) {
  notices.push(`===== ${name} =====\n${await readFile(new URL(`licenses/${name}`,root),'utf8')}\n`);
}
notices.push('===== WASM corresponding sources =====\nFFmpeg audio codec/resample modules and SoundTouch tempo: LGPL-2.1-or-later.\nPinned source/build definitions: https://github.com/zhaohappy/libmedia/tree/' + lock.commit + '\n');
await writeFile(new URL('THIRD_PARTY_LICENSES.txt', destination), notices.join('\n'));
await writeFile(new URL('artifacts.json', destination), JSON.stringify({ version: lock.version,
  commit: lock.commit, fetchRequestInitPatches: fetchSites, sameOriginWorkletPatches: workletSites, hlsClassificationPatches: liveSites, pipelineCleanupPatches: cleanupSites, cancellationPatches: cancellationSites, contextEventGuardPatches: contextGuardSites, lifecycleGuardMethods: lifecycleSites, lifecycleGuardAwaits: lifecycleAwaits, rpcErrorSerializerPatches: rpcErrorSites, subtitleEofPatches: subtitleEofSites, pendingSeekReplyPatches: seekReplySites, subtitlePacketBridgePatches: subtitlePacketBridgeSites, subtitlePacketReleasePatches: subtitleReleaseSites, subtitleDrainPatches: subtitleDrainSites, subtitleSeekPatches: subtitleSeekSites, sdrVariantPolicyPatches: sdrPolicySites, hlsManifestFailurePatches: manifestFailureSites, packedAacProbePatches: packedAacProbeSites, artifacts }, null, 2) + '\n');
console.log(`Vendored libmedia ${lock.version}: ${artifacts.length} files, ${fetchSites} scoped RequestInit patches.`);
