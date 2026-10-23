// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { phaseSummary, summarize, VERSION } from '../../site/play/chatgpt/analysis.js';
import { buildReport, createReportUrl, readReportFragment, summaryJson } from '../../site/play/chatgpt/report-share.js';

function result() {
  return { rate: 1000, samples: [0, 500, 1100].map(p => ({ p, c: p * .98, phase: 0, visible: true, state: 'running', epochErrorMs: 0 })),
    probes: [{ send: 1, receive: 3, frame: 0, totalFrames: 0, generation: 0, discontinuities: 0 },
      { send: 1001, receive: 1003, frame: 980, totalFrames: 980, generation: 0, discontinuities: 0 }]
      .map(row => ({ ...row, phase: 0, phaseAtReceive: 0, visible: true, running: true })),
    reports: [], events: [], load: [], caps: {} };
}

function completedResult() {
  const value = result();
  Object.assign(value, { rate:48000, version:VERSION, requestedRate:0, durationSeconds:15, elapsedMs:15000,
    completion:'已完成', userAgent:'Chrome/148.0.0.0 Linux', expiredProbes:0, nativeReadErrors:0,
    eventAttempts:{state:0,visibility:0,pop:0}, reports:[{phase:0,receive:5,visible:true,quantum:128,minQuantum:64,maxQuantum:1024}] });
  value.samples[0].epochErrorMs = .000122;
  value.summary = summarize(value); return value;
}

test('portable summary preserves actual frames, outward intervals, tiny epoch evidence and null availability', async () => {
  const source = completedResult(), report = buildReport(source);
  assert.equal(report.phases[0].actualFrameDelta,980);
  assert.equal(report.quantumMinFrames,64); assert.equal(report.quantumMaxFrames,1024);
  assert.equal(report.epochRoundingErrorMaxMs,.000122);
  assert.equal(report.phases[0].nativeSpanMs,null);
  assert.ok(report.phases[0].frameDifferenceLowerMs <= source.summary.phases[0].frames.differenceRangeMs[0]);
  assert.ok(report.phases[0].frameDifferenceUpperMs >= source.summary.phases[0].frames.differenceRangeMs[1]);
  const transfer = await createReportUrl(report,'https://ujzk.github.io/TiPlay/chatgpt/');
  assert.ok(transfer.url.length <= 1900);
  const received = await readReportFragment(new URL(transfer.url).hash);
  assert.equal(summaryJson(received),summaryJson(report));
  assert.equal(received.rawIncluded,false); assert.equal(received.timerQuantizationUncertaintyBounded,false);
  assert.equal(Object.hasOwn(JSON.parse(summaryJson(received)),'_wire'),false);
});

test('portable marks distinguish stored events, total attempts, summary omission and original event loss', () => {
  const source = completedResult();
  source.events = Array.from({length:1000},(_,i) => ({kind:'pop',p:i}));
  source.eventAttempts.pop = 1001; source.caps.events = 1; source.summary = summarize(source);
  const report = buildReport(source);
  assert.deepEqual(report.marks,{recordedTotal:1000,attemptedTotal:1001,omittedRecorded:992,timesMs:[0,1,2,3,996,997,998,999]});
  assert.equal(report.caps.events,1);
  assert.equal(report.phases[0].getterSpanMs,null); assert.equal(report.phases[0].processedMs,null);
});

