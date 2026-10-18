// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAirPlayAudioDecoder } from '../../site/play/airplay-audio-decoder.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/airplay-aac-lc.json', import.meta.url)));
const configRecord = (config, epoch = 1) => ({ type: 0, epoch, mode: 'airplay-mirror', flags: 2, rate: config.sampleRate, channels: config.channels, presentationMs: NaN, config });
const packetRecord = (payload, epoch = 1, fields = {}) => ({ type: 0, epoch, mode: 'airplay-mirror', flags: 0, rate: 44100, channels: 2, presentationMs: 10000, decodeTimestampUs: 1000000, payload: Uint8Array.from(payload).buffer, ...fields });
function fakeCodecs({ supported = config => config.codec === 'mp4a.40.2' } = {}) {
  const instances = [], probes = [];
  class Decoder {
    static async isConfigSupported(config) { probes.push(config); return { supported: await supported(config), config }; }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.decodeQueueSize = 0; this.chunks = []; instances.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); }
    reset() { this.chunks = []; this.state = 'unconfigured'; }
    close() { this.state = 'closed'; }
    async flush() {}
    addEventListener() {}
    removeEventListener() {}
  }
  class Chunk { constructor(options) { Object.assign(this, options); this.data = Uint8Array.from(options.data instanceof ArrayBuffer ? new Uint8Array(options.data) : options.data); } }
  return { Decoder, Chunk, instances, probes };
}
function outputData(planes, timestamp = 1000000, sampleRate = 44100) {
  return { timestamp, sampleRate, numberOfChannels: planes.length, numberOfFrames: planes[0].length, closed: false,
    copyTo(target, { planeIndex, format }) { assert.equal(format, 'f32-planar'); target.set(planes[planeIndex]); }, close() { this.closed = true; } };
}
function harness(t, options = {}) {
  const codecs = fakeCodecs(options), outputs = [], errors = [];
  const decoder = createAirPlayAudioDecoder({ onPcm: record => outputs.push(record), onError: error => errors.push(error), AudioDecoder: codecs.Decoder, EncodedAudioChunk: codecs.Chunk, probeTimeout: options.probeTimeout ?? 1000 });
  t.after(() => decoder.dispose()); return { decoder, outputs, errors, ...codecs };
}

test('browser AACLC configuration forwards the real source ASC and raw packet unchanged', async t => {
  const { decoder, instances, probes, outputs } = harness(t);
  assert.equal(await decoder.configure(configRecord(fixture.config)), true);
  assert.equal(probes[0].codec, 'mp4a.40.2'); assert.equal(probes[0].sampleRate, 44100); assert.equal(probes[0].numberOfChannels, 2);
  assert.deepEqual([...new Uint8Array(probes[0].description)], fixture.config.asc);
  const payload = Buffer.from(fixture.packets[1].payload, 'base64'); await decoder.decode(packetRecord(payload));
  assert.equal(instances.length, 1); assert.deepEqual([...instances[0].chunks[0].data], [...payload]);
  assert.equal(instances[0].chunks[0].timestamp, 1000000);
  assert.equal(outputs[0].pcm.byteLength, 0); assert.equal(outputs[0].flags & 2, 2);
});

test('AudioData planes interleave to PCM16 and retain epoch and presentation timing', async t => {
  const { decoder, instances, outputs } = harness(t); await decoder.configure(configRecord(fixture.config, 7));
  await decoder.decode(packetRecord([1,2,3], 7));
  const data = outputData([[-1,0,.5,1],[.25,-.25,2,-2]], 1002000);
  instances[0].callbacks.output(data); const record = outputs.find(record => record.pcm.byteLength);
  assert.ok(record); assert.equal(data.closed, true); assert.equal(record.epoch, 7); assert.equal(record.rate, 44100); assert.equal(record.channels, 2);
  assert.equal(record.mode, 'airplay-mirror'); assert.equal(record.presentationMs, 10002);
  const samples = [...new Int16Array(record.pcm)];
  assert.equal(samples[0], -32768); assert.equal(samples.at(-1), -32768); assert.equal(samples[5], 32767); assert.equal(samples[6], 32767);
  assert.equal(samples[2], 0); assert.ok(Math.abs(samples[1]-8192)<=1); assert.ok(Math.abs(samples[3]+8192)<=1); assert.ok(Math.abs(samples[4]-16384)<=1);
});

