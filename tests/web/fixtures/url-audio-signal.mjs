// SPDX-License-Identifier: GPL-3.0-only
// Synthetic decoded URL media. No captured media, network identifiers or worklet statistics.
const TONE_HZ = 997, AMPLITUDE = 0.25, PHASE = 0.37, INDEX_SCALE = 2 ** 20;

/** Channel 0 is a known continuous tone; channel 1 identifies every source frame exactly. */
export function urlAudioSample(frame, channel, sampleRate) {
  return channel === 0 ? AMPLITUDE * Math.sin(2 * Math.PI * TONE_HZ * frame / sampleRate + PHASE)
    : (frame + 1) / INDEX_SCALE;
}

/** Inspect the plan supplied to AudioBufferSourceNodes; this is not a browser-render claim. */
export function renderScheduledUrlAudio(nodes, sampleRate, seconds) {
  const frames = Math.round(seconds * sampleRate), channels = [new Float32Array(frames), new Float32Array(frames)];
  const coverage = new Uint16Array(frames);
  const anchor = nodes.find(node => Number.isFinite(node.time));
  const anchorTime = anchor?.renderTime ?? anchor?.time ?? 0;
  for (const node of nodes) {
    if (!node.buffer || !Number.isFinite(node.time)) continue;
    if (node.buffer.sampleRate !== sampleRate) throw new Error('Plan oracle requires equal input/output rates; use real OfflineAudioContext for resampling.');
    // Simulated start() records its effective edge when the device clock was
    // advanced inside the call. Native actual edges require the worklet capture.
    const first = Math.round(((node.renderTime ?? node.time) - anchorTime) * sampleRate);
    const stop = Number.isFinite(node.stopTime) ? Math.round((node.stopTime - anchorTime) * sampleRate) : Infinity;
    for (let index = 0; index < node.buffer.length; index++) {
      const at = first + index;
      if (at < 0 || at >= frames || at >= stop) continue;
      coverage[at]++;
      for (let channel = 0; channel < channels.length; channel++) channels[channel][at] += node.buffer.getChannelData(channel)[index];
    }
  }
  return { channels, coverage, sampleRate, anchorTime };
}

/** Independent original-signal oracle, including frame identity and local tone phase. */
export function inspectUrlAudioSignal(rendered, fromSeconds, toSeconds) {
  const { channels: [left, right], coverage, sampleRate } = rendered;
  const first = Math.max(1, Math.round(fromSeconds * sampleRate)), last = Math.min(left.length - 1, Math.round(toSeconds * sampleRate));
  const omega = 2 * Math.PI * TONE_HZ / sampleRate;
  let gaps = 0, overlaps = 0, frameIdentityErrors = 0, clickResidualFrames = 0, errorEnergy = 0, referenceEnergy = 0;
  let maximumError = 0, maximumStepResidual = 0, maximumPhaseErrorRadians = 0, previous = null;
  let duplicateFrames = 0, skippedFrames = 0, maximumGapRun = 0, gapRun = 0;
  for (let frame = first; frame < last; frame++) {
    const expected = Math.fround(urlAudioSample(frame, 0, sampleRate));
    const error = left[frame] - expected;
    maximumError = Math.max(maximumError, Math.abs(error)); errorEnergy += error ** 2; referenceEnergy += expected ** 2;
    if (coverage[frame] === 0) { gaps++; gapRun++; maximumGapRun = Math.max(maximumGapRun, gapRun); }
    else gapRun = 0;
    if (coverage[frame] > 1) overlaps++;
    const identity = Math.round(right[frame] * INDEX_SCALE) - 1;
    if (coverage[frame] !== 1 || identity !== frame) frameIdentityErrors++;
    if (coverage[frame] === 1 && previous !== null) {
      if (identity <= previous) duplicateFrames++;
      else if (identity > previous + 1) skippedFrames += identity - previous - 1;
    }
    previous = coverage[frame] === 1 ? identity : null;
    const expectedStep = expected - Math.fround(urlAudioSample(frame - 1, 0, sampleRate));
    const stepResidual = Math.abs(left[frame] - left[frame - 1] - expectedStep);
    maximumStepResidual = Math.max(maximumStepResidual, stepResidual);
    if (stepResidual > 0.01) clickResidualFrames++;
    const sinPhase = left[frame] / AMPLITUDE;
    const cosPhase = (left[frame + 1] / AMPLITUDE - sinPhase * Math.cos(omega)) / Math.sin(omega);
    const delta = Math.atan2(sinPhase, cosPhase) - (omega * frame + PHASE);
    maximumPhaseErrorRadians = Math.max(maximumPhaseErrorRadians, Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))));
  }
  return { frames: last - first, gaps, overlaps, frameIdentityErrors, duplicateFrames, skippedFrames, maximumGapRun,
    maximumError, maximumStepResidual, clickResidualFrames, maximumPhaseErrorRadians,
    relativeErrorDb: errorEnergy ? 10 * Math.log10(errorEnergy / referenceEnergy) : -Infinity };
}

