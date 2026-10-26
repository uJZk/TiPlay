// SPDX-License-Identifier: GPL-3.0-only
import './wasm-init.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_, value) => { Processor = value; };
globalThis.sampleRate = 48000; globalThis.currentFrame = 0;
await import('../../site/play/audio-worklet.js?native-mix');
const owner = (type, inputIndex = type) => ({ type, semanticType: type, inputIndex, rtpSlot: String(inputIndex),
  mode: 'carplay', epoch: 1, generation: 7, rtcGeneration: 1, channels: 1, rate: 48000 });
function render(processor, media, voice) {
  const output = [new Float32Array(media.length), new Float32Array(media.length)];
  processor.process([[media], [voice]], [output]); return output;
}

test('native browser-decoded inputs use the common WASM mixer without NetEq or an encoded-audio decoder', () => {
  const processor = new Processor(), messages = [];
  processor.port.postMessage = message => messages.push(message);
  processor.message({ reset: true, generation: 7 });
  processor.message({ nativeAudio: owner(0) }); processor.message({ nativeAudio: owner(1) });
  const output = render(processor, new Float32Array(480).fill(.5), new Float32Array(480).fill(.25));
  assert.equal(processor.streams.size, 0);
  assert.equal(processor.nativeInputs.size, 2);
  assert.ok(Math.abs(output[0][479] - .35) < 1e-6);
  assert.deepEqual(output[0], output[1]);
  assert.equal(messages.filter(message => message.nativeStarted).length, 2);
  assert.throws(() => processor.message({ type: 0, epoch: 2, payload: new ArrayBuffer(1), rate: 48000, channels: 1 }), /native RTP/);
  processor.message({ dispose: true });
});

test('native EOS retains buffered tail under its original role; silent ended inputs do not duck music', () => {
  const processor = new Processor(); processor.message({ reset: true, generation: 7 });
  processor.message({ nativeAudio: owner(0) }); processor.message({ nativeAudio: owner(1) });
  processor.message({ nativeAudioEnd: owner(1) });
  let output = render(processor, new Float32Array(480).fill(.5), new Float32Array(480));
  assert.ok(output[0].every(value => value === .5));
  assert.equal(processor.nativeInputs.get(1).ended, true);
  const tail = new Float32Array(480); tail.fill(.25, 0, 240);
  output = render(processor, new Float32Array(480).fill(.5), tail);
  assert.ok(Math.abs(output[0][239] - .35) < 1e-6, 'late voice tail still lowers media under its original voice role');
  assert.ok(Math.abs(output[0][479] - .5) < 1e-6, 'silence restores media even though the native track remains connected');
  assert.equal(processor.nativeInputs.get(1).state, 'draining');
  processor.message({ dispose: true });
});

test('old peer retirement removes old inputs and stale EOS cannot end a replacement owner', () => {
  const processor = new Processor(); processor.message({ reset: true, generation: 7 });
  processor.message({ nativeAudio: owner(0) });
  render(processor, new Float32Array(480).fill(.5), new Float32Array(480));
  processor.message({ nativeAudioRetire: { rtcGeneration: 1, generation: 7 } });
  assert.equal(processor.nativeInputs.size, 0);
  const replaced = { ...owner(0), epoch: 2, rtcGeneration: 2 };
  processor.message({ nativeAudio: replaced }); processor.message({ nativeAudioEnd: owner(0) });
  assert.equal(processor.nativeInputs.get(0).ended, undefined);
  processor.message({ reset: true, generation: 8 });
  processor.message({ nativeAudio: replaced });
  assert.equal(processor.nativeInputs.size, 0, 'old playback generations cannot attach tracks');
  processor.message({ dispose: true });
});

test('a new epoch in another slot cannot relabel or cut the old epoch buffered tail', () => {
  const processor = new Processor(); processor.message({ reset: true, generation: 7 });
  processor.message({ nativeAudio: owner(0) }); processor.message({ nativeAudioEnd: owner(0) });
  const next = { ...owner(0, 2), epoch: 2, semanticType: 1 };
  processor.message({ nativeAudio: next });
  const output = [new Float32Array(480), new Float32Array(480)];
  processor.process([[new Float32Array(480).fill(.5)], [], [new Float32Array(480).fill(.25)]], [output]);
  assert.equal(processor.nativeInputs.size, 2);
  assert.equal(processor.nativeInputs.get(0).semanticType, 0);
  assert.equal(processor.nativeInputs.get(2).semanticType, 1);
  assert.ok(Math.abs(output[0][479] - .35) < 1e-6, 'old media tail and new voice still use their own roles');
  processor.message({ dispose: true });
});

test('render-thread binding barrier acknowledges a connected graph even before RTP supplies any channels', () => {
  const processor = new Processor(), messages = [];
  processor.port.postMessage = message => messages.push(message);
  processor.message({ reset: true, generation: 7 });
  const source = { ...owner(0), awaitGraph: true };
  processor.message({ nativeAudio: source });
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(messages.some(message => message.nativeAudioBound), false, 'binding alone is not a connected source graph');
  processor.message({ nativeAudioGraph: source });
  assert.equal(messages.some(message => message.nativeAudioBound), false, 'posting connection metadata is not render-thread application');
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(messages.filter(message => message.nativeAudioBound).length, 1);
  assert.equal(messages.some(message => message.nativeStarted), false, 'readiness must not fabricate actual media arrival');
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(messages.filter(message => message.nativeAudioBound).length, 1);
  processor.message({ dispose: true });
});
