import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8');
const version = /const VERSION = '([^']+)'/.exec(source)[1], current = 'tiplay-play-' + version;
const old = 'tiplay-play-previous', root = 'https://example.test/TiPlay/';
const metadata = 'tiplay-client-owners-v1', ownerRoot = root + '__tiplay_clients__/';
const pinned = (cache, path) => root + '__tiplay_cache__/' + cache.slice('tiplay-play-'.length) + '/' + path;
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;});return {promise,resolve,reject}; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture({ existing = true, clients = [], owners = {}, get, matchAll } = {}) {
  const installed=deferred(), data=new Map(), navigated=[];let takeovers=0, installs=0, network=0, listeners;
  const key=value=>typeof value==='string'?value:value.url??value.href;
  function cache(name) {
    if(!data.has(name))data.set(name,new Map());const entries=data.get(name);
    return {async keys(){return [...entries.keys()].map(url=>new Request(url));},async match(value){return entries.get(key(value))?.clone();},
      async put(value,response){entries.set(key(value),response.clone());},async delete(value){return entries.delete(key(value));},
      async addAll(requests){installs++;assert.ok(requests.every(request=>request.cache==='reload'));await installed.promise;
        for(const request of requests)entries.set(request.url,new Response('current'));}};
  }
  const caches={async keys(){return [...data.keys()];},async open(name){return cache(name);},async delete(name){return data.delete(name);}};
  function populate(name,label='current') {const target=cache(name);for(const path of ['', 'index.html','client.js','decoder-worker.js'])
    data.get(name).set(root+path,new Response(label,{headers:{'Content-Type':'text/javascript'}}));return target;}
  populate(current);if(existing)populate(old,'previous');populate('unrelated-cache');
  for(const[id,record]of Object.entries(owners))cache(metadata).put(ownerRoot+id,new Response(JSON.stringify(record)));
  const records=async()=>{const result={};for(const[url,response]of data.get(metadata)??[]) {
    const value=await response.clone().json();if(value.cache||value.blocked)result[url.slice(ownerRoot.length)]=value;}return result;};
  for(const client of clients) {
    client.type??='window';client.live??=true;const navigate=client.navigate;
    client.navigate=async url=>{navigated.push(url);const value=await navigate?.(url);client.live=false;return value;};
  }
  const worker={location:new URL(root+'sw.js'),addEventListener:(name,callback)=>listeners[name]=callback,
    skipWaiting(){takeovers++;return Promise.resolve();},clients:{matchAll:matchAll??(async()=>clients.filter(client=>client.live)),
      get:get??(async id=>clients.find(client=>client.id===id&&client.live))}};
  class RelativeRequest extends Request {constructor(path,options){super(new URL(typeof path==='string'?path:key(path),worker.location),options);}}
  function restart(){listeners={};new Function('self','caches','Request','fetch',source)(worker,caches,RelativeRequest,async()=>{network++;return new Response('network');});}
  restart();
  const dispatch=name=>{let completion;listeners[name]({waitUntil(value){completion=value;}});return completion;};
  async function fetchEvent(path,{clientId='',resultingClientId='',mode='cors',method='GET'}={}) {
    let response;const background=[];listeners.fetch({request:{url:new URL(path,root).href,method,mode},clientId,resultingClientId,
      respondWith(value){response=value;},waitUntil(value){background.push(value);}});
    return {response:response?await response:null,background:Promise.all(background)};
  }
  return {data,caches,populate,records,restart,dispatch,fetchEvent,navigated,installed,takeovers:()=>takeovers,installs:()=>installs,network:()=>network};
}

