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
  const decoder = createAirPlayAudioDecoder({ onPcm: record => outputs.push(record), onError: error => errors.push(error), AudioDecoder: codecs.Decoder, EncodedAudioChunk: codecs.Chunk, probeTimeout: options.probeTimeout ?? 1000,
    softwareEldFactory: options.softwareEldFactory, drainTimeout: options.drainTimeout });
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
  const { decoder, instances, outputs } = harness(t); await decoder.configure({ ...configRecord(fixture.config, 7), mode: 'airplay-audio' });
  await decoder.decode(packetRecord([1,2,3], 7, { mode: 'airplay-audio' }));
  const data = outputData([[-1,0,.5,1],[.25,-.25,2,-2]], 1002000);
  instances[0].callbacks.output(data); const record = outputs.find(record => record.pcm.byteLength);
  assert.ok(record); assert.equal(data.closed, true); assert.equal(record.epoch, 7); assert.equal(record.rate, 44100); assert.equal(record.channels, 2);
  assert.equal(record.mode, 'airplay-audio'); assert.equal(record.presentationMs, 10002);
  assert.equal(record.decodeTimestampUs, 1002000, 'PCM starts at the decoded AudioData sample, independently of the input packet anchor');
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
  assert.equal(outputs.at(-1).decodeTimestampUs, 1000000);
  await decoder.configure(configRecord({codec:'pcm',sampleRate:44100,channels:1,bitDepth:24,littleEndian:false},2));
  await decoder.decode(packetRecord([0x80,0x00,0x00,0x00,0x00,0x00,0x7f,0xff,0xff],2,{channels:1}));
  assert.deepEqual([...new Int16Array(outputs.at(-1).pcm)],[-32768,0,32767]);
  assert.equal(instances.length,0);
});