test('malformed, oversized and decompression-bomb report fragments fail without losing safety bounds', async () => {
  const source = buildReport(completedResult());
  await assert.rejects(readReportFragment('#clock-report=2.j.' + 'A'.repeat(1900)),/过长/);
  const malformed = structuredClone(source._wire); malformed[17][0].pop();
  const fragment = '#clock-report=2.j.' + Buffer.from(JSON.stringify(malformed)).toString('base64url');
  await assert.rejects(readReportFragment(fragment),/无效/);
  await assert.rejects(createReportUrl({_wire:['x'.repeat(9000)]},'https://ujzk.github.io/TiPlay/chatgpt/'),/上限/);
  if (typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
    const input = new Blob(['x'.repeat(9000)]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = Buffer.from(await new Response(input).arrayBuffer());
    await assert.rejects(readReportFragment('#clock-report=2.g.' + bytes.toString('base64url')),/安全上限/);
  }
});

test('clock lab uses process-event send/receive bounds rather than treating receipt as audio time', () => {
  const summary = phaseSummary(result(), 0);
  assert.deepEqual(summary.frames.differenceRangeMs, [-22, -18]);
  assert.equal(summary.frames.processedMs, 980);
  assert.equal(summary.frames.minimumSpanMs, 998);
  assert.equal(summary.frames.maximumSpanMs, 1002);
  assert.ok(summary.frames.effectiveRatePpmRange[1] < 0);
  assert.equal(summarize(result()).physicalOutputMeasured, false);
});

test('wide probe uncertainty can prevent claiming an actual progress deficit', () => {
  const data = result(); data.probes[1].send = 950; data.probes[1].receive = 1050;
  const range = phaseSummary(data, 0).frames.differenceRangeMs;
  assert.ok(range[0] < 0 && range[1] > 0);
});

test('submillisecond coarse-timer differences are explicitly unbounded and missing lifecycle events disable progress conclusions', () => {
  const data = result(); data.rate = 48000;
  data.probes[0] = { ...data.probes[0], send: 0, receive: 0, totalFrames: 0 };
  data.probes[1] = { ...data.probes[1], send: 133.4, receive: 133.4, totalFrames: 6400 };
  assert.ok(phaseSummary(data, 0).frames.differenceRangeMs[1] < 0);
  assert.equal(summarize(data).timerQuantizationUncertaintyBounded, false);
  data.caps.events = 1;
  const summary = phaseSummary(data, 0);
  assert.equal(summary.frames, null); assert.equal(summary.getter, null); assert.equal(summary.nativeTimestamp, null);
});

test('hidden or suspended intervals never get joined into a misleading foreground drift estimate', () => {
  for (const boundary of [{ kind: 'visibility', visible: false }, { kind: 'state', state: 'suspended' }]) {
    const data = result();
    data.samples = [0, 100, 200, 500, 600, 700].map(p => ({ p, c: p, phase: 0, visible: true, state: 'running', epochErrorMs: 0 }));
    data.events.push({ p: 300, ...boundary });
    const summary = phaseSummary(data, 0);
    assert.equal(summary.foregroundSegments, 2);
    assert.equal(summary.getter.spanMs, 200);
    assert.equal(summary.getter.differenceMs, 0);
    assert.equal(summary.excludedSamples, 3);
    assert.equal(summary.frames, null);
  }
});

test('a boundary-crossing probe and unavailable native API cannot invent measured evidence', () => {
  const data = result(); data.probes[1].phaseAtReceive = 1;
  const summary = phaseSummary(data, 0);
  assert.equal(summary.frames, null); assert.equal(summary.nativeTimestamp, null);
  for (const row of data.samples) Object.assign(row, { nativeFresh: true, nativeP: row.p - 2000, nativeC: row.c });
  assert.equal(phaseSummary(data, 0).nativeTimestamp, null, 'old native timestamps outside the current foreground segment stay excluded');
});

test('standalone worklet proves tokens only inside process and detects even one-block coordinate gaps', () => {
  let Processor; const messages = [];
  const realm = { sampleRate: 48000, currentFrame: 0, registerProcessor: (_, value) => { Processor = value; },
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } } };
  vm.runInNewContext(readFileSync(new URL('../../site/play/chatgpt/probe-worklet.js', import.meta.url), 'utf8'), realm);
  const processor = new Processor(), block = frames => [new Float32Array(frames), new Float32Array(frames)];
  processor.port.onmessage({ data: { probe: 1 } }); assert.equal(messages.length, 0);
  const first = block(128); processor.process([], [first]);
  assert.equal(messages.find(row => row.probe === 1).generation, 0);
  assert.equal(messages.find(row => row.probe === 1).totalFrames, 0);
  assert.ok(first[0].some(value => value !== 0));
  realm.currentFrame = 256; processor.port.onmessage({ data: { probe: 2 } }); processor.process([], [block(64)]);
  const changed = messages.find(row => row.probe === 2);
  assert.equal(changed.generation, 1); assert.equal(changed.runStart, 256); assert.equal(changed.discontinuities, 1);
  realm.currentFrame = 320; processor.port.onmessage({ data: { probe: 3 } }); processor.process([], [block(256)]);
  assert.equal(messages.find(row => row.probe === 3).generation, 1, 'a valid change of quantum size uses the previous block end');
  processor.port.onmessage({ data: { stop: true } }); assert.equal(processor.process([], [block(128)]), false);
});

test('standalone diagnostic CSP and source paths remain independent of the production player', () => {
  const html = readFileSync(new URL('../../site/play/chatgpt/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../site/play/chatgpt/app.js', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'none'/); assert.doesNotMatch(html, /unsafe-eval|unsafe-inline/);
  assert.doesNotMatch(app, /from ['"]\.\.\//);
  assert.match(html, /https:\/\/github\.com\/uJZk\/TiPlay\/releases["']/);
  const sw = readFileSync(new URL('../../site/play/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sw, /"chatgpt\//, 'root offline cache must not replace the standalone page');
});