test('source epoch replacement drops and closes old asynchronous AudioData', async t => {
  const { decoder, instances, outputs } = harness(t); await decoder.configure(configRecord(fixture.config, 1)); await decoder.decode(packetRecord([1,2,3],1));
  const old = instances[0]; await decoder.configure(configRecord(fixture.config, 2)); assert.equal(old.state,'closed');
  const data = outputData([[.5],[.5]]); old.callbacks.output(data);
  assert.equal(data.closed,true); assert.equal(outputs.filter(record => record.pcm.byteLength).length,0);
  await decoder.decode(packetRecord([4,5,6],1)); assert.equal(instances[1].chunks.length,0);
});

test('PCM16 network big endian and PCM24 signed samples decode in browser JavaScript', async t => {
  const { decoder, outputs, instances } = harness(t);
  await decoder.configure(configRecord({codec:'pcm',sampleRate:48000,channels:1,bitDepth:16,littleEndian:false},1));
  await decoder.decode(packetRecord([0x80,0x00,0x00,0x00,0x7f,0xff],1,{rate:48000,channels:1}));
  assert.deepEqual([...new Int16Array(outputs.at(-1).pcm)],[-32768,0,32767]);
  await decoder.configure(configRecord({codec:'pcm',sampleRate:44100,channels:1,bitDepth:24,littleEndian:false},2));
  await decoder.decode(packetRecord([0x80,0x00,0x00,0x00,0x00,0x00,0x7f,0xff,0xff],2,{channels:1}));
  assert.deepEqual([...new Int16Array(outputs.at(-1).pcm)],[-32768,0,32767]);
  assert.equal(instances.length,0);
});

test('PCM16 little endian preserves sign and frame count without a native decoder', async t => {
  const { decoder, outputs } = harness(t); await decoder.configure(configRecord({codec:'pcm',sampleRate:44100,channels:2,bitDepth:16,littleEndian:true}));
  const pcm=new Int16Array([-1,1234,-32768,32767]); await decoder.decode({...packetRecord([],1),payload:pcm.buffer});
  assert.deepEqual([...new Int16Array(outputs.at(-1).pcm)], [...pcm]);
});

test('unsupported ALAC and unavailable AAC-ELD software decoding report explicit errors', async t => {
  const { decoder, instances, errors, probes } = harness(t);
  for (const [epoch,config] of [[1,{codec:'alac',sampleRate:44100,channels:2,bitDepth:16,samplesPerFrame:352,cookie:Array(36).fill(0)}],[2,{codec:'aac-eld',sampleRate:44100,channels:2,bitDepth:16,samplesPerFrame:480,asc:[248,232,80,0]}]]) {
    const before=errors.length; assert.equal(await decoder.configure(configRecord(config,epoch)),false); await decoder.decode(packetRecord([1,2,3],epoch));
    assert.equal(errors.length,before+1);
    assert.match(errors.at(-1).message,config.codec==='aac-eld'?/requires a Worker/:/cannot decode AirPlay ALAC/);
  }
  assert.equal(instances.length,0); assert.equal(probes.length,2);
});

test('disposal closes the browser decoder and closes late output without publishing PCM', async t => {
  const { decoder, instances, outputs } = harness(t); await decoder.configure(configRecord(fixture.config)); await decoder.decode(packetRecord([1,2,3]));
  decoder.dispose(); const data=outputData([[.2],[.2]]); instances[0].callbacks.output(data);
  assert.equal(data.closed,true); assert.equal(instances[0].state,'closed'); assert.equal(outputs.filter(record=>record.pcm.byteLength).length,0);
});

test('a delayed codec capability probe cannot install a decoder into a replacement epoch', async t => {
  let finishProbe;
  const { decoder, instances, errors }=harness(t,{supported:()=>new Promise(resolve=>{finishProbe=resolve;})});
  const opening=decoder.configure(configRecord(fixture.config,1));
  await decoder.configure(configRecord({codec:'pcm',sampleRate:44100,channels:2,bitDepth:16,littleEndian:true},2));
  finishProbe(true);assert.equal(await opening,false);assert.equal(instances.length,0);assert.equal(errors.length,0);
});

test('a hung browser capability probe reports one bounded failure', async t => {
  const {decoder,errors,instances}=harness(t,{supported:()=>new Promise(()=>{}),probeTimeout:5});
  assert.equal(await decoder.configure(configRecord(fixture.config)),false);assert.equal(errors.length,1);assert.equal(instances.length,0);
  await decoder.decode(packetRecord([1,2,3]));assert.equal(errors.length,1);
});