test('software AAC-ELD retains the source sample timestamp independently of presentation refinements', async t => {
  const { decoder, outputs, errors } = harness(t, { supported: () => false, softwareEldFactory: () => ({
    ready: Promise.resolve(), decode: async () => new Int16Array(480 * 2).fill(123).buffer, close() {},
  }) });
  await decoder.configure(configRecord({ codec: 'aac-eld', sampleRate: 44100, channels: 2, bitDepth: 16,
    samplesPerFrame: 480, asc: [248,232,80,0] }));
  const timestamp = 7000000000 + 480000000 / 44100;
  await decoder.decode(packetRecord([1,2,3], 1, { decodeTimestampUs: timestamp, presentationMs: 10000.25 }));
  assert.equal(outputs.at(-1).decodeTimestampUs, timestamp);
  assert.equal(outputs.at(-1).presentationMs, 10000.25);
  assert.equal(outputs.at(-1).pcm.byteLength, 480 * 2 * 2);
  assert.deepEqual(errors, []);
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

const noData = [0, 0x68, 0x34, 0];
const eldConfig = { codec: 'aac-eld', sampleRate: 44100, channels: 2, bitDepth: 16, samplesPerFrame: 480, asc: [248, 232, 80, 0] };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('mirror NoData preserves a nineteen-frame silent span without invoking or resetting either AAC decoder', async t => {
  for (const codec of ['aac-lc', 'aac-eld']) for (const frames of codec === 'aac-lc' ? [960, 1024] : [480, 512]) for (const rate of [44100, 48000]) {
    const h = harness(t, { supported: () => true }), config = { ...fixture.config, codec, samplesPerFrame: frames, sampleRate: rate };
    await h.decoder.configure({ ...configRecord(config), type: 6 });
    let flushes = 0; h.instances[0].flush = async () => { flushes++; };
    for (let index = 0; index < 19; index++) {
      const decodeTimestampUs = 1e6 + index * frames * 1e6 / rate;
      assert.equal(await h.decoder.decode(packetRecord(noData, 1, { type: 6, sequence: index, rate,
        presentationMs: NaN, decodeTimestampUs, flags: 6 })), true);
    }
    const pcm = h.outputs.filter(record => record.pcm.byteLength);
    assert.equal(pcm.length, 19); assert.equal(flushes, 0); assert.equal(h.instances[0].chunks.length, 0);
    for (const [index, record] of pcm.entries()) {
      assert.equal(record.pcm.byteLength, frames * 2 * 2); assert.ok(new Int16Array(record.pcm).every(sample => sample === 0));
      assert.equal(record.sequence, index); assert.equal(record.epoch, 1); assert.equal(record.flags, 4);
      assert.ok(Number.isNaN(record.presentationMs)); assert.equal(record.decodeTimestampUs, 1e6 + index * frames * 1e6 / rate);
    }
    assert.equal(h.instances[0].state, 'configured'); assert.deepEqual(h.errors, []);
  }
});

test('asynchronous AAC output stays before NoData without flushing or blocking the next encoded packet', async t => {
  const h = harness(t), frames = 1024, step = frames * 1e6 / 44100;
  await h.decoder.configure(configRecord(fixture.config));
  const native = h.instances[0]; let flushes = 0;
  native.flush = async () => { flushes++; throw new Error('NoData must not flush the decoder'); };
  await h.decoder.decode(packetRecord([1, 2, 3], 1, { decodeTimestampUs: 1e6 }));
  const waiting = [
    h.decoder.decode(packetRecord(noData, 1, { decodeTimestampUs: 1e6 + step })),
    h.decoder.decode(packetRecord(noData, 1, { decodeTimestampUs: 1e6 + 2 * step })),
    h.decoder.decode(packetRecord([4, 5, 6], 1, { decodeTimestampUs: 1e6 + 3 * step })),
  ];
  assert.deepEqual(await Promise.all(waiting), [true, true, true]);
  assert.equal(flushes, 0); assert.equal(native.chunks.length, 2, 'a held native frame must not block later real input');
  assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0);
  native.callbacks.output(outputData([new Float32Array(frames).fill(.25), new Float32Array(frames).fill(-.25)]));
  native.callbacks.output(outputData([new Float32Array(frames).fill(.5), new Float32Array(frames).fill(-.5)], Math.round(1e6 + 3 * step)));
  const pcm = h.outputs.filter(record => record.pcm.byteLength);
  assert.deepEqual(pcm.map(record => record.sequence), [0, 1, 2, 3]);
  assert.deepEqual(pcm.map(record => new Int16Array(record.pcm)[0]), [8192, 0, 0, 16384]);
  assert.deepEqual(pcm.map(record => record.decodeTimestampUs), [1e6, 1e6 + step, 1e6 + 2 * step, 1e6 + 3 * step]);
  assert.equal(h.instances.length, 1); assert.equal(native.state, 'configured'); assert.deepEqual(h.errors, []);
});

test('native split and merged AAC output consume source samples before emitting queued NoData', async t => {
  const h = harness(t), frames = 1024, step = frames * 1e6 / 44100;
  await h.decoder.configure(configRecord(fixture.config));
  const native = h.instances[0]; native.flush = () => { throw new Error('Unexpected flush'); };
  for (const [index, payload] of [[0, [1]], [1, noData], [2, noData], [3, [2]], [4, [3]]])
    assert.equal(await h.decoder.decode(packetRecord(payload, 1, { sequence: index, decodeTimestampUs: 1e6 + index * step,
      presentationMs: 10000 + index * step / 1000, flags: index === 3 ? 4 : 0 })), true);
  // Half a real frame cannot release its following silent spans.
  native.callbacks.output(outputData([new Float32Array(frames / 2).fill(.25), new Float32Array(frames / 2).fill(-.25)]));
  assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 1);
  // One callback finishes that frame and joins both later real frames. Its
  // decoded frame count excludes the two NoData spans never fed to the codec.
  const merged = new Float32Array(frames / 2 + 2 * frames).fill(.5);
  native.callbacks.output(outputData([merged, merged], Math.round(1e6 + step / 2)));
  const pcm = h.outputs.filter(record => record.pcm.byteLength);
  assert.deepEqual(pcm.map(record => record.pcm.byteLength / 4), [512, 512, 1024, 1024, 1024, 1024]);
  assert.deepEqual(pcm.map(record => record.sequence), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(pcm.map(record => new Int16Array(record.pcm)[0]), [8192, 16384, 0, 0, 16384, 16384]);
  assert.deepEqual(pcm.map(record => record.flags), [0, 0, 0, 0, 4, 0]);
  assert.equal(pcm[4].decodeTimestampUs, 1e6 + 3 * step); assert.equal(pcm[5].decodeTimestampUs, 1e6 + 4 * step);
  assert.equal(pcm[4].presentationMs, 10000 + 3 * step / 1000);
  assert.deepEqual(h.errors, []);
});

test('mirror AAC source samples retain negative origins and silence even when native timestamps clamp or ignore gaps', async t => {
  const h = harness(t), frames = 1024, step = frames * 1e6 / 44100;
  await h.decoder.configure(configRecord(fixture.config));
  for (const [decodeTimestampUs, payload] of [[-23220, [1]], [0, [2]], [step, noData], [2 * step, [3]]])
    assert.equal(await h.decoder.decode(packetRecord(payload, 1, { decodeTimestampUs, presentationMs: 10000 + decodeTimestampUs / 1000 })), true);
  for (const timestamp of [0, 23219, 46439])
    h.instances[0].callbacks.output(outputData([new Float32Array(frames).fill(.25), new Float32Array(frames).fill(.25)], timestamp));
  const pcm = h.outputs.filter(record => record.pcm.byteLength);
  assert.deepEqual(pcm.map(record => record.decodeTimestampUs), [-23220, 0, step, 2 * step]);
  assert.deepEqual(pcm.map(record => record.presentationMs), [-23220, 0, step, 2 * step].map(timestamp => 10000 + timestamp / 1000));
  for (let index = 1; index < pcm.length; index++) assert.ok(Math.abs(pcm[index].decodeTimestampUs - pcm[index - 1].decodeTimestampUs - step) < 1);
  assert.deepEqual(pcm.map(record => new Int16Array(record.pcm)[0]), [8192, 8192, 0, 8192]);
  assert.deepEqual(h.errors, []);
});

test('native mirror AAC rejects an output sample rate outside its negotiated source sample domain', async t => {
  const h = harness(t); await h.decoder.configure(configRecord(fixture.config));
  await h.decoder.decode(packetRecord([1]));
  const data = outputData([new Float32Array(1024), new Float32Array(1024)], 1e6, 48000);
  h.instances[0].callbacks.output(data);
  assert.equal(data.closed, true); assert.equal(h.instances[0].state, 'closed');
  assert.equal(h.errors.length, 1); assert.match(h.errors[0].message, /Invalid decoded/);
  assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0);
});

