/*! SPDX-License-Identifier: GPL-3.0-only */
import { PcmTimeline } from './pcm-timeline.js';
import { initialPlaybackPlans, audioDelayAt, audioLimit } from './playback-window.js';
import { BUFFERED_AUDIO_WINDOW_MS } from './audio-buffer-policy.js';
import { SoxrRuntime, prepareSoxr } from './streaming-resampler.js';
import { AudioKernel, prepareAudioCore } from './wasm/audio-core.js';
import { ContinuousAudio, AUDIO_FADE_MS, AUDIO_RECOVERY_ERROR_MS, sourceDeadlineAt, sourceDeadlineUncertainty } from './continuous-audio.js';
import { rateProjectionUncertainty } from './audio-device-clock.js';

const purpose = (type, stream) => stream.semanticType ?? type;
const isVoice = (type, stream) => purpose(type, stream) >= 1 && purpose(type, stream) <= 4;
const isMedia = (type, stream) => purpose(type, stream) === 0 || purpose(type, stream) === 6;
const SPEECH_START_BUFFER_MS = 20;
const MEDIA_DUCK_GAIN = 0.2;

class TiPlayAudio extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    if (options.processorOptions?.soxrModule) prepareSoxr(options.processorOptions.soxrModule);
    if (options.processorOptions?.audioCoreModule) prepareAudioCore(options.processorOptions.audioCoreModule);
    this.streams = new Map();
    this.timelines = new Map(); this.epochs = new Map(); this.delayPlans = initialPlaybackPlans(); this.clockBase = null;
    this.plansByMode = {};
    this.diagnostics = null; this.lastReportTime = -Infinity; this.diagnosticRevision = null; this.playbackGeneration = null;
    this.runtime = new SoxrRuntime({ allowCalibration: false }); this.clock = null; this.contextAnchor = null; this.localTimeOriginMs = 0;
    this.kernel = this.runtime.audioKernel = new AudioKernel();
    this.renderedFrames = 0; this.feedbackSequence = 0; this.lastFeedbackMs = -Infinity; this.suspended = false;
    this.renderQuantumMaxFrames = 0;
    this.nextContextFrame = null; this.outputUncertaintyMs = 0; this.outputMethod = null;
    this.renderDomainGeneration = 0; this.renderDomainStartFrame = null; this.renderDomainNextFrame = null;
    this.renderProbeToken = 0; this.pendingRenderProbe = null;
    this.deviceClock = { rate: 1 }; this.arrivalAnchor = null;
    this.retiring = [];
    this.continuous = [];
    this.retiredDeadlineReports = new Map();
    this.mediaGain = 1;
    this.mediaGainStep = (1 - MEDIA_DUCK_GAIN) / Math.max(1, Math.round(AUDIO_FADE_MS * sampleRate / 1000));
    this.disposed = false;
    this.port.onmessage = ({ data }) => {
      if (this.disposed) return;
      if (data.dispose) {
        for (const timeline of this.timelines.values()) timeline.clear();
        this.timelines.clear();
        for (const [type, stream] of this.streams) for (const pcm of stream.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', type);
        this.streams.clear(); this.epochs.clear(); this.retiring = []; this.retiredDeadlineReports.clear(); this.runtime = null; this.disposed = true;
        return;
      }
      const contextMs = this.renderContextMs();
      if (Number.isSafeInteger(data.renderProbe) && data.renderProbe > this.renderProbeToken) {
        this.renderProbeToken = data.renderProbe; this.pendingRenderProbe = data.renderProbe;
      }
      if (data.calibration) {
        const { rate, outputRate, delayMs } = data.calibration;
        if (outputRate !== sampleRate) throw new Error('Audio calibration output rate does not match the device.');
        this.runtime.setCalibration(rate, outputRate, delayMs);
      }
      if (data.prepare) {
        const { id, rate, outputRate } = data.prepare;
        let backend;
        try {
          if (outputRate !== sampleRate) throw new Error('Invalid audio preparation output rate.');
          this.runtime.filterDelay(rate, outputRate); // Cache only; never measure on this thread.
          backend = this.runtime.create(rate, outputRate, 2);
          const input = new Float32Array(4096 * 2), output = new Float32Array(512 * 2);
          backend.process(input, 4096, output);
          for (let i = 0; i < 8; i++) backend.process(input, 0, output);
          this.port.postMessage({ prepared: id });
        } catch (error) { this.port.postMessage({ prepareError: id, error: error.message || String(error) }); }
        finally { backend?.dispose(); }
        return;
      }
      if ('clock' in data) this.clock = data.clock;
      if (data.deviceClock && Number.isFinite(data.deviceClock.rate) && data.deviceClock.rate >= 0.98 && data.deviceClock.rate <= 1.02) {
        // Integrate changes without moving guidance's existing arrival anchor.
        this.arrivalAnchor = { contextTimeMs: contextMs, timeMs: this.arrivalTime(contextMs) };
        // A generation identifies the timestamp measurement fit, not a jump in
        // emitted samples. Suspend and the actual render counter recover below;
        // restarting a noisy fit must preserve the live resampler signal.
        this.deviceClock = data.deviceClock;
      }
      if ('contextAnchor' in data) this.contextAnchor = data.contextAnchor;
      if ('outputMethod' in data) this.outputMethod = data.outputMethod;
      if ('localTimeOriginMs' in data) this.localTimeOriginMs = data.localTimeOriginMs;
      if ('outputUncertaintyMs' in data) this.outputUncertaintyMs = data.outputUncertaintyMs;
      if ('suspended' in data) {
        if (data.suspended && !this.suspended) for (const [type, timeline] of this.timelines) if (timeline instanceof ContinuousAudio) {
          if (timeline.arrivalPlayback) { this.retireTimeline(timeline); this.timelines.delete(type); }
          else timeline.recover('suspended');
        }
        this.suspended = data.suspended;
      }
      if (typeof data.debug === 'boolean') {
        this.diagnostics = data.debug ? { processCalls: 0, renderFrames: 0, renderNonzero: 0, renderPeak: 0, streams: {} } : null;
        this.diagnosticRevision = data.diagnosticRevision;
        this.playbackGeneration = Number.isSafeInteger(data.generation) ? data.generation : null;
        this.lastReportTime = -Infinity;
        this.retiredDeadlineReports.clear();
        for (const timeline of this.timelines.values()) timeline.debug(data.debug);
      }
      if (data.plans) this.delayPlans = data.plans;
      if (data.plansByMode) this.plansByMode = data.plansByMode;
      if (data.clockBase !== undefined) this.clockBase = data.clockBase;
      if (data.reset) {
        this.playbackGeneration = Number.isSafeInteger(data.generation) ? data.generation : null;
        this.retiredDeadlineReports.clear();
        for (const [type, stream] of this.streams) for (const pcm of stream.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', type);
        this.streams.clear();
        for (const timeline of this.timelines.values()) this.retireTimeline(timeline);
        this.timelines.clear();
        this.epochs.clear();
      }
      if (!data.pcm) return;
      this.playbackGeneration = Number.isSafeInteger(data.generation) ? data.generation : null;
      const previousEpoch = this.epochs.get(data.type);
      const previousTimeline = this.timelines.get(data.type);
      if (previousEpoch !== undefined && ((data.epoch - previousEpoch) | 0) < 0) { this.credit(data.pcm.byteLength, data.generation, 'late', data.type); return; }
      if (previousEpoch !== undefined && previousEpoch !== data.epoch) {
        this.retireTimeline(this.timelines.get(data.type)); this.timelines.delete(data.type);
        const legacy = this.streams.get(data.type);
        if (legacy) for (const pcm of legacy.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', data.type);
        this.streams.delete(data.type);
      }
      this.epochs.set(data.type, data.epoch);
      if (!data.pcm.byteLength && data.flags & 2) {
        if (previousTimeline && previousEpoch === data.epoch) this.retireTimeline(previousTimeline);
        this.port.postMessage({ playout: { ...(previousTimeline instanceof ContinuousAudio ? previousTimeline.reference(contextMs) : {}),
          type: data.type, semanticType: data.semanticType ?? data.type, mode: data.mode, epoch: data.epoch, generation: data.generation,
          anchoring: previousTimeline?.arrivalPlayback ? 'arrival' : 'presentation',
          clockGeneration: this.clock?.generation, contextTimeMs: contextMs,
          state: data.ended === false ? 'priming' : 'ended', sequence: ++this.feedbackSequence } });
        this.timelines.delete(data.type); return;
      }
      if (Number.isFinite(data.presentationMs) || this.clock?.version >= 2 && !Number.isFinite(data.sourceTime)) {
        let timeline = this.timelines.get(data.type);
        if (!(timeline instanceof ContinuousAudio) || timeline.rate !== data.rate || timeline.channels !== data.channels || timeline.epoch !== data.epoch || data.flags & 2) {
          this.retireTimeline(timeline);
          const mediaWindow = data.mode === 'carplay' && purpose(data.type, data) === 0;
          timeline = new ContinuousAudio(this.runtime, data.rate, data.channels, sampleRate,
            (bytes, reason, generation) => this.credit(bytes, generation, reason, data.type),
            (data.flags & 1) || mediaWindow ? BUFFERED_AUDIO_WINDOW_MS : 1000,
            { buffered: Boolean(data.flags & 1), mode: data.mode, type: data.type, semanticType: data.semanticType ?? data.type });
          timeline.debug(Boolean(this.diagnostics)); timeline.epoch = data.epoch; timeline.generation = data.generation;
          timeline.arrivalPlayback = data.mode === 'carplay' && isVoice(data.type, data) && !Number.isFinite(data.presentationMs);
          timeline.synchronized = !timeline.arrivalPlayback && Number.isFinite(data.presentationMs); this.timelines.set(data.type, timeline);
        }
        const legacy = this.streams.get(data.type);
        if (legacy) { for (const pcm of legacy.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', data.type); this.streams.delete(data.type); }
        // A first real anchor can arrive after either untimed mirror PCM or
        // arrival-based guidance. Preserve the existing sample progress.
        if (!timeline.synchronized && Number.isFinite(data.presentationMs)) timeline.synchronize(data);
        if (timeline.arrivalPlayback) {
          // Untimed guidance has no lip-sync relationship with the screen. Its sender may
          // supply no lead at all, so a device-delay target can never catch its tail.
          // Anchor the first sample to this render clock while retaining RTP gaps.
          timeline.arrivalStartMs ??= this.arrivalTime(contextMs) + SPEECH_START_BUFFER_MS;
          if (Number.isFinite(data.presentationMs)) timeline.arrivalSourceMs ??= data.presentationMs
            - (timeline.lastPacket?.end ?? 0) * 1000 / timeline.rate;
          data.presentationMs = Number.isFinite(data.presentationMs)
            ? timeline.arrivalStartMs + data.presentationMs - timeline.arrivalSourceMs
            : timeline.lastPacket ? timeline.sourceAnchorMs + timeline.lastPacket.end * 1000 / timeline.rate : timeline.arrivalStartMs;
        } else if (!timeline.synchronized) {
          const previous = timeline.lastPacket;
          data.presentationMs = previous ? timeline.sourceAnchorMs + previous.end * 1000 / timeline.rate : this.targetTime(timeline, contextMs) ?? 0;
        }
        timeline.push(data, timeline.arrivalPlayback ? 1 : this.clock?.rate || 1, contextMs); return;
      }
      if (Number.isFinite(data.sourceTime)) {
        let timeline = this.timelines.get(data.type);
        if (!timeline || timeline.rate !== data.rate || timeline.channels !== data.channels || timeline.epoch !== data.epoch || data.flags & 2) {
          this.retireTimeline(timeline);
          // Realtime CarPlay media also arrives ahead of its negotiated playback time.
          const mediaWindow = data.mode === 'carplay' && purpose(data.type, data) === 0;
          timeline = new PcmTimeline(data.rate, data.channels,
            (consumed, reason) => this.credit(consumed, data.generation, reason, data.type),
            (data.flags & 1) || mediaWindow ? BUFFERED_AUDIO_WINDOW_MS : 1000, { buffered: Boolean(data.flags & 1) });
          timeline.debug(Boolean(this.diagnostics));
          timeline.epoch = data.epoch; this.timelines.set(data.type, timeline);
        }
        timeline.mode = data.mode; timeline.semanticType = data.semanticType ?? data.type;
        const legacy = this.streams.get(data.type);
        if (legacy) { for (const pcm of legacy.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', data.type); this.streams.delete(data.type); }
        timeline.push(data); return;
      }
      const timed = this.timelines.get(data.type);
      if (timed) { this.retireTimeline(timed); this.timelines.delete(data.type); }
      const maximum = data.rate * (data.flags & 1 ? 2 : 0.25);
      let stream = this.streams.get(data.type);
      if (!stream || stream.rate !== data.rate || stream.channels !== data.channels || data.flags & 2) {
        if (stream) for (const pcm of stream.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', data.type);
        stream = { rate: data.rate, channels: data.channels, semanticType: data.semanticType ?? data.type, queue: [], frames: 0, position: 0 };
        this.streams.set(data.type, stream);
      }
      const pcm = new Int16Array(data.pcm), frames = pcm.length / data.channels;
      pcm.generation = data.generation;
      // A broken producer cannot grow memory without bound; drop the oldest whole packet.
      while (stream.frames + frames > maximum && stream.queue.length) {
        const old = stream.queue.shift();
        stream.frames -= old.length / stream.channels; stream.position = 0;
        this.credit(old.byteLength, old.generation, 'capacity', data.type);
      }
      if (frames > maximum) { this.credit(pcm.byteLength, pcm.generation, 'capacity', data.type); return; }
      stream.queue.push(pcm); stream.frames += frames;
    };
  }
  credit(consumed, generation, reason, type) {
    if (this.diagnostics && consumed) {
      const counters = this.diagnostics.streams[type] ??= {};
      counters[reason + 'Packets'] = (counters[reason + 'Packets'] || 0) + 1;
      counters[reason + 'Bytes'] = (counters[reason + 'Bytes'] || 0) + consumed;
    }
    this.port.postMessage({ consumed, generation });
  }
  retireTimeline(timeline) {
    if (!timeline) return;
    if (timeline instanceof ContinuousAudio && timeline.last.some(value => value !== 0)) {
      // Keep only the bounded last sample and its conservative source identity.
      // A retired tail must obey its own mode's deadline after epoch replacement.
      this.retiring.push({ samples: timeline.last.slice(), remaining: timeline.fadeFrames, total: timeline.fadeFrames,
        type: timeline.type, semanticType: timeline.semanticType, mode: timeline.mode, epoch: timeline.epoch, generation: timeline.generation,
        sourceTimeMs: timeline.deadlineSourceMs, synchronized: timeline.synchronized, arrivalPlayback: timeline.arrivalPlayback,
        filterUncertaintyMs: timeline.filterUncertaintyMs });
      if (this.retiring.length > 16) this.retiring.shift();
    }
    timeline.clear();
  }
  report() {
    const metrics = this.diagnostics;
    if (!metrics) return;
    const renderedMs = this.renderContextMs();
    const { streams, ...scalars } = metrics, details = {};
    for (const type of new Set([...Object.keys(streams).map(Number), ...this.timelines.keys(), ...this.streams.keys(), ...this.retiredDeadlineReports.keys()])) {
      const timeline = this.timelines.get(type), legacy = this.streams.get(type);
      const fields = timeline ? { ...timeline.stats(), mode: timeline.mode, rate: timeline.rate, channels: timeline.channels, delayMs: timeline.delayMs ?? timeline.networkDelayMs }
        : { queueBytes: legacy?.queue.reduce((bytes, pcm) => bytes + pcm.byteLength, 0) ?? 0, queuePackets: legacy?.queue.length ?? 0, rate: legacy?.rate, channels: legacy?.channels };
      const { contextMs, ...retired } = this.retiredDeadlineReports.get(type) ?? {};
      details['stream' + type] = { ...fields, epoch: this.epochs.get(type), ...streams[type], ...retired,
        ...(Number.isFinite(contextMs) ? { lastRetiredSourceDeadlineAgeMs: Math.max(0, renderedMs - contextMs) } : {}) };
    }
    this.port.postMessage({ diagnosticRevision: this.diagnosticRevision, playbackGeneration: this.playbackGeneration,
      diagnostics: { ...scalars, ...details, renderTimeMs: renderedMs } });
  }
  renderContextMs() {
    // Integrate the actual emitted frame count. The main-thread/public time
    // getter can stall, batch or jump without moving this graph's sample cursor.
    if (Number.isSafeInteger(this.nextContextFrame) && this.nextContextFrame >= 0)
      return this.nextContextFrame * 1000 / sampleRate;
    if (typeof currentFrame === 'number' && Number.isSafeInteger(currentFrame) && currentFrame >= 0)
      return currentFrame * 1000 / sampleRate;
    // A counterless compatibility host starts in an unverified local domain.
    // Do not let a public time getter invent this domain's origin or slope.
    return 0;
  }
  arrivalTime(contextMs) {
    return this.arrivalAnchor ? this.arrivalAnchor.timeMs + (contextMs - this.arrivalAnchor.contextTimeMs) / this.deviceClock.rate : contextMs;
  }
  outputUncertainty(contextMs, frames = 0) {
    if (!this.contextAnchor || !Number.isFinite(this.outputUncertaintyMs)) return this.outputUncertaintyMs;
    const start = contextMs - this.contextAnchor.contextTimeMs, end = start + frames * 1000 / sampleRate;
    return this.outputUncertaintyMs + rateProjectionUncertainty(Math.max(Math.abs(start), Math.abs(end)), this.deviceClock.rate);
  }
  deadline(timeline, contextMs) {
    const outputAt = this.contextAnchor && this.contextAnchor.localTimeMs
      + (contextMs - this.contextAnchor.contextTimeMs) / this.deviceClock.rate;
    const unknownReason = timeline.arrivalPlayback ? 'arrival-anchored' : !timeline.synchronized ? 'source-anchor-unavailable'
      : this.renderDomainNextFrame === null ? 'output-clock-unavailable'
      : !this.contextAnchor || !Number.isFinite(this.outputUncertaintyMs) || this.outputMethod === 'latency-estimate' ? 'output-clock-unavailable'
      : !this.clock || this.clock.state === 'stale' ? 'source-clock-unavailable'
      : !Number.isFinite(this.clock.uncertaintyMs) ? 'clock-uncertainty-unavailable' : null;
    return unknownReason ? { unknownReason } : {
      outputAt, limitMs: audioLimit(timeline.mode),
      uncertaintyMs: Math.max(0, this.outputUncertaintyMs) + Math.max(0, this.clock.uncertaintyMs) + timeline.filterUncertaintyMs,
      projectionContextMs: contextMs - this.contextAnchor.contextTimeMs, projectionRate: this.deviceClock.rate,
    };
  }
  checkRetiredDeadline(tail, contextMs, blockFrames) {
    const frames = Math.min(tail.remaining, blockFrames), deadline = this.deadline(tail, contextMs);
    if (sourceDeadlineAt(deadline, tail.arrivalPlayback ? null : this.clock, tail.sourceTimeMs,
      frames * 1000 / sampleRate / this.deviceClock.rate, 0, tail)) return;
    if (this.diagnostics && Number.isInteger(tail.type) && tail.type >= 0 && tail.type <= 255) {
      const previous = this.retiredDeadlineReports.get(tail.type);
      this.retiredDeadlineReports.set(tail.type, {
        retiredSourceDeadlineRejectedFrames: (previous?.retiredSourceDeadlineRejectedFrames || 0) + tail.remaining,
        ...(Number.isSafeInteger(tail.epoch) ? { lastRetiredSourceDeadlineEpoch: tail.epoch } : {}),
        ...(Number.isSafeInteger(tail.generation) ? { lastRetiredSourceDeadlineGeneration: tail.generation } : {}),
        lastRetiredSourceDeadlineDeltaUpperMs: tail.sourceDeltaUpperMs,
        lastRetiredSourceDeadlineLimitMs: deadline.limitMs,
        lastRetiredSourceDeadlineUncertaintyMs: sourceDeadlineUncertainty(deadline, frames * 1000 / sampleRate / this.deviceClock.rate),
        contextMs,
      });
    }
    // All remaining samples hold the same old value. Discard its whole tail;
    // keeping the object cannot make that content younger at the next quantum.
    tail.remaining = 0;
  }
  targetTime(timeline, contextMs, frames = 0) {
    if (this.suspended) return null;
    if (timeline.arrivalPlayback) {
      const renderMs = this.arrivalTime(contextMs), target = renderMs - (timeline.arrivalDelayMs || 0), tail = timeline.queue.at(-1);
      if (!timeline.backend && tail && target >= timeline.sourceAnchorMs + tail.end * 1000 / timeline.rate) {
        // After a delivery pause the source may remain behind the render clock.
        // Re-prime from unplayed samples once, instead of chasing its moving tail.
        const firstFrame = Math.max(timeline.queue[0].first, Math.ceil(timeline.sourceFrame));
        const next = Math.max(timeline.rawCursorMs ?? -Infinity,
          timeline.sourceAnchorMs + firstFrame * 1000 / timeline.rate - timeline.filterDelayMs);
        timeline.arrivalDelayMs = renderMs - next + SPEECH_START_BUFFER_MS;
        return next - SPEECH_START_BUFFER_MS;
      }
      return target;
    }
    if (!this.contextAnchor) return null;
    const localMs = this.contextAnchor.localTimeMs + (contextMs - this.contextAnchor.contextTimeMs) / this.deviceClock.rate;
    const plans = this.plansByMode[timeline.mode] ?? this.delayPlans;
    // Reserve the resampler's phase-recovery window inside this track's own
    // deadline. Its actual emitted source cursor is checked separately below.
    const uncertainty = Math.max(0, this.outputUncertainty(contextMs, frames) || 0) + timeline.filterUncertaintyMs
      + Math.max(0, this.clock?.uncertaintyMs || 0);
    const latest = audioLimit(timeline.mode) - uncertainty - AUDIO_RECOVERY_ERROR_MS;
    const desired = plans.audio.to;
    if (timeline.mode === 'carplay' && isVoice(timeline.type, timeline) && timeline.synchronized) {
      const preparation = timeline.prepareVoice({ contextMs, frames, outputAt: localMs, clock: this.clock,
        deviceRate: this.deviceClock.rate, deadline: this.deadline(timeline, contextMs),
        minimumDelayMs: desired,
        admissionReserveMs: timeline.hasEmitted ? 0 : AUDIO_RECOVERY_ERROR_MS,
        waitMs: SPEECH_START_BUFFER_MS });
      return preparation.targetMs;
    }
    const proposed = Math.min(desired, latest);
    if (timeline.networkDelayMs === undefined) {
      timeline.networkDelayMs = proposed; timeline.networkPlanTargetMs = desired;
    } else if (Math.abs(proposed - timeline.networkDelayMs) >= 8
      && (!timeline.backend || Math.abs(desired - timeline.networkPlanTargetMs) >= 8)) {
      // A changing uncertainty reserve is not a new network plan and must not
      // discard a coherent live filter. Its actual emitted samples still pass
      // the full per-quantum source-age check below, including that uncertainty.
      timeline.networkDelayMs = proposed;
      timeline.networkPlanTargetMs = desired;
      if (timeline.backend) timeline.recover('network-buffer');
    }
    const delay = timeline.networkDelayMs;
    if (!timeline.synchronized) return localMs - delay;
    const clock = this.clock;
    if (!clock || !Number.isFinite(clock.localOriginMs) || !Number.isFinite(clock.serverOriginMs)) return null;
    // Origins are centered once on the main thread. PCM never receives a freshly remapped epoch timestamp.
    return clock.serverOriginMs + (localMs - delay - clock.localOriginMs) / (clock.rate || 1);
  }
  feedback(contextMs, renderQuantumFrames) {
    for (const timeline of this.timelines.values()) if (timeline instanceof ContinuousAudio) {
      const reference = timeline.reference(contextMs);
      reference.outputUncertaintyMs = this.outputUncertainty(contextMs);
      reference.renderQuantumFrames = renderQuantumFrames;
      reference.renderQuantumMaxFrames = this.renderQuantumMaxFrames;
      if ((!timeline.synchronized || timeline.sourceDeadlineState === 'unknown') && !timeline.arrivalPlayback && reference.state === 'playing') reference.state = 'untimed';
      reference.sequence = ++this.feedbackSequence;
      this.port.postMessage({ playout: reference });
    }
  }
  process(inputs, outputs) {
    const output = outputs[0];
    if (this.disposed) { for (const channel of output) channel.fill(0); return false; }
    const blockFrames = output[0].length;
    this.renderQuantumMaxFrames = Math.max(this.renderQuantumMaxFrames, blockFrames);
    const hardwareFrame = typeof currentFrame === 'number' ? currentFrame : null;
    const verifiedFrame = Number.isSafeInteger(blockFrames) && blockFrames > 0
      && typeof currentFrame === 'number' && Number.isSafeInteger(currentFrame) && currentFrame >= 0
      && Number.isSafeInteger(currentFrame + blockFrames);
    if (verifiedFrame) {
      if (this.renderDomainNextFrame !== null && hardwareFrame !== this.renderDomainNextFrame) {
        this.renderDomainGeneration++; this.renderDomainStartFrame = hardwareFrame;
      }
      this.renderDomainStartFrame ??= hardwareFrame;
      this.renderDomainNextFrame = hardwareFrame + blockFrames;
    } else {
      // An unavailable/unsafe counter cannot join two verified sample runs or
      // certify a probe. Continue the audio cursor without inventing evidence.
      if (this.renderDomainNextFrame !== null) this.renderDomainGeneration++;
      this.renderDomainStartFrame = this.renderDomainNextFrame = null;
    }
    // The strict measurement fence above does not change the established DSP
    // recovery allowance or restart a live filter for a one-block discrepancy.
    const audioFrame = Number.isSafeInteger(hardwareFrame) && hardwareFrame >= 0
      && Number.isSafeInteger(hardwareFrame + blockFrames);
    if (this.nextContextFrame === null) {
      const fallbackFrame = Math.round(this.renderContextMs() * sampleRate / 1000);
      this.nextContextFrame = audioFrame ? hardwareFrame
        : Number.isSafeInteger(fallbackFrame) && fallbackFrame >= 0 ? fallbackFrame : 0;
    }
    if (audioFrame && Math.abs(hardwareFrame - this.nextContextFrame) > blockFrames) {
      for (const timeline of this.timelines.values()) if (timeline instanceof ContinuousAudio) timeline.recover('device-clock-jump');
      this.nextContextFrame = hardwareFrame;
    }
    const contextMs = this.nextContextFrame * 1000 / sampleRate;
    this.nextContextFrame += blockFrames;
    this.renderedFrames += blockFrames;
    for (const channel of output) channel.fill(0);
    const continuous = this.continuous;
    let continuousCount = 0;
    for (const [type, timeline] of this.timelines) if (timeline instanceof ContinuousAudio) {
      if (!timeline.block || timeline.block.length < blockFrames * timeline.channels)
        timeline.block = new Float32Array(Math.max(512, blockFrames) * timeline.channels);
      const produced = timeline.render(this.targetTime(timeline, contextMs, blockFrames), contextMs, timeline.arrivalPlayback ? null : this.clock,
        blockFrames, timeline.block, this.deviceClock.rate, this.deadline(timeline, contextMs));
      const entry = timeline.mixerEntry ??= [type, timeline, 0];
      entry[2] = produced; continuous[continuousCount++] = entry;
    }
    continuous.length = continuousCount;
    for (const tail of this.retiring) if (tail.remaining > 0) this.checkRetiredDeadline(tail, contextMs, blockFrames);
    const bulkMix = !this.streams.size && continuous.length === this.timelines.size
      && this.kernel.supports(blockFrames, output.length);
    if (bulkMix) this.mediaGain = this.kernel.mix(continuous, this.retiring, output,
      this.mediaGain, this.mediaGainStep, this.diagnostics);
    else for (let i = 0; i < blockFrames; i++) {
      let voice = false;
      for (const [type, stream] of this.streams) {
        while (stream.queue.length && stream.position >= stream.queue[0].length / stream.channels) {
          const done = stream.queue.shift(), frames = done.length / stream.channels;
          stream.position -= frames; stream.frames -= frames;
          this.credit(done.byteLength, done.generation, 'played', type);
        }
        if (!stream.queue.length) stream.position = 0;
        else if (isVoice(type, stream)) voice = true;
      }
      for (const [type, timeline, produced] of continuous) if (isVoice(type, timeline)) {
        if (timeline.state === 'playing' || i < produced) voice = true;
        // render() may finish the quantum rebuffering while its output still
        // contains a voice fade. Keep media ducked for those actual samples.
        else for (let c = 0; c < timeline.channels; c++) if (timeline.block[i * timeline.channels + c]) voice = true;
      }
      for (const tail of this.retiring) if (tail.remaining > 0 && isVoice(tail.type, tail)) voice = true;
      if (this.clockBase !== null) {
        const wallTime = this.clockBase + contextMs + i * 1000 / sampleRate;
        for (const [type, timeline] of this.timelines) if (!(timeline instanceof ContinuousAudio)) {
          timeline.delayMs = audioDelayAt(this.plansByMode[timeline.mode] ?? this.delayPlans, wallTime);
          timeline.playbackTime = wallTime - timeline.delayMs;
          if (isVoice(type, timeline) && timeline.active(timeline.playbackTime)) voice = true;
        }
      }
      // Advance one shared envelope per emitted frame, independent of stream
      // count, channels and quantum size. A voice state edge must not multiply
      // a nonzero media waveform by 1 <-> 0.2 in a single sample.
      const targetGain = voice ? MEDIA_DUCK_GAIN : 1;
      this.mediaGain += Math.sign(targetGain - this.mediaGain) * Math.min(this.mediaGainStep, Math.abs(targetGain - this.mediaGain));
      for (const [type, stream] of this.streams) {
        const pcm = stream.queue[0];
        if (!pcm) continue;
        const frame = Math.floor(stream.position), fraction = stream.position - frame;
        for (let c = 0; c < output.length; c++) {
          const index = frame * stream.channels + Math.min(c, stream.channels - 1);
          const next = Math.min(index + stream.channels, pcm.length - stream.channels + Math.min(c, stream.channels - 1));
          output[c][i] += (pcm[index] + (pcm[next] - pcm[index]) * fraction) / 32768 * (isMedia(type, stream) ? this.mediaGain : 1);
        }
        stream.position += stream.rate / sampleRate;
      }
      for (const [type, timeline] of continuous) for (let c = 0; c < output.length; c++) {
        output[c][i] += timeline.block[i * timeline.channels + Math.min(c, timeline.channels - 1)] * (isMedia(type, timeline) ? this.mediaGain : 1);
      }
      for (const tail of this.retiring) if (tail.remaining > 0) {
        for (let c = 0; c < output.length; c++) output[c][i] += tail.samples[Math.min(c, tail.samples.length - 1)]
          * (tail.remaining - 1) / tail.total * (isMedia(tail.type, tail) ? this.mediaGain : 1);
        tail.remaining--;
      }
      if (this.clockBase !== null) for (const [type, timeline] of this.timelines) if (!(timeline instanceof ContinuousAudio))
        for (let c = 0; c < output.length; c++) output[c][i] += timeline.sample(timeline.playbackTime, c) * (isMedia(type, timeline) ? this.mediaGain : 1);
    }
    this.retiring = this.retiring.filter(tail => tail.remaining > 0);
    if (!bulkMix) for (const channel of output) for (let i = 0; i < channel.length; i++) {
      channel[i] = Math.max(-1, Math.min(1, channel[i]));
      if (this.diagnostics) {
        if (channel[i]) this.diagnostics.renderNonzero++;
        this.diagnostics.renderPeak = Math.max(this.diagnostics.renderPeak, Math.abs(channel[i]));
      }
    }
    if (this.diagnostics) {
      this.diagnostics.processCalls++; this.diagnostics.renderFrames += output[0].length;
      this.diagnostics.renderQuantumFrames = blockFrames;
      this.diagnostics.renderQuantumMinFrames = Math.min(this.diagnostics.renderQuantumMinFrames ?? blockFrames, blockFrames);
      this.diagnostics.renderQuantumMaxFrames = Math.max(this.diagnostics.renderQuantumMaxFrames ?? blockFrames, blockFrames);
      if (contextMs / 1000 - this.lastReportTime >= 0.5) { this.lastReportTime = contextMs / 1000; this.report(); }
    }
    if (continuous.length && (contextMs - this.lastFeedbackMs >= 40 || continuous.some(([, timeline]) => timeline.feedbackState !== timeline.state))) {
      this.feedback(contextMs + blockFrames * 1000 / sampleRate, blockFrames); this.lastFeedbackMs = contextMs;
      for (const [, timeline] of continuous) timeline.feedbackState = timeline.state;
    }
    if (verifiedFrame && this.pendingRenderProbe !== null) {
      this.port.postMessage({ renderProbe: { token: this.pendingRenderProbe, generation: this.renderDomainGeneration,
        startFrame: this.renderDomainStartFrame, endFrame: this.renderDomainNextFrame, renderQuantumFrames: blockFrames } });
      this.pendingRenderProbe = null;
    }
    return true;
  }
}
registerProcessor('tiplay-audio', TiPlayAudio);
