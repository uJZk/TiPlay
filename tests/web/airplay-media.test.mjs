import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SoundTouchCore } from '../../site/play/vendor/mediabunny/mediabunny.min.js';
import { createMediaEngine } from '../../site/play/airplay-media.js';
import { airplayDiagnostic, createAirPlayDiagnostics } from '../../site/play/airplay-diagnostics.js';
import { intersectMediaRanges, mediaTimeRanges, mergeMediaRanges, videoQueueFull } from '../../site/play/airplay-media-state.js';

const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

function fixture({ audio = true, video = true, live = false, timestampOrigin = 100, duration = 20, deferVideo = null,
  missingFrameDuration = false, onClock = null, alternateAudio = false, expiredLiveWindow = false, sampleColor = null,
  deferVideoAt = 1, frameWidth = 16, frameHeight = 9, videoFps = 10, videoGapAt = Infinity, videoGap = 0,
  surfacePool = Infinity, resumeGate = null, resumeState = 'running', videoCadence = null,
  audioSampleRate = 1000, audioSamplesPerPacket = 100, audioStart = 0, audioDuration = duration, videoDuration = duration,
  deferAudio = null, deferAudioAt = 1, videoErrorAt = Infinity, videoError = null,
  videoConfig = null, VideoDecoder = undefined } = {}) {
  let wall = 0, next = 0, reads = { video: 0, audio: 0 }, audioContexts = 0;
  const selection = { primaryAudio: 0, pairableAudio: 0 };
  const durations = videoCadence?.durationTicks.map(ticks => ticks / videoCadence.timescale);
  const prefix = durations ? [0] : null;
  for (const duration of durations || []) prefix.push(prefix.at(-1) + duration);
  const videoTime = index => durations ? Math.floor(index / durations.length) * prefix.at(-1) + prefix[index % durations.length] : index / videoFps;
  const videoSampleDuration = index => durations ? durations[index % durations.length] : 1 / videoFps;
  const audioPeriod = audioSamplesPerPacket / audioSampleRate;
  const callbacks = new Map(), inputs = [], samples = [], pictures = [], nodes = [], events = [], sinkOptions = [];
  const videoTrack = { canDecode: async () => true, isLive: async () => live,
    getDecoderConfig: async () => videoConfig,
    getDisplayWidth: async () => frameWidth, getDisplayHeight: async () => frameHeight,
    getPrimaryPairableAudioTrack: async () => { selection.pairableAudio++; return audio ? audioTrack : null; } };
  const audioTrack = { canDecode: async () => true, isLive: async () => live };
  const otherAudio = { canDecode: async () => true, isLive: async () => live, getName: async () => '中文', getLanguageCode: async () => 'zho' };
  const decodedAudio = [], surfaceWaiters = new Set();
  const wakeSurfaces = () => { for (const wake of surfaceWaiters) wake(); surfaceWaiters.clear(); };
  if (alternateAudio) videoTrack.getPairableAudioTracks = async () => [audioTrack, otherAudio];
  class Input {
    constructor(options) { this.options = options; this.disposed = false; inputs.push(this); }
    getPrimaryVideoTrack() { return Promise.resolve(video ? videoTrack : null); }
    getPrimaryAudioTrack() { selection.primaryAudio++; return Promise.resolve(audio ? audioTrack : null); }
    getFirstTimestamp() { return Promise.resolve(timestampOrigin); }
    getDurationFromMetadata() { return Promise.resolve(timestampOrigin + duration); }
    dispose() { this.disposed = true; }
  }
  const sample = (time, duration = 1 / videoFps) => {
    const result = { timestamp: time, duration: missingFrameDuration ? 0 : duration, displayWidth: frameWidth, displayHeight: frameHeight,
      colorSpace: sampleColor,
      codedWidth: frameWidth, codedHeight: frameHeight, closed: 0, close() { this.closed++; wakeSurfaces(); } };
    samples.push(result); return result;
  };
  class VideoSampleSink {
    constructor(_track, options) { sinkOptions.push(options); }
    samples(start) {
      let index = 0, stopped = false;
      while (videoTime(index + 1) <= start - timestampOrigin + 0.00001) index++;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (stopped || videoTime(index) >= videoDuration - 0.000001) return { done: true };
          while (!stopped && samples.filter(value => !value.closed).length >= surfacePool) await new Promise(resolve => surfaceWaiters.add(resolve));
          if (stopped || videoTime(index) >= videoDuration - 0.000001) return { done: true };
          reads.video++;
          if (reads.video === videoErrorAt) throw videoError;
          if (expiredLiveWindow && inputs.length === 1 && reads.video === 25) throw new TypeError('HTTP 404: expired live segment');
          const value = sample(timestampOrigin + videoTime(index) + (index >= videoGapAt ? videoGap : 0), videoSampleDuration(index)); index++;
          if (deferVideo && reads.video === deferVideoAt) await deferVideo;
          return { value, done: false };
        },
        async return() { stopped = true; wakeSurfaces(); return { done: true }; },
      };
    }
  }
  class AudioBufferSink {
    constructor(track) { decodedAudio.push(track); }
    buffers(start) {
      let index = Math.max(0, Math.floor((start - timestampOrigin - audioStart) / audioPeriod + 0.00001)), stopped = false;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (stopped || index * audioPeriod >= audioDuration - 0.000001) return { done: true };
          reads.audio++;
          if (deferAudio && reads.audio === deferAudioAt) await deferAudio;
          const timestamp = timestampOrigin + audioStart + index++ * audioPeriod;
          return { done: false, value: { timestamp, duration: audioPeriod, buffer: {
            sampleRate: audioSampleRate, numberOfChannels: 2, length: audioSamplesPerPacket, duration: audioPeriod,
            getChannelData: () => new Float32Array(audioSamplesPerPacket).fill(0.1),
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
    async resume() { if (resumeGate) await resumeGate; this.state = resumeState; }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  let contextInstance, sampleCloseObserver = () => {};
  const closePresented = sample => { if (sample) { sample.close(); sampleCloseObserver(sample); } };
  const media = createMediaEngine(null, {
    library: { Input, UrlSource: class { constructor(src, options) { this.src = src; this.options = options; } },
      VideoSampleSink, AudioBufferSink, ALL_FORMATS: [], SoundTouchCore },
    AudioContext: class extends AudioContext { constructor() { super(); contextInstance = this; } }, VideoDecoder,
    onClock,
    now: () => wall, requestFrame: callback => { callbacks.set(++next, callback); return next; },
    cancelFrame: id => callbacks.delete(id),
    presenter: { setSampleCloseObserver(callback) { sampleCloseObserver = callback; },
      present(value) { closePresented(pictures.at(-1)); pictures.push(value); }, clear() { closePresented(pictures.at(-1)); pictures.length = 0; },
      dispose() { closePresented(pictures.at(-1)); } },
  });
  for (const type of ['playing', 'pause', 'waiting', 'seeked', 'loadeddata', 'error', 'resync', 'ended']) media.addEventListener(type, () => events.push(type));
  return { media, reads, inputs, samples, pictures, nodes, events, selection, decodedAudio, otherAudio, sinkOptions, audioContexts: () => audioContexts,
    context: () => contextInstance,
    async tick(advance = 0) {
      wall += advance; if (contextInstance?.state === 'running') contextInstance.currentTime += advance;
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

test('alternate audio selection actually changes the decoder at the shared clock without reopening its input', async () => {
  const h = fixture({ alternateAudio: true });
  await h.media.load('https://example.test/master.m3u8'); await flush();
  assert.equal(h.media.audioTracks.length, 2);
  h.media.currentTime = 5; await flush();
  assert.equal(h.media.selectAudioTrack('unknown'), false);
  assert.equal(h.media.selectAudioTrack('1'), true); await flush();
  assert.equal(h.decodedAudio.at(-1), h.otherAudio);
  assert.equal(h.media.currentTime, 5); assert.equal(h.inputs.length, 1);
  assert.equal(h.media.audioTracks.getTrackById('1').enabled, true); h.media.dispose();
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

test('late decoded HDR metadata closes its frame and fails before presenting wrong colors', async () => {
  const h = fixture({ sampleColor: { transfer: 'pq', primaries: 'bt2020' } });
  await assert.rejects(h.media.load('https://example.test/undeclared-hdr.mp4'), { name: 'NotSupportedError' });
  assert.equal(h.media.error.name, 'NotSupportedError'); assert.match(h.media.error.message, /SDR/);
  assert.equal(h.pictures.length, 0); assert.ok(h.samples.every(sample => sample.closed === 1)); h.media.dispose();
});

for (const videoErrorAt of [1, 6]) test(`decoder failure on sample ${videoErrorAt} preserves its cause and reconciles actual cleanup`, async () => {
  const cause = new DOMException('Decoder failed for https://private.example/media?token=private-token', 'EncodingError');
  const config = { codec: 'av01.0.08M.08', codedWidth: 1920, codedHeight: 1080,
    description: new Uint8Array([9, 8, 7, 6]) };
  const probes = [];
  const h = fixture({ audio: false, frameWidth: 1920, frameHeight: 1080, videoFps: 30,
    videoErrorAt, videoError: cause, videoConfig: config,
    VideoDecoder: { async isConfigSupported(query) { probes.push(query); return { supported: true }; } } });
  const entries = [];
  const diagnostics = createAirPlayDiagnostics(entry => entries.push(entry), {
    state: () => ({ id: 1, revision: 0 }), media: () => h.media,
  });
  diagnostics.monitor(h.media, new EventTarget());
  let failure;
  h.media.addEventListener('error', event => { failure = event; });
  try {
    const loading = h.media.load('https://private.example/media?token=private-token');
    if (videoErrorAt === 1) await assert.rejects(loading, error => error === cause);
    else await loading;
    await flush();
    assert.equal(h.media.error.name, 'EncodingError'); assert.equal(failure.error, cause);
    const before = failure.playbackDiagnostics, after = failure.cleanupDiagnostics;
    assert.equal(before.codec, config.codec);
    assert.equal(before.codedWidth, config.codedWidth); assert.equal(before.codedHeight, config.codedHeight);
    assert.equal(before.displayWidth, 1920); assert.equal(before.displayHeight, 1080);
    assert.equal(before.requestedHardwareAcceleration, h.sinkOptions[0].hardwareAcceleration);
    assert.equal(before.requestedHardwareAcceleration, 'prefer-hardware');
    assert.equal(probes[0].hardwareAcceleration, 'prefer-hardware');
    assert.equal(before.hardwareSupportProbe, 'supported', 'the configuration probe is evidence of support, not actual hardware use');
    assert.equal(before.waitReason, 'error'); assert.equal(after.waitReason, 'error');
    const received = videoErrorAt - 1, retained = received ? 1 : 0;
    assert.equal(h.samples.length, received, 'the fake sink supplies an independent received-sample oracle');
    assert.equal(before.samplesReceived, received); assert.equal(before.samplesClosed, 0);
    assert.equal(before.videoFrames, Math.max(0, received - retained));
    assert.equal(before.videoOwnedFrames, received);
    assert.equal(before.videoOwnedBytes, received * 1920 * 1080 * 4);
    assert.equal(after.videoFrames, 0);
    assert.equal(after.samplesClosed, h.samples.filter(sample => sample.closed === 1).length);
    assert.equal(after.samplesClosed, received - retained);
    assert.equal(after.videoOwnedFrames, h.samples.filter(sample => !sample.closed).length);
    assert.equal(after.videoOwnedFrames, retained, 'the last Canvas picture stays owned until its real release');
    assert.equal(after.videoOwnedBytes, retained * 1920 * 1080 * 4);
    assert.equal(Object.isFrozen(before), true); assert.equal(Object.isFrozen(after), true);
    const edge = entries.findIndex(entry => entry.event === 'error');
    assert.ok(edge >= 0); assert.equal(entries[edge].errorName, 'EncodingError');
    assert.deepEqual(entries[edge].engine, before, 'the real monitor preserves the pre-cleanup failure evidence');
    assert.equal(entries[edge + 1].event, 'engine-state');
    assert.deepEqual(entries[edge + 1].engine, after, 'the adjacent terminal snapshot reports actual cleanup');
    assert.equal(JSON.stringify(entries).includes('private.example'), false);
    assert.equal(JSON.stringify(entries).includes('private-token'), false);
    assert.equal('description' in before, false); assert.equal('description' in after, false);
    h.media.dispose(); await flush();
    assert.ok(h.samples.every(sample => sample.closed === 1));
    assert.equal(h.media.getPlaybackDiagnostics().samplesClosed, received);
    assert.equal(h.media.getPlaybackDiagnostics().videoOwnedFrames, 0);
    assert.equal(after.samplesClosed, received - retained, 'the immutable cleanup snapshot cannot retroactively claim later releases');
  } finally { diagnostics.dispose(); h.media.dispose(); }
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

test('an expired live window refreshes its source once and preserves playing intent', async () => {
  const h = fixture({ live: true, expiredLiveWindow: true, audio: false });
  await h.media.load('https://example.test/live.m3u8'); await flush();
  const playing = h.media.play(); await flush(); await h.tick(); await playing;
  for (let i = 0; i < 8 && !h.events.includes('resync'); i++) await h.tick(0.1);
  assert.ok(h.events.includes('resync')); assert.equal(h.inputs.length, 2);
  assert.equal(h.inputs[0].disposed, true); assert.equal(h.media.paused, false); assert.equal(h.media.error, null);
  h.media.dispose();
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

test('casting waits for useful startup coverage instead of playing every short network burst', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ deferVideo: pending, deferVideoAt: 3 });
  await h.media.load('https://example.test/movie.mp4'); await flush();
  const playing = h.media.play(); await flush(); await h.tick();
  assert.equal(h.media.currentTime, 0); assert.equal(h.nodes.length, 0);
  assert.equal(h.events.includes('playing'), false, 'two decoded frames do not repeatedly start and stall a cast');
  release(); await flush(); await h.tick(); await playing;
  assert.equal(h.events.includes('playing'), true); assert.ok(h.nodes.length > 0);
  h.media.dispose(); await flush(); assert.ok(h.samples.every(value => value.closed === 1));
});

test('casting starts within its decoded-surface budget when a high-resolution queue cannot reach the time watermark', async () => {
  const h = fixture({ frameWidth: 3840, frameHeight: 2160 });
  await h.media.load('https://example.test/movie.mp4'); await flush();
  const applicationBytes = h.samples.filter(sample => !sample.closed)
    .reduce((bytes, sample) => bytes + sample.codedWidth * sample.codedHeight * 4, 0);
  assert.ok(applicationBytes <= 96 * 1024 * 1024, 'displayed, queued and pending application surfaces share the declared byte budget');
  const playing = h.media.play(); await flush(); await h.tick(); await playing;
  assert.ok(h.events.includes('playing'), 'bounded GPU memory cannot deadlock startup');
  h.media.dispose(); await flush(); assert.ok(h.samples.every(value => value.closed === 1));
});

test('cast regression: startup below the watermark remains visibly waiting despite having future data', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ deferVideo: pending, deferVideoAt: 3 });
  try {
    await h.media.load('https://fixture.test/startup.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush(); await h.tick();
    assert.equal(h.media.currentTime, 0);
    assert.equal(h.events.includes('playing'), false);
    assert.ok(h.events.includes('waiting'), 'future data below startup coverage must not hide the actual wait');
  } finally { release(); h.media.dispose(); await flush(); }
});

test('cast regression: a finite decoder surface pool cannot deadlock startup below the explicit queue cap', async () => {
  const h = fixture({ frameWidth: 1920, frameHeight: 1080, videoFps: 60, surfacePool: 8 });
  try {
    await h.media.load('https://fixture.test/pool.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush();
    for (let i = 0; i < 180; i++) await h.tick(1 / 60);
    assert.equal(h.media.error, null);
    assert.ok(h.media.currentTime > 1, 'available media must advance even when releasing a displayed surface is needed to decode more');
    assert.ok(h.samples.filter(sample => !sample.closed).length <= 8, 'progress must not allocate beyond the decoder pool');
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: a known next video PTS keeps the held picture playable across a valid timestamp gap', async () => {
  const h = fixture({ videoGapAt: 5, videoGap: 0.1 });
  try {
    await h.media.load('https://fixture.test/gap.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush(); await h.tick();
    for (let i = 0; i < 30; i++) await h.tick(0.1);
    assert.equal(h.media.error, null);
    assert.ok(h.media.currentTime > 2, 'continuous audio plus a held picture must not stop forever at 500ms');
    assert.ok(h.pictures.some(sample => sample.timestamp > 101), 'video after the timestamp gap eventually reaches the presenter');
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: pausing cancels a play attempt while AudioContext.resume remains pending', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ resumeGate: pending });
  try {
    await h.media.load('https://fixture.test/audio-unlock.mp4'); await flush();
    let rejected = false;
    const playing = h.media.play(); void playing.catch(error => { rejected = error.name === 'AbortError'; });
    await flush(); h.media.pause(); await flush();
    assert.equal(rejected, true, 'a user pause must settle play even if the browser never resumes its context');
    assert.equal(h.nodes.length, 0);
  } finally { release(); h.media.dispose(); await flush(); }
});

const capturedCadences = JSON.parse(readFileSync(new URL('./fixtures/airplay-cast-cadence.json', import.meta.url))).cases;
for (const [name, cadence] of Object.entries(capturedCadences)) {
  for (const surfacePool of [6, 12]) test(`cast regression: ${name} cadence advances with a ${surfacePool}-sample decoder pool`, async () => {
    const h = fixture({ videoCadence: cadence, frameWidth: cadence.width, frameHeight: cadence.height,
      audioSampleRate: cadence.audioSampleRate, audioSamplesPerPacket: cadence.audioSamplesPerPacket, surfacePool, duration: 5 });
    try {
      await h.media.load('https://fixture.test/cadence.mp4'); await flush();
      const playing = h.media.play(); void playing.catch(() => {}); await flush();
      let firstProgress = null, elapsed = 0;
      for (let i = 0; i < 240 && !h.media.ended; i++) {
        await h.tick(1 / 60); elapsed += 1 / 60;
        const position = h.media.currentTime;
        if (!firstProgress && position > 0) firstProgress = { elapsed, position };
      }
      assert.equal(h.media.error, null);
      assert.ok(h.media.currentTime > 2, `available ${name} input must advance, not only report ready`);
      const expected = Math.min(5, firstProgress.position + elapsed - firstProgress.elapsed);
      const tolerance = 2 / 60 + cadence.audioSamplesPerPacket / cadence.audioSampleRate;
      assert.ok(Math.abs(h.media.currentTime - expected) <= tolerance,
        'after startup, complete available input follows the independent wall clock without repeated buffering');
      const firstPlaying = h.events.indexOf('playing');
      assert.equal(h.events.slice(firstPlaying).includes('waiting'), false);
      assert.ok(h.samples.filter(sample => !sample.closed).length <= surfacePool);
    } finally { h.media.dispose(); await flush(); }
  });
}

for (const blockedTrack of ['audio', 'video']) test(`cast regression: a saturated other track cannot hide ${blockedTrack} startup starvation`, async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture(blockedTrack === 'audio'
    ? { frameWidth: 3840, frameHeight: 2160, deferAudio: pending, deferAudioAt: 3 }
    : { deferVideo: pending, deferVideoAt: 3 });
  try {
    await h.media.load('https://fixture.test/independent-tracks.mp4'); await flush();
    let resolved = false;
    const playing = h.media.play().then(() => { resolved = true; }); void playing.catch(() => {});
    await flush(); await h.tick(0.2);
    assert.equal(resolved, false); assert.equal(h.media.currentTime, 0);
    assert.equal(h.media.buffering, true);
    const diagnostics = h.media.getPlaybackDiagnostics();
    assert.equal(diagnostics.running, false); assert.equal(diagnostics.intentPlaying, true);
    assert.equal(diagnostics.limitingTrack, blockedTrack);
    assert.ok(diagnostics.playableEnd < 0.3);
    const event = airplayDiagnostic('engine-state', { id: 1, revision: 1 }, { media: h.media });
    assert.equal(event.engine.running, false); assert.equal(event.engine.limitingTrack, blockedTrack);
    assert.equal(event.engine.waitReason, diagnostics.waitReason);
    assert.equal(Object.values(event.engine).every(value => ['number', 'string', 'boolean'].includes(typeof value)), true);
    release(); await flush();
    for (let i = 0; i < 120 && !resolved; i++) await h.tick(1 / 60);
    assert.equal(resolved, true, 'releasing the real bottleneck allows playback without replacing the source');
    assert.equal(h.inputs.length, 1);
  } finally { release(); h.media.dispose(); await flush(); }
});

for (const action of ['replace', 'dispose']) test(`cast regression: ${action} settles an abandoned AudioContext.resume play attempt`, async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ resumeGate: pending });
  try {
    await h.media.load('https://fixture.test/audio-unlock.mp4'); await flush();
    let reason = null;
    const playing = h.media.play(); void playing.catch(error => { reason = error.name; }); await flush();
    const pendingDiagnostic = airplayDiagnostic('engine-state', { id: 1, revision: 1 }, { media: h.media });
    assert.equal(pendingDiagnostic.engine.resumePending, true);
    assert.equal(pendingDiagnostic.engine.waitReason, 'audio-context-resume');
    assert.equal(pendingDiagnostic.engine.contextState, 'suspended');
    if (action === 'replace') await h.media.load('https://fixture.test/new.mp4');
    else h.media.dispose();
    await flush();
    assert.equal(reason, 'AbortError', 'the browser resume promise must not retain a retired play operation');
    assert.equal(h.nodes.length, 0);
  } finally { release(); h.media.dispose(); await flush(); }
});

test('cast regression: a suspended context remains a diagnosed wait until it actually runs', async () => {
  const h = fixture({ resumeState: 'suspended' });
  try {
    await h.media.load('https://fixture.test/context-state.mp4'); await flush();
    let resolved = false;
    const playing = h.media.play().then(() => { resolved = true; }); void playing.catch(() => {});
    await flush(); await h.tick(0.5);
    assert.equal(resolved, false); assert.equal(h.media.currentTime, 0); assert.equal(h.nodes.length, 0);
    assert.equal(h.media.buffering, true);
    const event = airplayDiagnostic('engine-state', { id: 1, revision: 1 }, { media: h.media });
    assert.equal(event.engine.contextState, 'suspended'); assert.equal(event.engine.waitReason, 'audio-context-suspended');
    assert.equal(event.engine.running, false);
    h.context().state = 'running'; await h.tick(); await playing;
    await h.tick(0.1); assert.ok(h.media.currentTime >= 0.09);
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: an interrupted context freezes and resumes the same source without false progress', async () => {
  const h = fixture();
  try {
    await h.media.load('https://fixture.test/context-interruption.mp4'); await flush();
    const playing = h.media.play(); await flush(); await h.tick(); await playing; await h.tick(0.1);
    h.context().state = 'interrupted'; await h.tick(0.2); const stopped = h.media.currentTime;
    for (let i = 0; i < 10; i++) await h.tick(0.1);
    assert.equal(h.media.currentTime, stopped); assert.equal(h.media.buffering, true);
    const event = airplayDiagnostic('engine-state', { id: 1, revision: 1 }, { media: h.media });
    assert.equal(event.engine.contextState, 'interrupted'); assert.equal(event.engine.running, false);
    h.context().state = 'running';
    for (let i = 0; i < 20; i++) await h.tick(0.05);
    assert.ok(h.media.currentTime > stopped + 0.5); assert.equal(h.inputs.length, 1);
  } finally { h.media.dispose(); await flush(); }
});

for (const [name, settings] of [
  ['short AV', { duration: 0.3 }],
  ['short audio tail', { duration: 1, audioDuration: 0.3 }],
  ['short video tail', { duration: 1, videoDuration: 0.3 }],
  ['audio only', { duration: 0.3, video: false }],
  ['late audio start', { duration: 1, audioStart: 0.3, audioDuration: 0.7 }],
]) test(`cast regression: ${name} reaches EOS once without waiting for an unreachable buffer target`, async () => {
  const h = fixture(settings);
  try {
    await h.media.load('https://fixture.test/eos.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush();
    for (let i = 0; i < 120 && !h.media.ended; i++) await h.tick(1 / 60);
    assert.equal(h.media.ended, true); assert.equal(h.events.filter(event => event === 'ended').length, 1);
    assert.ok(Math.abs(h.media.currentTime - settings.duration) < 0.002);
    assert.equal(h.media.error, null); assert.equal(h.media.buffering, false);
  } finally { h.media.dispose(); await flush(); }
});

for (const rate of [0.25, 0.5, 2, 4]) test(`cast regression: ${rate}x playback makes persistent progress within a finite surface pool`, async () => {
  const cadence = capturedCadences['vp9-60'];
  const h = fixture({ audio: false, duration: 12, videoCadence: cadence,
    frameWidth: cadence.width, frameHeight: cadence.height, surfacePool: 6 });
  try {
    h.media.playbackRate = rate;
    await h.media.load('https://fixture.test/rate.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush();
    let firstProgress = null, elapsed = 0;
    for (let i = 0; i < 240 && !h.media.ended; i++) {
      await h.tick(1 / 60); elapsed += 1 / 60;
      if (!firstProgress && h.media.currentTime > 0) firstProgress = { elapsed, position: h.media.currentTime };
    }
    assert.ok(h.media.currentTime >= Math.min(12, rate * 2), 'the requested speed must advance available input instead of waiting for an unreachable decoded watermark');
    const expected = Math.min(12, firstProgress.position + (elapsed - firstProgress.elapsed) * rate);
    assert.ok(Math.abs(h.media.currentTime - expected) <= 2 / 60 * rate);
    assert.equal(h.media.error, null); assert.equal(h.audioContexts(), 0);
    assert.ok(h.samples.filter(sample => !sample.closed).length <= 6);
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: one video network stall recovers once and then follows the wall clock', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ deferVideo: pending, deferVideoAt: 25 });
  try {
    await h.media.load('https://fixture.test/recovery.mp4'); await flush();
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    for (let i = 0; i < 36; i++) await h.tick(0.1);
    const stopped = h.media.currentTime;
    assert.ok(stopped >= 2.3 && stopped <= 2.41, 'the cursor stops at real received coverage rather than skipping missing input');
    assert.equal(h.media.buffering, true);
    const blocked = airplayDiagnostic('engine-state', { id: 1, revision: 1 }, { media: h.media });
    assert.equal(blocked.engine.running, false); assert.equal(blocked.engine.limitingTrack, 'video');
    release(); await flush();
    let firstProgress = null, elapsed = 0;
    const mark = h.events.length;
    for (let i = 0; i < 120; i++) {
      await h.tick(1 / 60); elapsed += 1 / 60;
      if (!firstProgress && h.media.currentTime > stopped) firstProgress = { elapsed, position: h.media.currentTime };
    }
    assert.ok(firstProgress, 'restored input releases the stalled cursor');
    const expected = firstProgress.position + elapsed - firstProgress.elapsed;
    assert.ok(Math.abs(h.media.currentTime - expected) <= 2 / 60);
    assert.equal(h.events.slice(mark).filter(event => event === 'playing').length, 1);
    assert.equal(h.events.slice(mark).includes('waiting'), false);
    assert.equal(h.inputs.length, 1, 'a simple shortage does not reopen the source and throw away useful cache');
  } finally { release(); h.media.dispose(); await flush(); }
});

test('cast regression: a four-second audio introduction is generated as bounded silence instead of rejected as a gap', async () => {
  const h = fixture({ duration: 5, audioStart: 4, audioDuration: 1, audioSampleRate: 48000, audioSamplesPerPacket: 1024 });
  try {
    await h.media.load('https://fixture.test/silent-introduction.mp4'); await flush();
    assert.ok(h.media.buffered.end(0) <= 3.1, 'the entire silent introduction is not allocated ahead of playback');
    const playing = h.media.play(); void playing.catch(() => {}); await flush();
    for (let i = 0; i < 360 && !h.media.ended; i++) await h.tick(1 / 60);
    assert.equal(h.media.error, null); assert.equal(h.media.ended, true);
    assert.ok(Math.abs(h.media.currentTime - 5) < 0.002);
    assert.equal(h.inputs.length, 1);
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: a sample read with zero playable coverage cannot wait forever or pretend to start', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ audio: false, deferVideo: pending });
  try {
    let loadError, playError;
    const loading = h.media.load('https://fixture.test/no-sample.mp4'); void loading.catch(error => { loadError = error; });
    await flush();
    const playing = h.media.play(); void playing.catch(error => { playError = error; }); await flush();
    for (let i = 0; i < 18 && !h.media.error; i++) await h.tick(1);
    await flush();
    assert.equal(h.media.currentTime, 0); assert.equal(h.events.includes('playing'), false);
    assert.equal(h.media.error?.name, 'TimeoutError');
    assert.equal(loadError?.name, 'TimeoutError'); assert.equal(playError?.name, 'TimeoutError');
  } finally { release(); h.media.dispose(); await flush(); }
});

test('cast regression: a known long static picture keeps its clock while the next sample read is pending', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ audio: false, duration: 60, videoCadence: { timescale: 1000, durationTicks: [30000] },
    deferVideo: pending, deferVideoAt: 2 });
  try {
    await h.media.load('https://fixture.test/static-picture.mp4'); await flush();
    const playing = h.media.play(); await flush(); await h.tick(); await playing;
    for (let i = 0; i < 18; i++) await h.tick(1);
    assert.equal(h.media.error, null); assert.ok(h.media.currentTime >= 17.9);
    assert.equal(h.media.buffering, false); assert.equal(h.pictures.length, 1);
  } finally { release(); h.media.dispose(); await flush(); }
});

test('cast regression: an interrupted audio context is not mistaken for a stalled decoder surface read', async () => {
  const h = fixture({ surfacePool: 6, videoFps: 60 });
  try {
    await h.media.load('https://fixture.test/interrupted-pool.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush();
    for (let i = 0; i < 90; i++) await h.tick(1 / 60);
    h.context().state = 'interrupted'; await h.tick();
    const stopped = h.media.currentTime;
    for (let i = 0; i < 18 && !h.media.error; i++) await h.tick(1);
    assert.equal(h.media.error, null, 'a known browser interruption must keep its recoverable context wait');
    assert.equal(h.media.currentTime, stopped); assert.equal(h.media.buffering, true);
    const diagnostic = airplayDiagnostic('engine-state', { id: 1, revision: 1 }, { media: h.media });
    assert.equal(diagnostic.engine.contextState, 'interrupted'); assert.equal(diagnostic.engine.running, false);
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: a frame that cannot coexist with its replacement fails explicitly before over-allocation', async () => {
  const h = fixture({ frameWidth: 4096, frameHeight: 4096 });
  try {
    await assert.rejects(h.media.load('https://fixture.test/oversized.mp4'), { name: 'NotSupportedError' });
    assert.ok(h.samples.every(sample => sample.closed === 1));
    assert.equal(h.samples.filter(sample => !sample.closed).length, 0);
  } finally { h.media.dispose(); await flush(); }
});

test('cast regression: close observations reconcile lifetime counts and held ownership across generations', async () => {
  const h = fixture({ surfacePool: 8, videoFps: 60 });
  const reconcile = () => {
    const diagnostic = h.media.getPlaybackDiagnostics(), live = h.samples.filter(sample => !sample.closed);
    const bytes = live.reduce((sum, sample) => sum + sample.codedWidth * sample.codedHeight * 4, 0);
    assert.equal(diagnostic.samplesReceived, h.samples.length);
    assert.equal(diagnostic.samplesClosed, h.samples.filter(sample => sample.closed).length);
    assert.equal(diagnostic.videoOwnedFrames, live.length); assert.equal(diagnostic.videoOwnedBytes, bytes);
    return diagnostic;
  };
  try {
    await h.media.load('https://fixture.test/ownership.mp4'); await flush();
    const playing = h.media.play(); void playing.catch(() => {}); await flush();
    for (let i = 0; i < 90; i++) await h.tick(1 / 60);
    reconcile(); h.media.pause(); await flush();
    const paused = reconcile();
    assert.equal(paused.videoHeldFrames, 1); assert.equal(paused.videoOwnedFrames, 1);
    await h.media.load('https://fixture.test/replacement.mp4'); await flush(); reconcile();
    h.media.dispose(); await flush();
    const disposed = reconcile();
    assert.equal(disposed.videoOwnedFrames, 0); assert.equal(disposed.samplesReceived, disposed.samplesClosed);
    assert.ok(h.samples.every(sample => sample.closed === 1));
  } finally { h.media.dispose(); await flush(); }
});