test('NoData does not overtake pending software PCM and keeps unrelated stream decoders independent', async t => {
  let finish, calls = 0;
  const h = harness(t, { supported: config => config.codec === 'opus', softwareEldFactory: () => ({ ready: Promise.resolve(), close() {},
    decode: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }) });
  await h.decoder.configure({ ...configRecord(eldConfig), type: 6 });
  await h.decoder.configure({ ...configRecord({ codec: 'opus', sampleRate: 48000, channels: 2 }, 2), type: 1, mode: 'carplay' });
  const first = h.decoder.decode(packetRecord([1, 2, 3], 1, { type: 6 }));
  const silence = h.decoder.decode(packetRecord(noData, 1, { type: 6, decodeTimestampUs: 1e6 + 480e6 / 44100 }));
  await tick(); assert.equal(calls, 1); assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0);
  assert.equal(await h.decoder.decode(packetRecord([1], 2, { type: 1, mode: 'carplay', rate: 48000 })), true);
  h.instances[0].callbacks.output(outputData([[.5], [.5]], 1e6, 48000));
  finish(new Int16Array(480 * 2).fill(123).buffer);
  assert.deepEqual(await Promise.all([first, silence]), [true, true]);
  assert.deepEqual(h.outputs.filter(record => record.type === 6 && record.pcm.byteLength).map(record => new Int16Array(record.pcm)[0]), [123, 0]);
  assert.equal(calls, 1); assert.deepEqual(h.errors, []);
});

test('NoData only means silence for mirror AAC with a known negotiated sample count', async t => {
  for (const [config, mode, payload] of [[fixture.config, 'carplay', noData], [fixture.config, 'airplay-audio', noData],
    [{ codec: 'opus', sampleRate: 44100, channels: 2 }, 'airplay-mirror', noData],
    [{ ...fixture.config }, 'airplay-mirror', [0, 0x68, 0x34, 1]],
    [{ ...fixture.config }, 'airplay-mirror', [...noData, 0]]]) {
    const h = harness(t, { supported: () => true }); await h.decoder.configure({ ...configRecord(config), mode });
    assert.equal(await h.decoder.decode(packetRecord(payload, 1, { mode })), true);
    assert.equal(h.instances[0].chunks.length, 1); assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0);
    assert.deepEqual(h.errors, []);
  }
  for (const samplesPerFrame of [undefined, 0, 480, NaN]) {
    const h = harness(t); await h.decoder.configure(configRecord({ ...fixture.config, samplesPerFrame }));
    assert.equal(await h.decoder.decode(packetRecord(noData)), false);
    assert.equal(h.errors.length, 1); assert.match(h.errors[0].message, /no-data frame length/);
    assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0);
  }
});

