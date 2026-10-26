/*! SPDX-License-Identifier: GPL-3.0-only */
import { NetEqRuntime, prepareNetEq } from './neteq.js';
import { NetEqAudio } from './neteq-audio.js';
import { AudioEvidence } from './audio-evidence.js';
import { MAX_AUDIO_AHEAD_BYTES } from './audio-buffer-policy.js';
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
    this.directInputs = new Map();
    this.nativeInputs = new Map();
    this.streams = new Map(); this.epochs = new Map(); this.endedEpochs = new Map();
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
    for (const input of this.directInputs.values()) { input.port.postMessage({ failed: 'Audio output reset.' }); input.port.close(); }
    this.directInputs.clear();
    this.nativeInputs.clear(); this.retiring.length = 0;
    for (const stream of this.streams.values()) stream.clear();
    this.streams.clear(); this.epochs.clear(); this.endedEpochs.clear(); this.localAnchor = null;
  }
  bindDirect({ id, port, record }) {
    if (!port) return;
    if (this.disposed || this.suspended || record?.generation !== this.generation || !Number.isInteger(record?.type)
      || !Number.isInteger(record?.epoch) || !Number.isSafeInteger(id)) {
      port.postMessage({ failed: 'Stale audio output binding.' }); port.close(); return;
    }
    const previous = this.epochs.get(record.type);
    if (previous !== undefined && ((record.epoch - previous) | 0) < 0) {
      port.postMessage({ failed: 'Stale audio output epoch.' }); port.close(); return;
    }
    const retired = this.directInputs.get(record.type);
    if (retired) { retired.port.postMessage({ failed: 'Audio output replaced.' }); retired.port.close(); }
    const owner = { id, port, record };
    this.directInputs.set(record.type, owner);
    port.onmessage = ({ data }) => this.receiveDirect(owner, data);
    port.start?.();
    port.postMessage({ ready: true });
  }
  receiveDirect(owner, { deliveryId, records }) {
    const { id, port, record: binding } = owner;
    if (this.disposed || this.suspended || this.directInputs.get(binding.type) !== owner || binding.generation !== this.generation) {
      port.postMessage({ deliveryId, error: 'Stale audio output owner.' }); return;
    }
    let bytes = 0;
    try {
      const epoch = this.epochs.get(binding.type);
      if (epoch !== undefined && ((binding.epoch - epoch) | 0) < 0) throw Error('Stale direct audio epoch.');
      if (!Number.isSafeInteger(deliveryId) || !Array.isArray(records) || records.length > 128) throw Error('Invalid audio output batch.');
      for (const record of records) {
        if (!(record.pcm instanceof ArrayBuffer) || record.type !== binding.type || record.mode !== binding.mode
          || record.epoch !== binding.epoch || record.generation !== binding.generation
          || record.rate !== 48000 || ![1, 2].includes(record.channels) || record.channels !== binding.channels
          || record.pcm.byteLength % (record.channels * 2)) throw Error('Invalid direct audio record.');
        bytes += record.pcm.byteLength;
      }
      const queued = [...this.streams.values()].reduce((sum, stream) => sum + stream.queueBytes, 0);
      if (bytes > 256 * 1024 || queued + bytes > MAX_AUDIO_AHEAD_BYTES) throw Error('Direct audio output exceeds its memory limit.');
    } catch (cause) {
      this.port.postMessage({ directPcm: { id, deliveryId, records: [] }, generation: binding.generation });
      port.postMessage({ deliveryId, error: cause.message }); return;
    }
    // Main's byte ledger must observe admission before any same-port consumption
    // credit, even if the worker's operation reply arrives on a different port first.
    this.port.postMessage({ directPcm: { id, deliveryId, records: records.map(({ pcm, ...metadata }) =>
      ({ ...metadata, pcmBytes: pcm.byteLength })) }, generation: binding.generation });
    let next = 0;
    try {
      for (; next < records.length; next++) this.message(records[next]);
      port.postMessage({ deliveryId });
    } catch (cause) {
      // An invalid decoder result must not terminate the shared render processor.
      // Return every admitted byte: earlier packets are owned by stream tokens;
      // the failing packet and remaining batch have not acquired tokens yet.
      this.streams.get(binding.type)?.clear(); this.streams.delete(binding.type);
      for (; next < records.length; next++) this.credit(binding.type, records[next].pcm.byteLength, binding.generation, 'reset');
      port.postMessage({ deliveryId, error: cause.message });
    }
  }
  message(data) {
    if (data.directInput) { this.bindDirect(data.directInput); return; }
    if (data.directClose) {
      const owner = this.directInputs.get(data.directClose.type);
      if (owner?.id === data.directClose.id && owner.record.generation === data.directClose.generation) {
        owner.port.close(); this.directInputs.delete(data.directClose.type);
      }
      return;
    }
    if (this.disposed) return;
    if (data.dispose) { this.evidence?.flush(); this.reset(); this.disposed = true; return; }
    if (data.reset) { this.reset(); this.generation = data.generation; }
    if (data.nativeAudio) {
      const owner = data.nativeAudio;
      if (owner.generation !== this.generation || this.suspended || !Number.isInteger(owner.inputIndex)
        || owner.inputIndex < 0 || owner.inputIndex >= MAX_STREAMS || ![1, 2].includes(owner.channels)) return;
      const previous = this.epochs.get(owner.type);
      if (previous !== undefined && ((owner.epoch - previous) | 0) < 0) return;
      const same = this.nativeInputs.get(owner.inputIndex);
      if (same && same.type === owner.type && same.epoch === owner.epoch && same.rtcGeneration === owner.rtcGeneration) return;
      for (const stream of this.nativeInputs.values()) if (stream.type === owner.type) stream.ended = true;
      this.streams.get(owner.type)?.clear(); this.streams.delete(owner.type);
      const input = { ...owner, state: 'priming', sourceFrame: 0, inputFrame: 0, queueBytes: 0,
        last: new Float32Array(owner.channels), started: false, outputFrames: 0,
        stats() { return { backend: 'webrtc-track', state: this.state, outputFrames: this.outputFrames }; } };
      this.epochs.set(owner.type, owner.epoch); this.endedEpochs.delete(owner.type);
      this.nativeInputs.set(owner.inputIndex, input); return;
    }
    if (data.nativeAudioEnd) {
      const owner = data.nativeAudioEnd, stream = this.nativeInputs.get(owner.inputIndex);
      if (stream && owner.generation === this.generation && stream.type === owner.type && stream.epoch === owner.epoch
        && stream.rtcGeneration === owner.rtcGeneration) stream.ended = true;
      return;
    }
    if (data.nativeAudioGraph) {
      const owner = data.nativeAudioGraph, stream = this.nativeInputs.get(owner.inputIndex);
      if (stream && owner.generation === this.generation && stream.type === owner.type && stream.mode === owner.mode
        && stream.epoch === owner.epoch && stream.rtpSlot === owner.rtpSlot && stream.rtcGeneration === owner.rtcGeneration)
        stream.graphConnected = true;
      return;
    }
    if (data.nativeAudioRetire) {
      const owner = data.nativeAudioRetire;
      if (owner.generation === this.generation) for (const stream of [...this.nativeInputs.values()])
        if (stream.rtcGeneration === owner.rtcGeneration) this.endNative(stream);
      return;
    }
    if (data.prepare) {
      const { id, rate, outputRate } = data.prepare;
      try {
        if (rate !== 48000 || outputRate !== 48000 || sampleRate !== 48000) throw new Error('Audio output format changed.');
        const stream = this.neteq.create('pcm', 1); stream.dispose();
        this.port.postMessage({ prepared: id, directInputSupported: true });
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
    if (data.payload || data.neteqConfig) throw Error('Encoded audio requires the native RTP transport.');
    if (!data.pcm) return;
    this.generation = data.generation;
    const previous = this.epochs.get(data.type);
    const size = data.pcm?.byteLength ?? 0;
    if (previous !== undefined && ((data.epoch - previous) | 0) < 0) { this.credit(data.type, size, data.generation, 'late'); return; }
    if (this.endedEpochs.get(data.type) === data.epoch && !(data.flags & 2)) { this.credit(data.type, size, data.generation, 'late'); return; }
    const existing = this.streams.get(data.type);
    if (data.pcm && !size && data.ended !== false && (data.flags & 2)) {
      this.epochs.set(data.type, data.epoch); this.endedEpochs.set(data.type, data.epoch);
      existing?.finish(this.localTime()); return;
    }
    if (previous !== data.epoch || (data.flags & 2)) {
      for (const stream of this.nativeInputs.values()) if (stream.type === data.type) stream.ended = true;
      existing?.clear(); this.streams.delete(data.type); this.epochs.set(data.type, data.epoch);
      this.endedEpochs.delete(data.type);
    }
    if (!size) return;
    if (this.suspended) { this.credit(data.type, size, data.generation, 'reset'); return; }
    let stream = this.streams.get(data.type);
    if (!stream) {
      if (this.streams.size >= MAX_STREAMS) throw new Error('Too many simultaneous audio streams.');
      stream = new NetEqAudio(this.neteq, data.rate, data.channels, sampleRate,
        (bytes, generation, reason) => this.credit(data.type, bytes, generation, reason),
        { codec: 'pcm', type: data.type, semanticType: data.semanticType ?? data.type,
          mode: data.mode, epoch: data.epoch, generation: data.generation });
      this.streams.set(data.type, stream);
    }
    if (stream.rate !== data.rate || stream.channels !== data.channels)
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
    for (const stream of this.nativeInputs.values()) {
      // Graph readiness must not wait for RTP: the sender intentionally holds all
      // packets until this exact owner has crossed the render-thread barrier.
      if (stream.awaitGraph && stream.graphConnected && !stream.boundNotified) {
        stream.boundNotified = true;
        this.port.postMessage({ nativeAudioBound: { type: stream.type, mode: stream.mode, epoch: stream.epoch,
          rtcOwnerEpoch: stream.epoch, rtpSlot: stream.rtpSlot, inputIndex: stream.inputIndex,
          generation: stream.generation, rtcGeneration: stream.rtcGeneration } });
      }
      const input = inputs[stream.inputIndex] ?? [];
      if (!stream.block || stream.block.length < frames * stream.channels) stream.block = new Float32Array(frames * stream.channels);
      let active = false;
      for (let i = 0; i < frames; i++) for (let c = 0; c < stream.channels; c++) {
        const value = input[Math.min(c, input.length - 1)]?.[i] ?? 0;
        stream.block[i * stream.channels + c] = value; if (value !== 0) active = true;
      }
      stream.state = stream.ended ? 'draining' : active ? 'playing' : 'priming'; stream.outputFrames += frames;
      for (let c = 0; c < stream.channels; c++) stream.last[c] = stream.block[(frames - 1) * stream.channels + c];
      if (active && !stream.started && !stream.ended) {
        stream.started = true;
        this.port.postMessage({ nativeStarted: { type: stream.type, mode: stream.mode, epoch: stream.epoch,
          semanticType: stream.semanticType, generation: stream.generation, rtcGeneration: stream.rtcGeneration } });
      }
      if (active || !stream.ended) this.evidence?.stage(stream, active ? frames : 0, frames);
      const entry = stream.mixerEntry ??= [stream.type, stream, 0]; entry[2] = active && !stream.ended ? frames : 0; this.mixing.push(entry);
    }
    const step = (1 - DUCK_GAIN) / Math.max(1, Math.round(FADE_MS * sampleRate / 1000));
    this.mediaGain = this.kernel.mix(this.mixing, this.retiring, output, this.mediaGain, step, this.diagnostics);
    for (let i = this.retiring.length - 1; i >= 0; i--) if (!this.retiring[i].remaining) this.retiring.splice(i, 1);
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
        const all = [...this.streams, ...[...this.nativeInputs.values()].map(stream => [stream.type, stream])];
        const details = Object.fromEntries(all.map(([type, stream]) => ['stream' + type,
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
      for (const stream of this.nativeInputs.values()) this.reference(stream, frames);
      this.lastFeedbackFrame = this.renderedFrames;
    }
    return true;
  }
  endNative(stream) {
    this.nativeInputs.delete(stream.inputIndex);
    this.endedEpochs.set(stream.type, stream.epoch);
    const frames = Math.max(1, Math.round(FADE_MS * sampleRate / 1000));
    if (stream.last.some(value => value !== 0)) this.retiring.push({ type: stream.type, semanticType: stream.semanticType,
      samples: stream.last, remaining: frames, total: frames });
    stream.state = 'ended'; this.reference(stream, 0);
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
