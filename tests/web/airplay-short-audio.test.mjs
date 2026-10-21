// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaEngine } from '../../site/play/airplay-media.js';

const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

// The sink emits exactly the declared source samples, including a short final
// packet. Device time advances independently of callbacks; submitted != played.
function fixture({ sampleRate = 48000, frames = 48, origin = 100, packetFrames = 1024,
  metadataFrames = frames, beforeFirstStart = 0, video = false, videoFrames = metadataFrames } = {}) {
  let wall = 0, next = 0, context, delayed = false, held;
  const callbacks = new Map(), nodes = [], events = [], reads = { audio: 0, closed: 0 };
  const track = { canDecode: async () => true, isLive: async () => false };
  const picture = { canDecode: async () => true, isLive: async () => false,
    getPrimaryPairableAudioTrack: async () => track, getDecoderConfig: async () => null,
    getDisplayWidth: async () => 16, getDisplayHeight: async () => 9 };
  class Input {
    async getPrimaryVideoTrack() { return video ? picture : null; }
    async getPrimaryAudioTrack() { return track; }
    async getFirstTimestamp() { return origin; }
    async getDurationFromMetadata() { return origin + metadataFrames / sampleRate; }
    dispose() {}
  }
  class VideoSampleSink {
    async *samples() {
      yield { timestamp: origin, duration: videoFrames / sampleRate,
        codedWidth: 16, codedHeight: 9, displayWidth: 16, displayHeight: 9, close() {} };
    }
  }
  class AudioBufferSink {
    async *buffers(start) {
      try { for (let first = Math.max(0, Math.round((start - origin) * sampleRate)); first < frames; first += packetFrames) {
        reads.audio++;
        const length = Math.min(packetFrames, frames - first);
        yield { timestamp: origin + first / sampleRate, duration: length / sampleRate,
          buffer: { sampleRate, numberOfChannels: 1, length, duration: length / sampleRate,
            getChannelData: () => Float32Array.from({ length }, (_, index) => first + index + 1) } };
      } } finally { reads.closed++; }
    }
  }
  class Context {
    constructor(options) { this.sampleRate = options.sampleRate; this.currentTime = 0; this.state = 'suspended'; context = this; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBuffer(channels, length, rate) {
      const planes = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, sampleRate: rate, duration: length / rate,
        copyToChannel(data, channel) { planes[channel].set(data); }, getChannelData: channel => planes[channel] };
    }
    createBufferSource() {
      const owner = this;
      const node = { connect() {}, disconnect() {}, start(when, offset, duration) {
        if (!delayed) { delayed = true; owner.currentTime += beforeFirstStart; }
        this.startTime = Math.max(when, owner.currentTime);
        this.duration = duration;
      }, stop() { this.stopTime = owner.currentTime; } };
      nodes.push(node); return node;
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  const clear = () => { held?.close(); held = null; };
  const media = createMediaEngine(null, { library: { Input, AudioBufferSink, VideoSampleSink, UrlSource: class {}, ALL_FORMATS: [] },
    AudioContext: Context, presenter: { present(sample) { clear(); held = sample; }, clear, dispose: clear },
    now: () => wall, requestFrame: callback => { callbacks.set(++next, callback); return next; },
    cancelFrame: id => callbacks.delete(id) });
  for (const name of ['play', 'playing', 'pause', 'seeking', 'seeked', 'ended'])
    media.addEventListener(name, () => events.push(name));
  return { media, nodes, events, reads, context: () => context, flush,
    playedSamples() {
      return nodes.flatMap(node => {
        if (!Number.isFinite(node.startTime)) return [];
        const until = Math.min(context.currentTime, node.stopTime ?? Infinity, node.startTime + node.duration);
        // Each output sample starts at its lattice point. Native Web Audio
        // emits the last sample even when stop/duration falls inside its span.
        const count = Math.max(0, Math.min(node.buffer.length, Math.ceil((until - node.startTime) * sampleRate - 1e-6)));
        return [...node.buffer.getChannelData(0).subarray(0, count)];
      });
    },
    async tick(seconds = 0) {
      wall += seconds; if (context?.state === 'running') context.currentTime += seconds;
      const pending = callbacks.entries().next().value;
      if (pending) { callbacks.delete(pending[0]); pending[1](); }
      await flush();
    } };
}

for (const sampleRate of [44100, 48000]) {
  test(`short URL audio: ${sampleRate}Hz plays one sample and 1/2/3ms sources before ending`, async () => {
    for (const frames of [1, Math.round(sampleRate / 1000), Math.round(sampleRate * .002), Math.round(sampleRate * .003)]) {
      const h = fixture({ sampleRate, frames });
      try {
        await h.media.load('https://fixture.test/short-audio.mp4'); await flush(); await h.tick();
        assert.equal(h.media.ended, false, `${frames} samples cannot end during paused preparation`);
        const playing = h.media.play().then(() => h.events.push('play-resolved')); await flush(); await h.tick();
        assert.equal(h.events.includes('playing'), true, `${frames} samples must actually start`);
        await playing;
        assert.equal(h.media.ended, false, 'scheduling the source is not playback completion');
        await h.tick((frames - .25) / sampleRate);
        assert.equal(h.media.ended, false, 'the last sample cannot be cut off by the video EOF tolerance');
        await h.tick(.5 / sampleRate);
        assert.equal(h.media.ended, true); assert.equal(h.media.error, null);
        assert.deepEqual(h.playedSamples(), Array.from({ length: frames }, (_, index) => index + 1));
        assert.ok(h.events.indexOf('playing') < h.events.indexOf('play-resolved'));
        assert.ok(h.events.indexOf('play-resolved') < h.events.indexOf('ended'));
        assert.equal(h.events.filter(name => name === 'ended').length, 1);
      } finally { h.media.dispose(); }
    }
  });
}

test('URL EOF waits for the final source sample and the delayed native start clock', async () => {
  const h = fixture({ sampleRate: 48000, frames: 4801, beforeFirstStart: .04 });
  try {
    await h.media.load('https://fixture.test/tail.mp4'); await flush();
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    await h.tick(4800.75 / 48000);
    assert.equal(h.media.ended, false);
    assert.equal(h.playedSamples().length, 4801, 'the last sample starts before its duration has elapsed');
    await h.tick(.5 / 48000);
    assert.equal(h.media.ended, true); assert.equal(h.playedSamples().length, 4801);
  } finally { h.media.dispose(); }
});

test('paused last-sample seeks keep PCM for resume and exact-end seeks settle without replay', async () => {
  const h = fixture({ sampleRate: 48000, frames: 480 });
  try {
    await h.media.load('https://fixture.test/seek.mp4'); await flush();
    h.media.currentTime = h.media.duration - 1 / 48000; await flush(); await h.tick();
    assert.equal(h.media.seeking, false); assert.equal(h.media.ended, false);
    assert.equal(h.nodes.length, 0);
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    assert.equal(h.media.ended, false);
    await h.tick(2 / 48000); assert.equal(h.media.ended, true);
    assert.deepEqual(h.playedSamples(), [480]);
    h.media.currentTime = h.media.duration; await flush(); await h.tick();
    assert.equal(h.media.ended, true); assert.equal(h.media.seeking, false);
    assert.deepEqual(h.playedSamples(), [480], 'seeking exactly to end cannot replay old PCM');
  } finally { h.media.dispose(); }
});

test('the audio schedule excludes samples beyond the finite container duration', async () => {
  const h = fixture({ sampleRate: 48000, frames: 1024, metadataFrames: 48 });
  try {
    await h.media.load('https://fixture.test/padded.mp4'); await flush();
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    assert.equal(h.nodes.reduce((count, node) => count + node.buffer.length, 0), 48);
    await h.tick(49 / 48000);
    assert.equal(h.media.ended, true); assert.deepEqual(h.playedSamples(), Array.from({ length: 48 }, (_, index) => index + 1));
  } finally { h.media.dispose(); }
});

test('fractional container ends retain their last sample and do not wait for long decoder padding', async () => {
  for (const metadataFrames of [.5, 1.5, 47.5, 48.5]) {
    const h = fixture({ sampleRate: 48000, frames: 200000, metadataFrames });
    try {
      await h.media.load('https://fixture.test/fractional-end.mp4'); await flush();
      const playing = h.media.play(); await flush(); await h.tick(); await playing;
      assert.equal(h.nodes.reduce((count, node) => count + node.buffer.length, 0), Math.ceil(metadataFrames));
      assert.equal(h.reads.audio, 1, 'out-of-container padding cannot fill the lookahead queue');
      assert.equal(h.reads.closed, 1, 'the audio iterator is cancelled after finite coverage');
      await h.tick((metadataFrames + 1) / 48000);
      await h.tick();
      assert.equal(h.media.ended, true); assert.equal(h.media.error, null);
      assert.deepEqual(h.playedSamples(), Array.from({ length: Math.ceil(metadataFrames) }, (_, index) => index + 1));
    } finally { h.media.dispose(); }
  }
});

test('a seek excluding the final partial sample advances its empty tail without replay or deadlock', async () => {
  const h = fixture({ sampleRate: 48000, frames: 1024, metadataFrames: .5 });
  try {
    await h.media.load('https://fixture.test/fractional-seek.mp4'); await flush();
    h.media.currentTime = .25 / 48000; await flush(); await h.tick();
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    await h.tick(1 / 48000);
    assert.equal(h.media.ended, true); assert.equal(h.media.error, null);
    assert.deepEqual(h.playedSamples(), [], 'a sample starting before the seek target must not replay');
  } finally { h.media.dispose(); }
});

test('a suspended audio clock cannot finish a short source from wall time alone', async () => {
  const h = fixture();
  try {
    await h.media.load('https://fixture.test/suspended-tail.mp4'); await flush();
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    h.context().state = 'suspended'; await h.tick(.5);
    assert.equal(h.media.ended, false);
    h.context().state = 'running';
    const resuming = h.media.play(); await flush(); await h.tick(); await resuming;
    await h.tick(49 / 48000);
    assert.equal(h.media.ended, true); assert.deepEqual(h.playedSamples(), Array.from({ length: 48 }, (_, index) => index + 1));
  } finally { h.media.dispose(); }
});

test('mixed media preserves short audio tails and the remaining video clock', async () => {
  for (const [frames, videoFrames] of [[48, 480], [480, 48]]) {
    const h = fixture({ frames, metadataFrames: 480, video: true, videoFrames });
    try {
      await h.media.load('https://fixture.test/mixed-tail.mp4'); await flush();
      const playing = h.media.play(); await flush(); await h.tick(); await playing;
      await h.tick((frames - .25) / 48000);
      assert.equal(h.media.ended, false, 'neither a short track nor video tolerance can cut the last audio sample');
      await h.tick(481 / 48000);
      await h.tick();
      assert.equal(h.media.ended, true); assert.equal(h.media.error, null);
      assert.deepEqual(h.playedSamples(), Array.from({ length: frames }, (_, index) => index + 1));
    } finally { h.media.dispose(); }
  }
});