test('partial PCM stereo frames fail once instead of emitting corrupt audio', async t => {
  const {decoder,outputs,errors}=harness(t);await decoder.configure(configRecord({codec:'pcm',sampleRate:44100,channels:2,bitDepth:16,littleEndian:true}));
  assert.equal(await decoder.decode(packetRecord([1,2])),false);assert.equal(errors.length,1);assert.equal(outputs.filter(record=>record.pcm.byteLength).length,0);
  await decoder.decode(packetRecord([1,2,3,4]));assert.equal(errors.length,1);
});

test('older config epochs cannot replace the active browser decoder', async t => {
  const {decoder,instances}=harness(t);await decoder.configure(configRecord(fixture.config,2));
  assert.equal(await decoder.configure(configRecord(fixture.config,1)),false);assert.equal(instances.length,1);assert.equal(instances[0].state,'configured');
});

test('CarPlay AAC music and Opus navigation retain independent decoder epochs and unique output sequences', async t => {
  const {decoder,instances,outputs,probes}=harness(t,{supported:config=>['mp4a.40.2','opus'].includes(config.codec)});
  await decoder.configure({...configRecord(fixture.config),mode:'carplay',flags:3});
  await decoder.configure({...configRecord({codec:'opus',sampleRate:48000,channels:2,bitDepth:16,samplesPerFrame:960},4),type:1,mode:'carplay'});
  assert.equal(probes[1].codec,'opus');assert.equal(probes[1].description,undefined);
  const music=instances[0],navigation=instances[1];
  for(let i=0;i<10;i++)await decoder.decode(packetRecord([1,2,3],1,{sequence:i,flags:1,decodeTimestampUs:1000000+i*20000}));
  for(let i=0;i<10;i++)music.callbacks.output(outputData([[.1],[.1]],1000000+i*20000));
  const published=outputs.filter(record=>record.pcm.byteLength);
  assert.equal(new Set(published.map(record=>record.sequence)).size,10);assert.ok(published.every(record=>record.flags&1));
  decoder.reset(0);assert.equal(music.state,'closed');assert.equal(navigation.state,'configured');
  await decoder.decode(packetRecord([4,5,6],4,{type:1,rate:48000,mode:'carplay'}));
  navigation.callbacks.output(outputData([[.2],[.2]],1000000,48000));
  assert.equal(outputs.at(-1).type,1);assert.equal(outputs.at(-1).mode,'carplay');assert.equal(outputs.at(-1).epoch,4);
});

test('valid single ADTS header is removed defensively while raw AAC packets stay unchanged',async t=>{
 const{decoder,instances}=harness(t);await decoder.configure(configRecord(fixture.config));
 await decoder.decode(packetRecord([255,241,80,128,1,95,252,1,2,3]));
 assert.deepEqual([...instances[0].chunks[0].data],[1,2,3]);
});

test('extended CarPlay transport IDs retain purpose separately through configuration, PCM and end', async t => {
  const { decoder, outputs, errors } = harness(t);
  const common = { type: 255, epoch: 3, mode: 'carplay', flags: 2, rate: 48000, channels: 1, sequence: 0 };
  assert.equal(await decoder.configure({ ...common, config: { codec: 'pcm', sampleRate: 48000, channels: 1, bitDepth: 16, semanticType: 1 } }), true);
  assert.equal(await decoder.decode({ ...common, flags: 0, payload: Uint8Array.of(0x12, 0x34).buffer, presentationMs: 10000 }), true);
  assert.equal(outputs.at(-1).type, 255); assert.equal(outputs.at(-1).semanticType, 1);
  assert.deepEqual([...new Int16Array(outputs.at(-1).pcm)], [0x1234]);
  await decoder.configure({ ...common, epoch: 4, config: { ended: true, semanticType: 1 } });
  assert.equal(outputs.at(-1).ended, true); assert.equal(outputs.at(-1).semanticType, 1);
  assert.deepEqual(errors, []);
  assert.equal(await decoder.configure({ ...common, epoch: 5, config: { codec: 'pcm', sampleRate: 48000, channels: 1, bitDepth: 16 } }), false);
  assert.match(errors.at(-1).message, /purpose/);
});
