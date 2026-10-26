/*! SPDX-License-Identifier: GPL-3.0-only */
import { NetEqRuntime, prepareNetEq } from './neteq.js';
import { NetEqAudio } from './neteq-audio.js';
import { AudioEvidence } from './audio-evidence.js';
import { AudioKernel, prepareAudioCore } from './wasm/audio-core.js';

const FADE_MS = 5, DUCK_GAIN = .2, MAX_STREAMS = 16;

/** Live audio follows packet supply. Video/source clock estimates never steer it. */
class TiPlayAudio extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    if (options.processorOptions?.neteqModule) prepareNetEq(options.processorOptions.neteqModule);
    if (options.processorOptions?.audioCoreModule) prepareAudioCore(options.processorOptions.audioCoreModule);
    this.kernel = new AudioKernel(); this.mixing = []; this.retiring = [];
    this.neteq = new NetEqRuntime();
    this.streams = new Map(); this.epochs = new Map(); this.pending = new Map(); this.endedEpochs = new Map();
    this.renderedFrames = 0; this.mediaGain = 1; this.disposed = false; this.suspended = false;
    this.lastReportFrame = this.lastFeedbackFrame = 0; this.feedbackSequence = 0;
    this.probeToken = 0; this.expectedFrame = null; this.domain = 0; this.domainStart = null; this.renderProbe = null;
    this.localAnchor = null; this.generation = null; this.diagnostics = null; this.evidence = null;
    this.port.onmessage = ({ data }) => this.message(data);
  }
  credit(type, bytes, generation, reason) {
    if (bytes) this.port.postMessage({ consumed: bytes, generation });
    if (this.diagnostics) {
      const stream = this.diagnostics.streams[type] ??= {};
      stream[reason + 'Bytes'] = (stream[reason + 'Bytes'] || 0) + bytes;
    }
  }
  reset() {
    for (const stream of this.streams.values()) stream.clear();
    this.streams.clear(); this.epochs.clear(); this.pending.clear(); this.endedEpochs.clear(); this.localAnchor = null;
  }
  message(data) {
    if (this.disposed) return;
    if (data.dispose) { this.evidence?.flush(); this.reset(); this.disposed = true; return; }
    if (data.reset) { this.reset(); this.generation = data.generation; }
    if (data.prepare) {
      const { id, rate, outputRate } = data.prepare;
      try {
        if (rate !== 48000 || outputRate !== 48000 || sampleRate !== 48000) throw new Error('Audio output format changed.');
        const stream = this.neteq.create('pcm', 1); stream.dispose();
        this.port.postMessage({ prepared: id });
      } catch (error) { this.port.postMessage({ prepareError: id, error: error.message }); }
      return;
    }
    if (typeof data.debug === 'boolean') {
      this.evidence?.flush(); this.diagnosticRevision = data.diagnosticRevision; this.generation = data.generation;
      this.diagnostics = data.debug ? { processCalls: 0, renderFrames: 0, renderNonzero: 0, renderPeak: 0, streams: {} } : null;
      this.evidence = data.debug ? new AudioEvidence(sampleRate, evidence => this.port.postMessage({ evidence,
        diagnosticRevision: this.diagnosticRevision, playbackGeneration: this.generation })) : null;
    }
    if (Number.isSafeInteger(data.renderProbe) && data.renderProbe > this.probeToken) { this.probeToken = data.renderProbe; this.renderProbe = data.renderProbe; }
    if ('suspended' in data && data.suspended !== this.suspended) {
      this.suspended = data.suspended;
      if (this.suspended) { this.evidence?.trigger('suspended'); this.reset(); }
    }
    if (data.evidenceTrigger) this.evidence?.trigger(data.evidenceTrigger.reason, data.evidenceTrigger.detail);
    if (!data.pcm && !data.payload && !data.neteqConfig) return;
    this.generation = data.generation;
    const previous = this.epochs.get(data.type);
    const size = data.pcm?.byteLength ?? data.payload?.byteLength ?? 0;
    if (previous !== undefined && ((data.epoch - previous) | 0) < 0) { this.credit(data.type, size, data.generation, 'late'); return; }
    if (this.endedEpochs.get(data.type) === data.epoch && !(data.flags & 2)) { this.credit(data.type, size, data.generation, 'late'); return; }
    const existing = this.streams.get(data.type);
    if (data.pcm && !size && data.ended !== false && (data.flags & 2)) {
      this.epochs.set(data.type, data.epoch); this.endedEpochs.set(data.type, data.epoch);
      existing?.finish(this.localTime()); this.pending.delete(data.type); return;
    }
    if (previous !== data.epoch || (data.flags & 2)) {
      existing?.clear(); this.streams.delete(data.type); this.epochs.set(data.type, data.epoch);
      this.pending.delete(data.type);
      this.endedEpochs.delete(data.type);
    }
    if (data.neteqConfig) { this.pending.set(data.type, data.neteqConfig); return; }
    if (!size) return;
    if (this.suspended) { this.credit(data.type, size, data.generation, 'reset'); return; }
    let stream = this.streams.get(data.type);
    if (!stream) {
      if (this.streams.size >= MAX_STREAMS) throw new Error('Too many simultaneous audio streams.');
      const config = this.pending.get(data.type);
      if (data.payload && (!config || config.codec !== 'opus' || config.sampleRate !== data.rate || config.channels !== data.channels))
        throw new Error('NetEq Opus packet has no matching configuration.');
      stream = new NetEqAudio(this.neteq, data.rate, data.channels, sampleRate,
        (bytes, generation, reason) => this.credit(data.type, bytes, generation, reason),
        { codec: data.payload ? 'opus' : 'pcm', type: data.type, semanticType: data.semanticType ?? data.type,
          mode: data.mode, epoch: data.epoch, generation: data.generation });
      this.streams.set(data.type, stream);
    }
    if (stream.rate !== data.rate || stream.channels !== data.channels || (stream.codec === 'opus') !== Boolean(data.payload))
      throw new Error('Audio format changed without a new stream configuration.');
    this.localAnchor ??= { frame: this.renderedFrames, ms: data.arrivalLocalTimeMs || 0 };
    stream.push(data, this.localTime());
  }
  localTime() {
    return this.localAnchor ? this.localAnchor.ms + (this.renderedFrames - this.localAnchor.frame) * 1000 / sampleRate : 0;
  }
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return !this.disposed;
    for (const channel of output) channel.fill(0);
    if (this.disposed) return false;
    const frames = output[0].length;
    const observed = typeof currentFrame === 'number' ? currentFrame : null;
    const verified = Number.isSafeInteger(observed) && observed >= 0 && Number.isSafeInteger(observed + frames);
    this.evidence?.begin(observed, this.expectedFrame, frames, output.length, this.domain, this.renderedFrames, this.mediaGain);
    if (!verified) {
      this.evidence?.trigger('frame-invalid');
      if (this.expectedFrame !== null) this.domain++;
      this.domainStart = null;
    }
    else {
      if (this.expectedFrame !== null && observed !== this.expectedFrame) {
        this.evidence?.trigger('frame-discontinuity', { observedFrame: observed, previousExpectedFrame: this.expectedFrame });
        this.domain++; this.domainStart = observed;
      }
      this.domainStart ??= observed;
    }
    // The browser counter is evidence only. The consumption cursor advances by actual output length.
    this.expectedFrame = verified ? observed + frames : null;
    this.mixing.length = 0;
    for (const stream of this.streams.values()) {
      if (!stream.block || stream.block.length < frames * stream.channels) stream.block = new Float32Array(frames * stream.channels);
      const produced = stream.render(stream.block, frames, this.localTime());
      this.evidence?.stage(stream, produced, frames);
      const entry = stream.mixerEntry ??= [stream.type, stream, 0]; entry[2] = produced; this.mixing.push(entry);
    }
    const step = (1 - DUCK_GAIN) / Math.max(1, Math.round(FADE_MS * sampleRate / 1000));
    this.mediaGain = this.kernel.mix(this.mixing, this.retiring, output, this.mediaGain, step, this.diagnostics);
    for (const [type, stream] of this.streams) if (stream.state === 'ended') {
      this.reference(stream, frames); stream.clear(); this.streams.delete(type);
    }
    this.renderedFrames += frames;
    this.evidence?.end(output, this.mediaGain, this.domain);
    if (this.diagnostics) {
      this.diagnostics.processCalls++; this.diagnostics.renderFrames += frames;
      this.diagnostics.renderQuantumFrames = frames;
      this.diagnostics.renderQuantumMinFrames = Math.min(this.diagnostics.renderQuantumMinFrames ?? frames, frames);
      this.diagnostics.renderQuantumMaxFrames = Math.max(this.diagnostics.renderQuantumMaxFrames ?? frames, frames);
      if (this.renderedFrames - this.lastReportFrame >= sampleRate / 2) {
        const { streams, ...scalars } = this.diagnostics;
        const details = Object.fromEntries([...this.streams].map(([type, stream]) => ['stream' + type,
          { ...stream.stats(), epoch: stream.epoch, mode: stream.mode, ...streams[type] }]));
        this.port.postMessage({ diagnosticRevision: this.diagnosticRevision, playbackGeneration: this.generation,
          evidenceBaseline: this.evidence?.baseline(), diagnostics: { ...scalars, ...details, ...this.evidence?.stats() } });
        this.lastReportFrame = this.renderedFrames;
      }
    }
    if (this.renderProbe !== null && verified) {
      this.port.postMessage({ renderProbe: { token: this.renderProbe, generation: this.domain, startFrame: this.domainStart,
        endFrame: this.expectedFrame, renderQuantumFrames: frames } }); this.renderProbe = null;
    }
    if (this.renderedFrames - this.lastFeedbackFrame >= sampleRate * .04) {
      for (const stream of this.streams.values()) this.reference(stream, frames);
      this.lastFeedbackFrame = this.renderedFrames;
    }
    return true;
  }
  reference(stream, frames) {
    this.port.postMessage({ playout: {
      type: stream.type, semanticType: stream.semanticType, mode: stream.mode, epoch: stream.epoch, generation: stream.generation,
      state: stream.state === 'playing' ? 'untimed' : stream.state, playoutState: stream.state,
      contextTimeMs: this.renderedFrames * 1000 / sampleRate, sourceTimeMs: null, mediaRate: 1,
      sourceDeadlineState: 'unknown', sourceDeadlineReason: 'independent-audio',
      renderQuantumFrames: frames, sequence: ++this.feedbackSequence,
    } });
  }
}
registerProcessor('tiplay-audio', TiPlayAudio);
