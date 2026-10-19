// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { SoxrRuntime } from '../../site/play/streaming-resampler.js';

test('CarPlay guidance honors source anchors, reports impossible deadlines, and preserves an untimed utterance', async () => {
  const names = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let Processor;
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_, implementation) => { Processor = implementation; };
  const live = [];
  try {
    await import('../../site/play/audio-worklet.js?carplay-guidance');
    const calibration = new SoxrRuntime(), delayMs = calibration.filterDelay(48000, 48000);
    const make = outputLead => {
      const processor = new Processor(); live.push(processor);
      const post = data => processor.port.onmessage({ data });
      post({ calibration: { rate: 48000, outputRate: 48000, delayMs },
        clock: { version: 2, generation: 1, serverOriginMs: 800000, localOriginMs: 1000, rate: 1, state: 'tracking' },
        contextAnchor: { contextTimeMs: 0, localTimeMs: 1000 + outputLead }, localTimeOriginMs: 0 });
      const packet = (presentationMs, sequence = 0) => post({ type: 1, mode: 'carplay', semanticType: 1,
        epoch: 1, generation: 1, channels: 1, rate: 48000, sequence, flags: 0,
        presentationMs, arrivalLocalTimeMs: sequence * 20, pcm: new Int16Array(960).fill(1000).buffer });
      return { processor, packet };
    };
    const anchored = make(120); anchored.packet(800000);
    const timeline = anchored.processor.timelines.get(1);
    assert.equal(timeline.arrivalPlayback, false);
    assert.equal(anchored.processor.targetTime(timeline, 0), 799980);
    assert.equal(timeline.sourceAnchorMs, 800000);
    assert.equal(timeline.sourceStartupDelayMs, 140);
    assert.equal(timeline.reference(0).senderTimingState, 'mapped-presentation');
    assert.equal(timeline.reference(0).senderRelativePolicyCeilingMs, 300);
    const impossible = make(400); impossible.packet(800000);
    const late = impossible.processor.timelines.get(1);
    assert.equal(impossible.processor.targetTime(late, 0), null);
    assert.equal(late.reason, 'sender-deadline'); assert.ok(late.senderCeilingViolations > 0);
    const untimed = make(120); untimed.packet(NaN);
    const fallback = untimed.processor.timelines.get(1), first = fallback.queue[0];
    assert.equal(fallback.arrivalPlayback, true);
    assert.equal(fallback.reference(0).senderTimingState, 'arrival-anchored-unverified');
    assert.equal(fallback.reference(0).senderRelativePolicyCeilingMs, null);
    untimed.packet(800020, 1);
    assert.equal(untimed.processor.timelines.get(1), fallback, 'a real anchor does not reset the utterance');
    assert.equal(fallback.queue[0], first, 'unplayed first samples remain queued');
    assert.equal(fallback.sourceAnchorMs, 800000);
    assert.equal(fallback.arrivalPlayback, false); assert.equal(fallback.synchronized, true);
  } finally {
    for (const processor of live) processor.port.onmessage({ data: { dispose: true } });
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
