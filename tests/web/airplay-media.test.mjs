import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaEngine } from '../../site/play/airplay-media.js';
import { intersectMediaRanges, mediaTimeRanges, mergeMediaRanges, videoQueueFull } from '../../site/play/airplay-media-state.js';

const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

function fixture({ audio = true, video = true, live = false, timestampOrigin = 100, duration = 20, deferVideo = null,
  missingFrameDuration = false, onClock = null } = {}) {
  let wall = 0, next = 0, reads = { video: 0, audio: 0 }, audioContexts = 0;
  const selection = { primaryAudio: 0, pairableAudio: 0 };
  const callbacks = new Map(), inputs = [], samples = [], pictures = [], nodes = [], events = [];
  const videoTrack = { canDecode: async () => true, isLive: async () => live,
    getDisplayWidth: async () => 16, getDisplayHeight: async () => 9,
    getPrimaryPairableAudioTrack: async () => { selection.pairableAudio++; return audio ? audioTrack : null; } };
  const audioTrack = { canDecode: async () => true, isLive: async () => live };
  class Input {
    constructor(options) { this.options = options; this.disposed = false; inputs.push(this); }
    getPrimaryVideoTrack() { return Promise.resolve(video ? videoTrack : null); }
    getPrimaryAudioTrack() { selection.primaryAudio++; return Promise.resolve(audio ? audioTrack : null); }
    getFirstTimestamp() { return Promise.resolve(timestampOrigin); }
    getDurationFromMetadata() { return Promise.resolve(timestampOrigin + duration); }
    dispose() { this.disposed = true; }
  }
  const sample = time => {
    const result = { timestamp: time, duration: missingFrameDuration ? 0 : 0.1, displayWidth: 16, displayHeight: 9,
      codedWidth: 16, codedHeight: 9, closed: 0, close() { this.closed++; } };
    samples.push(result); return result;
  };
  class VideoSampleSink {
    samples(start) {
      let index = Math.floor((start - timestampOrigin) * 10 + 0.00001), stopped = false;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (stopped || index >= duration * 10) return { done: true };
          reads.video++;
          const value = sample(timestampOrigin + index++ / 10);
          if (deferVideo && reads.video === 1) await deferVideo;
          return { value, done: false };
        },
        async return() { stopped = true; return { done: true }; },
      };
    }
  }
  class AudioBufferSink {
    buffers(start) {
      let index = Math.floor((start - timestampOrigin) * 10 + 0.00001), stopped = false;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (stopped || index >= duration * 10) return { done: true };
          reads.audio++;
          const timestamp = timestampOrigin + index++ / 10;
          return { done: false, value: { timestamp, duration: 0.1, buffer: {
            sampleRate: 1000, numberOfChannels: 2, length: 100, duration: 0.1,
            getChannelData: () => new Float32Array(100).fill(0.1),
          } } };
        },
        async return() { stopped = true; return { done: true }; },
      };
    }
  }
  class AudioContext {
    constructor() { audioContexts++; this.currentTime = 0; this.state = 'suspended'; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBuffer(channels, length, sampleRate) { return { channels, length, sampleRate, copyToChannel() {} }; }
    createBufferSource() {
      const node = { connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } };
      nodes.push(node); return node;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  let contextInstance;
  const media = createMediaEngine(null, {
    library: { Input, UrlSource: class { constructor(src, options) { this.src = src; this.options = options; } },
      VideoSampleSink, AudioBufferSink, ALL_FORMATS: [], SoundTouchCore: {} },
    AudioContext: class extends AudioContext { constructor() { super(); contextInstance = this; } },
    onClock,
    now: () => wall, requestFrame: callback => { callbacks.set(++next, callback); return next; },
    cancelFrame: id => callbacks.delete(id),
    presenter: { present(value) { pictures.at(-1)?.close(); pictures.push(value); }, clear() { pictures.at(-1)?.close(); pictures.length = 0; },
      dispose() { pictures.at(-1)?.close(); } },
  });
  for (const type of ['playing', 'pause', 'waiting', 'seeked', 'loadeddata', 'error']) media.addEventListener(type, () => events.push(type));
  return { media, reads, inputs, samples, pictures, nodes, events, selection, audioContexts: () => audioContexts,
    async tick(advance = 0) {
      wall += advance; if (contextInstance) contextInstance.currentTime += advance;
      const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(); await flush();
    } };
}

test('decoded ranges intersect both tracks and preserve real gaps', () => {
  const video = mergeMediaRanges([[0, 1], [1.001, 2], [3, 4]]);
  assert.deepEqual(video, [[0, 2], [3, 4]]);
  const intersection = intersectMediaRanges(video, [[0.5, 1.5], [2.5, 3.5]]);
  assert.deepEqual(intersection, [[0.5, 1.5], [3, 3.5]]);
  const ranges = mediaTimeRanges(intersection);
  assert.equal(ranges.start(0), 0.5); assert.equal(ranges.end(1), 3.5);
  assert.throws(() => ranges.start(2), { name: 'IndexSizeError' });
  assert.equal(videoQueueFull([{ end: 0.1, bytes: 97 * 1024 * 1024 }], 0), true);
  assert.equal(videoQueueFull([{ end: 10, bytes: 1 }], 0), true);
});

test('paused loading normalizes timestamps and bounds both decoded queues', async () => {
  const h = fixture();
  await h.media.load('https://example.test/movie.mp4', 'video/mp4'); await flush();
  assert.equal(h.media.duration, 20); assert.equal(h.media.timestampOrigin, 100); assert.equal(h.media.currentTime, 0);
  assert.equal(h.media.paused, true); assert.equal(h.audioContexts(), 0);
  assert.ok(h.reads.video <= 22); assert.ok(h.reads.audio <= 32);
  assert.equal(h.media.buffered.start(0), 0); assert.ok(h.media.buffered.end(0) <= 2.2);
  assert.equal(h.inputs[0].options.formatOptions.hls.offsetTimestampsByDateTime, false);
  h.media.dispose();
  assert.ok(h.samples.every(value => value.closed === 1));
});

test('audio clock leads, a stall cannot skip unscheduled audio, and paused seek displays the target', async () => {
  const h = fixture(); await h.media.load('https://example.test/movie.mp4'); await flush();
  const playing = h.media.play(); await flush(); await h.tick(); await playing;
  assert.ok(h.nodes.length > 0); await h.tick(0.1);
  assert.ok(Math.abs(h.media.currentTime - 0.1) < 0.002);
  await h.tick(2);
  assert.ok(h.media.currentTime <= 0.61, 'Web Audio played only the scheduled half second during the main-thread stall');
  h.media.currentTime = 8; h.media.pause(); await flush();
  assert.equal(h.media.paused, true); assert.equal(h.media.seeking, false);
  assert.ok(Math.abs(h.pictures.at(-1).timestamp - 108) < 0.002);
  assert.equal(h.media.currentTime, 8); assert.ok(h.events.includes('seeked'));
  assert.equal(h.inputs.length, 1, 'seek and pause retain source metadata/cache');
  h.media.dispose(); assert.ok(h.samples.every(value => value.closed === 1));
});

test('source replacement closes a late decoded frame without drawing or changing the new source', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ deferVideo: pending });
  const old = h.media.load('https://example.test/old.mp4'); await flush();
  const oldResult = assert.rejects(old, { name: 'AbortError' });
  await h.media.load('https://example.test/new.mp4'); await flush();
  const picture = h.pictures.at(-1); release(); await flush(); await oldResult;
  assert.equal(h.samples[0].closed, 1); assert.equal(h.pictures.at(-1), picture);
  assert.equal(h.inputs[0].disposed, true); assert.equal(h.media.error, null);
  h.media.dispose();
});