test('a fully cached update takes over and reloads only TiPlay pages while preserving the pairing URL',async()=>{
  const h=fixture({clients:[{id:'old-window',url:root+'?t=phone#c=1234'},{id:'download-window',url:root+'download/'}]});
  const installing=h.dispatch('install');await turn();assert.equal(h.installs(),1);assert.equal(h.takeovers(),0);
  h.installed.resolve();await installing;assert.equal(h.takeovers(),1);assert.ok(h.data.has(old));
  await h.dispatch('activate');await turn();assert.deepEqual(h.navigated,[root+'?t=phone#c=1234']);
  assert.equal(h.data.has(old),false);assert.ok(h.data.has(current));assert.ok(h.data.has('unrelated-cache'));
});
test('failed precaching does not force takeover or remove the previous cache',async()=>{
  const h=fixture(), installing=h.dispatch('install');h.installed.reject(Error('temporary download failure'));
  await assert.rejects(installing,/temporary download failure/);assert.ok(h.data.has(old));assert.equal(h.takeovers(),0);
});
test('first installation does not claim or navigate an uncontrolled window',async()=>{
  const h=fixture({existing:false,clients:[{id:'first-window',url:root}]});await h.dispatch('activate');
  assert.equal(h.navigated.length,0);
});
test('old window resources remain pinned while activation completes before a pending navigation',async()=>{
  const navigation=deferred(), h=fixture({clients:[{id:'old-window',url:root,navigate:()=>navigation.promise}],
    owners:{'old-window':{cache:old,confirmed:true}}});
  await h.dispatch('activate');
  const redirect=await h.fetchEvent('decoder-worker.js',{clientId:'old-window'});
  assert.equal(redirect.response.headers.get('Location'),pinned(old,'decoder-worker.js'));
  const asset=await h.fetchEvent(pinned(old,'decoder-worker.js'),{clientId:'old-window'});
  assert.equal(await asset.response.text(),'previous');assert.ok(h.data.has(old));
  navigation.resolve();await turn();
});
test('failed navigation retains its exact old cache and ownership after service worker restart',async()=>{
  const h=fixture({clients:[{id:'old-window',url:root,navigate:async()=>{throw Error('navigation rejected');}}],
    owners:{'old-window':{cache:old,confirmed:true}}});
  await h.dispatch('activate');await turn();assert.ok(h.data.has(old));h.restart();
  const asset=await h.fetchEvent(pinned(old,'decoder-worker.js'),{clientId:'old-window'});
  assert.equal(await asset.response.text(),'previous');assert.equal((await h.records())['old-window'].cache,old);
});
test('reserved navigation ownership survives cleanup and restart even when its previous window has disappeared',async()=>{
  const h=fixture({existing:false,get:async()=>{throw Error('unconfirmed reserved client must not be awaited');}});
  const event=await h.fetchEvent('',{mode:'navigate',clientId:'departed-window',resultingClientId:'reserved-window'});
  assert.equal(event.response.status,200);await event.background;
  assert.equal((await h.records())['reserved-window'].cache,current);h.restart();
  const module=await h.fetchEvent('client.js',{clientId:'reserved-window'});assert.equal(module.response.status,302);
});
test('old active cleanup never deletes a future worker installation cache',async()=>{
  const navigation=deferred(), h=fixture({clients:[{id:'old-window',url:root,navigate:()=>navigation.promise}],
    owners:{'old-window':{cache:old,confirmed:true}}});
  await h.dispatch('activate');h.populate('tiplay-play-future','future');
  const event=await h.fetchEvent(pinned(old,'decoder-worker.js'),{clientId:'old-window'});await event.background;
  assert.ok(h.data.has('tiplay-play-future'));h.restart();
  const again=await h.fetchEvent(pinned(old,'decoder-worker.js'),{clientId:'old-window'});await again.background;
  assert.ok(h.data.has('tiplay-play-future'));navigation.resolve();await turn();
});
test('unknown controlled app windows block and navigate instead of guessing a cache, without storing pairing URLs',async()=>{
  const navigation=deferred(), h=fixture({existing:false,clients:[{id:'unknown-window',url:root+'?t=phone#c=1234',navigate:()=>navigation.promise}]});
  const event=await h.fetchEvent('decoder-worker.js',{clientId:'unknown-window'});assert.equal(event.response.status,503);
  assert.deepEqual(h.navigated,[root+'?t=phone#c=1234']);assert.equal((await h.records())['unknown-window'].blocked,true);
  assert.doesNotMatch(JSON.stringify(await h.records()),/https:|\?t=|#c=/);navigation.resolve();await turn();
});
test('unknown unversioned workers fail while explicit cached namespaces need no invented client identity',async()=>{
  const h=fixture();const unknown=await h.fetchEvent('decoder-worker.js',{clientId:'unknown-worker'});
  assert.equal(unknown.response.status,503);
  const explicit=await h.fetchEvent(pinned(old,'decoder-worker.js'));assert.equal(await explicit.response.text(),'previous');
  const absent=await h.fetchEvent(pinned('tiplay-play-missing','decoder-worker.js'));assert.equal(absent.response.status,503);
  assert.equal(h.data.has('tiplay-play-missing'),false);assert.equal(h.network(),0);
});
test('old-only manifest assets remain available to their owner and unrelated download requests stay on the network',async()=>{
  const h=fixture({owners:{'old-window':{cache:old,confirmed:true}},clients:[{id:'old-window',url:root}]});
  await(await h.caches.open(old)).put(root+'legacy-worker.js',new Response('old-only'));
  const redirect=await h.fetchEvent('legacy-worker.js',{clientId:'old-window'});assert.equal(redirect.response.status,302);
  const asset=await h.fetchEvent(pinned(old,'legacy-worker.js'),{clientId:'old-window'});assert.equal(await asset.response.text(),'old-only');
  const download=await h.fetchEvent('download/',{mode:'navigate'});assert.equal(download.response,null);assert.equal(h.network(),0);
});
test('rebuilt namespace responses clear original URL and decoded-body transport headers',async()=>{
  const h=fixture();await(await h.caches.open(old)).put(root+'decoder-worker.js',new Response('decoded',{headers:{
    'Content-Type':'text/javascript','Content-Encoding':'gzip','Content-Length':'123','Content-Security-Policy':"default-src 'self'"}}));
  const event=await h.fetchEvent(pinned(old,'decoder-worker.js'));
  assert.equal(event.response.url,'');assert.equal(await event.response.text(),'decoded');
  assert.equal(event.response.headers.get('Content-Encoding'),null);assert.equal(event.response.headers.get('Content-Length'),null);
  assert.equal(event.response.headers.get('Content-Type'),'text/javascript');assert.equal(event.response.headers.get('Content-Security-Policy'),"default-src 'self'");
});
test('confirmed live owners keep old caches even after reservation expiry or stale matchAll snapshots',async()=>{
  const client={id:'old-window',url:root,live:true},h=fixture({clients:[client],matchAll:async()=>[],get:async id=>id===client.id?client:null,
    owners:{'old-window':{cache:old,confirmed:true,reservedUntil:0}}});
  await h.dispatch('activate');assert.ok(h.data.has(old));
});