/** Source identities remain consecutive even when an unavoidable wall-clock underrun inserts silence. */
export function inspectScheduledUrlAudioSequence(nodes) {
  let previous = null, skippedFrames = 0, repeatedFrames = 0, submittedFrames = 0;
  for (const node of nodes) {
    if (!node.buffer || !Number.isFinite(node.time)) continue;
    const count = Math.min(node.buffer.length, Number.isFinite(node.stopTime)
      ? Math.max(0, Math.round((node.stopTime - (node.renderTime ?? node.time)) * node.buffer.sampleRate)) : node.buffer.length);
    if (!count) continue;
    const identities = node.buffer.getChannelData(1);
    const first = Math.round(identities[0] * INDEX_SCALE) - 1;
    const last = Math.round(identities[count - 1] * INDEX_SCALE) - 1;
    if (previous !== null) {
      skippedFrames += Math.max(0, first - previous - 1);
      repeatedFrames += Math.max(0, previous - first + 1);
    }
    submittedFrames += count; previous = last;
  }
  return { skippedFrames, repeatedFrames, submittedFrames };
}

/**
 * Synthetic decoded media drives the real engine; the fake device clock advances
 * independently of rAF in 128-frame quanta. This checks the submitted graph, not
 * real device rendering deadlines. No production scheduling logic is copied.
 */
