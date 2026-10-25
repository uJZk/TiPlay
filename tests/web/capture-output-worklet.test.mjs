import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web-e2e/capture-output-worklet.js', import.meta.url), 'utf8');
function harness() {
  const messages = [];
  let Processor;
  const scope = { Float32Array, currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } },
    registerProcessor: (_, value) => { Processor = value; },
  };
  vm.runInNewContext(source, scope);
  return { scope, messages, processor: new Processor() };
}

test('signal tap preserves every output sample across complete and partial capture chunks', () => {
  const h = harness(), expected = [];
  for (let block = 0; block < 33; block++) {
    h.scope.currentFrame = block * 128;
    const left = Float32Array.from({ length: 128 }, (_, i) => Math.sin((block * 128 + i) / 20) * .3);
    const right = Float32Array.from(left, value => -value / 2);
    const output = [new Float32Array(128), new Float32Array(128)];
    h.processor.process([[left, right]], [output]);
    assert.deepEqual(output, [left, right]);
    for (let i = 0; i < 128; i++) expected.push(left[i], right[i]);
  }
  h.processor.port.onmessage({ data: { flush: true } });
  const chunks = h.messages.filter(m => m.pcm);
  assert.deepEqual(chunks.map(c => c.startFrame), [0, 4096]);
  assert.deepEqual(chunks.map(c => c.frames), [4096, 128]);
  assert.deepEqual(chunks.flatMap(c => [...new Float32Array(c.pcm)]), expected);
  assert.equal(h.messages.at(-1).done, true);
});

test('signal tap retains hardware-frame gaps instead of stitching unrelated sample boundaries', () => {
  const h = harness();
  for (const frame of [0, 384]) {
    h.scope.currentFrame = frame;
    h.processor.process([[new Float32Array(128).fill(.2), new Float32Array(128).fill(.1)]],
      [[new Float32Array(128), new Float32Array(128)]]);
  }
  h.processor.port.onmessage({ data: { flush: true } });
  assert.deepEqual(h.messages.filter(m => m.pcm).map(c => [c.startFrame, c.frames]), [[0, 128], [384, 128]]);
});