test('retirement immediately drops queued NoData and late output without hurting a replacement epoch', async t => {
  for (const retire of ['reset', 'ended', 'dispose']) {
    const h = harness(t, { drainTimeout: 20 }); await h.decoder.configure(configRecord(fixture.config));
    const old = h.instances[0]; old.flush = () => { throw new Error('Unexpected flush'); };
    await h.decoder.decode(packetRecord([1, 2, 3]));
    assert.equal(await h.decoder.decode(packetRecord(noData)), true);
    if (retire === 'reset') h.decoder.reset(0);
    else if (retire === 'ended') await h.decoder.configure({ ...configRecord({ ended: true }, 2), rate: 44100, channels: 2 });
    else h.decoder.dispose();
    assert.equal(old.state, 'closed');
    const late = outputData([[.25], [.25]]); old.callbacks.output(late); assert.equal(late.closed, true);
    if (retire !== 'dispose') {
      await h.decoder.configure(configRecord(fixture.config, 3));
      assert.equal(await h.decoder.decode(packetRecord(noData, 3)), true);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(h.errors, []);
    assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, retire === 'dispose' ? 0 : 1);
  }
});

test('retirement immediately settles software decode and queued NoData promises', async t => {
  let finish;
  const h = harness(t, { supported: () => false, softwareEldFactory: () => ({ ready: Promise.resolve(), close() {},
    decode: () => new Promise(resolve => { finish = resolve; }) }) });
  await h.decoder.configure(configRecord(eldConfig));
  const first = h.decoder.decode(packetRecord([1, 2, 3])), silence = h.decoder.decode(packetRecord(noData));
  await tick(); h.decoder.reset(0);
  assert.deepEqual(await Promise.race([Promise.all([first, silence]), tick().then(() => 'pending')]), [false, false]);
  finish(new Int16Array(480 * 2).buffer); await tick();
  assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0); assert.deepEqual(h.errors, []);
});

test('a native source barrier fails once within the bounded output wait', async t => {
  const h = harness(t, { drainTimeout: 5 }); await h.decoder.configure(configRecord(fixture.config));
  await h.decoder.decode(packetRecord([1, 2, 3]));
  assert.equal(await h.decoder.decode(packetRecord(noData)), true, 'submission must not wait for codec-held PCM');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.errors.length, 1); assert.match(h.errors[0].message, /output timed out/);
  assert.equal(h.instances[0].state, 'closed');
  assert.equal(await h.decoder.decode(packetRecord(noData)), false); assert.equal(h.errors.length, 1);
});

test('queued NoData source metadata is bounded even before the event loop can run its deadline', async t => {
  const h = harness(t, { drainTimeout: 20 }); await h.decoder.configure(configRecord(fixture.config));
  await h.decoder.decode(packetRecord([1, 2, 3]));
  let accepted = 0;
  while (accepted < 128 && await h.decoder.decode(packetRecord(noData))) accepted++;
  assert.ok(accepted > 19 && accepted < 128);
  assert.equal(h.errors.length, 1); assert.match(h.errors[0].message, /backlog.*memory limit/);
  assert.equal(h.outputs.filter(record => record.pcm.byteLength).length, 0);
});

test('NoData diagnostics count generated source silence only while enabled and retain stream attribution', async t => {
  const h = harness(t, { supported: () => true });
  await h.decoder.configure({ ...configRecord(eldConfig), type: 6 });
  assert.equal(h.decoder.stats(), null);
  await h.decoder.decode(packetRecord(noData, 1, { type: 6 })); assert.equal(h.decoder.stats(), null);
  h.decoder.debug(true);
  assert.equal(Object.hasOwn(h.decoder.stats(), 'noDataPackets'), false);
  assert.equal(Object.hasOwn(h.decoder.stats().stream6, 'noDataPackets'), false);
  await h.decoder.decode(packetRecord(noData, 1, { type: 6 }));
  await h.decoder.decode(packetRecord(noData, 1, { type: 6 }));
  const stats = h.decoder.stats();
  assert.equal(stats.noDataPackets, 2); assert.equal(stats.noDataFrames, 960);
  assert.equal(stats.stream6.noDataPackets, 2); assert.equal(stats.stream6.noDataFrames, 960);
  assert.equal(stats.stream6.epoch, 1); assert.equal(stats.stream6.nonzero, 0);
  assert.equal(stats.packets, 2); assert.equal(stats.frames, 960);
  h.decoder.debug(false); assert.equal(h.decoder.stats(), null);
  h.decoder.debug(true); assert.equal(Object.hasOwn(h.decoder.stats(), 'noDataFrames'), false);
});