export function createUrlAudioSchedulingFixture(createMediaEngine, {
  sampleRate = 48000, duration = 4, video = false, videoFps = 30, videoSurfacePool = 6,
  videoDeferAt = Infinity, videoReadGate = null,
  AudioContext: ContextConstructor = null, now = null, requestFrame = null, cancelFrame = null,
  beforeSourceStart = null, afterSourceStart = null,
} = {}) {
  const packetFrames = 1024, callbacks = new Map(), nodes = [], samples = [], surfaceWaiters = new Set();
  let wall = 0, nextCallback = 0, context, held;
  const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
  const wakeSurfaces = () => { for (const wake of surfaceWaiters) wake(); surfaceWaiters.clear(); };
  const closeHeld = () => { held?.close(); held = null; };
  const audioTrack = { canDecode: async () => true, isLive: async () => false };
  const videoTrack = { canDecode: async () => true, isLive: async () => false,
    getPrimaryPairableAudioTrack: async () => audioTrack,
    getDecoderConfig: async () => null, getDisplayWidth: async () => 16, getDisplayHeight: async () => 9 };
  class Input {
    getPrimaryVideoTrack() { return Promise.resolve(video ? videoTrack : null); }
    getPrimaryAudioTrack() { return Promise.resolve(audioTrack); }
    getFirstTimestamp() { return Promise.resolve(0); }
    getDurationFromMetadata() { return Promise.resolve(duration); }
    dispose() {}
  }
  class AudioBufferSink {
    buffers(start) {
      let index = Math.max(0, Math.floor(start * sampleRate / packetFrames + 1e-6)), closed = false;
      return { [Symbol.asyncIterator]() { return this; },
        async return() { closed = true; return { done: true }; },
        async next() {
          if (closed || index * packetFrames >= duration * sampleRate) return { done: true };
          const first = index++ * packetFrames;
          return { done: false, value: { timestamp: first / sampleRate, duration: packetFrames / sampleRate,
            buffer: { sampleRate, numberOfChannels: 2, length: packetFrames, duration: packetFrames / sampleRate,
              getChannelData: channel => Float32Array.from({ length: packetFrames }, (_, frame) => urlAudioSample(first + frame, channel, sampleRate)) } } };
        } };
    }
  }
  class VideoSampleSink {
    samples(start) {
      let index = Math.floor(start * videoFps + 1e-6), closed = false;
      return { [Symbol.asyncIterator]() { return this; },
        async return() { closed = true; wakeSurfaces(); return { done: true }; },
        async next() {
          if (closed || index / videoFps >= duration) return { done: true };
          if (index === videoDeferAt && videoReadGate) await videoReadGate;
          while (!closed && samples.filter(sample => !sample.closed).length >= videoSurfacePool)
            await new Promise(resolve => surfaceWaiters.add(resolve));
          if (closed) return { done: true };
          const timestamp = index++ / videoFps;
          const sample = { timestamp, duration: 1 / videoFps, displayWidth: 16, displayHeight: 9,
            codedWidth: 16, codedHeight: 9, closed: false, close() { this.closed = true; wakeSurfaces(); } };
          samples.push(sample); return { done: false, value: sample };
        } };
    }
  }
  class SimulatedAudioContext {
    constructor(options) { this.sampleRate = options.sampleRate; this.currentTime = this.elapsed = 0; this.state = 'suspended'; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBuffer(channels, length, rate) {
      const planes = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, sampleRate: rate, duration: length / rate,
        copyToChannel(data, channel) { planes[channel].set(data); }, getChannelData: channel => planes[channel] };
    }
    createBufferSource() {
      const owner = this;
      return { connect() {}, disconnect() {}, start(time) { this.renderTime = Math.max(time, owner.currentTime); }, stop() {} };
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class ObservedAudioContext extends (ContextConstructor || SimulatedAudioContext) {
    constructor(options) { super(options); context = this; }
    createBufferSource() {
      const node = super.createBufferSource(), start = node.start.bind(node), stop = node.stop.bind(node), owner = this;
      node.start = time => {
        node.time = time; node.scheduledAt = owner.currentTime;
        beforeSourceStart?.({ node, context: owner, time }); start(time); afterSourceStart?.({ node, context: owner, time });
      };
      node.stop = (...args) => { node.stopTime = args[0] ?? owner.currentTime; stop(...args); };
      nodes.push(node); return node;
    }
  }
  const media = createMediaEngine(null, { library: { Input, AudioBufferSink, VideoSampleSink, UrlSource: class {}, ALL_FORMATS: [] }, AudioContext: ObservedAudioContext,
    presenter: { present(sample) { closeHeld(); held = sample; }, clear: closeHeld, dispose: closeHeld },
    now: now || (() => wall), requestFrame: requestFrame || (callback => { callbacks.set(++nextCallback, callback); return nextCallback; }),
    cancelFrame: cancelFrame || (id => callbacks.delete(id)) });
  const advance = seconds => {
    wall += seconds;
    if (context?.state === 'running') {
      context.elapsed += seconds;
      context.currentTime = Math.floor(context.elapsed * context.sampleRate / 128) * 128 / context.sampleRate;
    }
  };
  return { media, nodes, samples, flush, advance, context: () => context,
    async tick(seconds = 0) {
      advance(seconds);
      const pending = callbacks.entries().next().value;
      if (!pending) throw new Error('URL engine has no pending animation callback');
      callbacks.delete(pending[0]); pending[1](); await flush();
    } };
}