test('silent videos advance and end without creating an AudioContext', async () => {
  const h = fixture({ audio: false, duration: 0.3 }); await h.media.load('https://example.test/silent.mp4'); await flush();
  const playing = h.media.play(); await flush(); await h.tick(); await playing;
  assert.equal(h.audioContexts(), 0);
  await h.tick(0.15); assert.ok(Math.abs(h.media.currentTime - 0.15) < 0.002);
  await h.tick(0.15); assert.equal(h.media.ended, true); assert.equal(h.media.paused, true);
  assert.ok(Math.abs(h.media.currentTime - 0.3) < 0.000001); h.media.dispose();
});

test('invalid rates fail without silently resampling or changing pitch', async () => {
  const h = fixture();
  for (const rate of [0, NaN, 8]) assert.throws(() => { h.media.playbackRate = rate; }, { name: 'NotSupportedError' });
  assert.equal(h.media.playbackRate, 1);
  h.media.dispose();
});

test('live pause/resume retains the source timeline and cancels the old decoded queues', async () => {
  const h = fixture({ live: true }); await h.media.load('https://example.test/live.m3u8'); await flush();
  assert.equal(h.media.duration, Infinity);
  const playing = h.media.play(); await flush(); await h.tick(); await playing; await h.tick(0.2);
  h.media.pause(); const stoppedAt = h.media.currentTime;
  assert.equal(h.inputs[0].disposed, false, 'the manifest keeps its original sliding-window origin');
  const resuming = h.media.play(); await flush(); await h.tick(); await resuming;
  assert.equal(h.inputs.length, 1); assert.equal(h.media.timestampOrigin, 100);
  assert.equal(h.selection.pairableAudio, 1, 'variant selection remains stable across resume');
  assert.equal(h.selection.primaryAudio, 0, 'video variants use their matching audio rather than an independent primary');
  assert.ok(Math.abs(h.media.currentTime - stoppedAt) < 0.002);
  h.media.dispose(); assert.equal(h.inputs[0].disposed, true);
  assert.ok(h.samples.every(value => value.closed === 1));
});

test('missing frame durations use the next PTS instead of creating false buffer holes', async () => {
  const h = fixture({ audio: false, missingFrameDuration: true });
  await h.media.load('https://example.test/movie.mp4'); await flush();
  assert.equal(h.media.buffered.length, 1); assert.ok(h.media.buffered.end(0) >= 2);
  h.media.dispose();
});

test('caption clock follows every presentation tick without waiting for the throttled timeupdate event', async () => {
  const observed = [];
  const h = fixture({ audio: false, duration: 0.3, onClock(time) {
    observed.push(time); if (time > 0.07 && time < 0.09) throw new Error('A caption observer failed.');
  } });
  await h.media.load('https://example.test/movie.mp4'); await flush();
  const playing = h.media.play(); await flush(); await h.tick(); await playing;
  for (const delta of [0.04, 0.04, 0.04]) await h.tick(delta);
  for (const value of [0.04, 0.08, 0.12]) assert.ok(observed.some(time => Math.abs(time - value) < 0.001));
  assert.equal(h.media.error, null); h.media.pause();
  assert.ok(Math.abs(observed.at(-1) - h.media.currentTime) < 0.001);
  h.media.dispose();
});
