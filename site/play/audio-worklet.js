/*! SPDX-License-Identifier: GPL-3.0-only */
import { PcmTimeline } from './pcm-timeline.js';
import { initialPlaybackPlans, audioDelayAt, videoLimit } from './playback-window.js';
import { BUFFERED_AUDIO_WINDOW_MS } from './audio-buffer-policy.js';
import { SoxrRuntime } from './streaming-resampler.js';
import { ContinuousAudio } from './continuous-audio.js';

class TiPlayAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.timelines = new Map(); this.epochs = new Map(); this.delayPlans = initialPlaybackPlans(); this.clockBase = null;
    this.plansByMode = {};
    this.diagnostics = null; this.lastReportTime = -Infinity; this.diagnosticRevision = null;
    this.runtime = null; this.clock = null; this.contextAnchor = null; this.localTimeOriginMs = 0;
    this.renderedFrames = 0; this.feedbackSequence = 0; this.lastFeedbackMs = -Infinity; this.suspended = false;
    this.nextContextFrame = null; this.outputUncertaintyMs = 0;
    this.retiring = [];
    this.disposed = false;
    this.port.onmessage = ({ data }) => {
      if (this.disposed) return;
      if (data.dispose) {
        for (const timeline of this.timelines.values()) timeline.clear();
        this.timelines.clear();
        for (const [type, stream] of this.streams) for (const pcm of stream.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', type);
        this.streams.clear(); this.epochs.clear(); this.retiring = []; this.runtime = null; this.disposed = true;
        return;
      }
      if (data.resamplerModule) this.runtime = new SoxrRuntime(data.resamplerModule);
      if ('clock' in data) this.clock = data.clock;
      if ('contextAnchor' in data) this.contextAnchor = data.contextAnchor;
      if ('localTimeOriginMs' in data) this.localTimeOriginMs = data.localTimeOriginMs;
      if ('outputUncertaintyMs' in data) this.outputUncertaintyMs = data.outputUncertaintyMs;
      if ('suspended' in data) {
        if (data.suspended && !this.suspended) for (const timeline of this.timelines.values()) if (timeline instanceof ContinuousAudio) timeline.recover('suspended');
        this.suspended = data.suspended;
      }
      if (typeof data.debug === 'boolean') {
        this.diagnostics = data.debug ? { processCalls: 0, renderFrames: 0, renderNonzero: 0, renderPeak: 0, streams: {} } : null;
        this.diagnosticRevision = data.diagnosticRevision;
        this.lastReportTime = -Infinity;
        for (const timeline of this.timelines.values()) timeline.debug(data.debug);
      }
      if (data.plans) this.delayPlans = data.plans;
      if (data.plansByMode) this.plansByMode = data.plansByMode;
      if (data.clockBase !== undefined) this.clockBase = data.clockBase;
      if (data.reset) {
        for (const [type, stream] of this.streams) for (const pcm of stream.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', type);
        this.streams.clear();
        for (const timeline of this.timelines.values()) this.retireTimeline(timeline);
        this.timelines.clear();
        this.epochs.clear();
      }
      if (!data.pcm) return;
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
      if (this.runtime && !data.pcm.byteLength && data.flags & 2) {
        if (previousTimeline && previousEpoch === data.epoch) this.retireTimeline(previousTimeline);
        this.port.postMessage({ playout: { ...(previousTimeline instanceof ContinuousAudio ? previousTimeline.reference(currentTime * 1000) : {}),
          type: data.type, mode: data.mode, epoch: data.epoch, generation: data.generation,
          clockGeneration: this.clock?.generation, contextTimeMs: currentTime * 1000,
          state: data.ended === false ? 'priming' : 'ended', sequence: ++this.feedbackSequence } });
        this.timelines.delete(data.type); return;
      }
      if (this.runtime && (Number.isFinite(data.presentationMs) || !Number.isFinite(data.sourceTime))) {
        let timeline = this.timelines.get(data.type);
        if (!(timeline instanceof ContinuousAudio) || timeline.rate !== data.rate || timeline.channels !== data.channels || timeline.epoch !== data.epoch || data.flags & 2) {
          this.retireTimeline(timeline);
          const mediaWindow = data.mode === 'carplay' && data.type === 0;
          timeline = new ContinuousAudio(this.runtime, data.rate, data.channels, sampleRate,
            (bytes, reason, generation) => this.credit(bytes, generation, reason, data.type),
            (data.flags & 1) || mediaWindow ? BUFFERED_AUDIO_WINDOW_MS : 1000,
            { buffered: Boolean(data.flags & 1), mode: data.mode, type: data.type });
          timeline.debug(Boolean(this.diagnostics)); timeline.epoch = data.epoch; timeline.generation = data.generation;
          timeline.synchronized = Number.isFinite(data.presentationMs); this.timelines.set(data.type, timeline);
        }
        const legacy = this.streams.get(data.type);
        if (legacy) { for (const pcm of legacy.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', data.type); this.streams.delete(data.type); }
        if (!timeline.synchronized) {
          const previous = timeline.lastPacket;
          data.presentationMs = previous ? timeline.sourceAnchorMs + previous.end * 1000 / timeline.rate : this.targetTime(timeline, currentTime * 1000) ?? 0;
        }
        timeline.push(data, this.clock?.rate || 1); return;
      }
      if (this.clock?.version >= 2 && !this.runtime) {
        this.credit(data.pcm.byteLength, data.generation, 'invalid', data.type);
        this.port.postMessage({ error: 'Audio resampler is unavailable.' }); return;
      }
      if (Number.isFinite(data.sourceTime)) {
        let timeline = this.timelines.get(data.type);
        if (!timeline || timeline.rate !== data.rate || timeline.channels !== data.channels || timeline.epoch !== data.epoch || data.flags & 2) {
          this.retireTimeline(timeline);
          // Realtime CarPlay media also arrives ahead of its negotiated playback time.
          const mediaWindow = data.mode === 'carplay' && data.type === 0;
          timeline = new PcmTimeline(data.rate, data.channels,
            (consumed, reason) => this.credit(consumed, data.generation, reason, data.type),
            (data.flags & 1) || mediaWindow ? BUFFERED_AUDIO_WINDOW_MS : 1000, { buffered: Boolean(data.flags & 1) });
          timeline.debug(Boolean(this.diagnostics));
          timeline.epoch = data.epoch; this.timelines.set(data.type, timeline);
        }
        timeline.mode = data.mode;
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
        stream = { rate: data.rate, channels: data.channels, queue: [], frames: 0, position: 0 };
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
      this.retiring.push({ samples: timeline.last.slice(), remaining: timeline.fadeFrames, total: timeline.fadeFrames, type: timeline.type });
      if (this.retiring.length > 16) this.retiring.shift();
    }
    timeline.clear();
  }
  report() {
    const metrics = this.diagnostics;
    if (!metrics) return;
    const { streams, ...scalars } = metrics, details = {};
    for (const type of new Set([...Object.keys(streams).map(Number), ...this.timelines.keys(), ...this.streams.keys()])) {
      const timeline = this.timelines.get(type), legacy = this.streams.get(type);
      const fields = timeline ? { ...timeline.stats(), mode: timeline.mode, rate: timeline.rate, channels: timeline.channels, delayMs: timeline.delayMs ?? timeline.networkDelayMs }
        : { queueBytes: legacy?.queue.reduce((bytes, pcm) => bytes + pcm.byteLength, 0) ?? 0, queuePackets: legacy?.queue.length ?? 0, rate: legacy?.rate, channels: legacy?.channels };
      details['stream' + type] = { ...fields, epoch: this.epochs.get(type), ...streams[type] };
    }
    this.port.postMessage({ diagnosticRevision: this.diagnosticRevision, diagnostics: { ...scalars, ...details, renderTimeMs: currentTime * 1000 } });
  }
  targetTime(timeline, contextMs) {
    if (this.suspended || !this.contextAnchor) return null;
    const localMs = this.contextAnchor.localTimeMs + contextMs - this.contextAnchor.contextTimeMs;
    const plans = this.plansByMode[timeline.mode] ?? this.delayPlans;
    // Buffer adaptation establishes a new queue anchor. Clock drift alone changes ASRC rate.
    const videoTarget = Math.min(videoLimit(timeline.mode), plans.video.to);
    const stablePlans = { video: { from: videoTarget, to: videoTarget, at: 0, duration: 0 },
      audio: { from: plans.audio.to, to: plans.audio.to, at: 0, duration: 0 } };
    const uncertainty = Math.max(0, this.outputUncertaintyMs || 0) + timeline.filterUncertaintyMs;
    const at = localMs + this.localTimeOriginMs;
    const earliest = audioDelayAt({ ...stablePlans, audio: { from: -1e9, to: -1e9, at: 0, duration: 0 } }, at) + uncertainty;
    const latest = audioDelayAt({ ...stablePlans, audio: { from: 1e9, to: 1e9, at: 0, duration: 0 } }, at) - uncertainty;
    if (earliest > latest) {
      if (timeline.backend) timeline.recover('output-uncertainty');
      timeline.state = 'infeasible'; timeline.reason = 'output-uncertainty'; return null;
    }
    const proposed = Math.max(earliest, Math.min(latest, audioDelayAt(stablePlans, at)));
    if (timeline.networkDelayMs === undefined) timeline.networkDelayMs = proposed;
    else if (Math.abs(proposed - timeline.networkDelayMs) >= 8) {
      timeline.networkDelayMs = proposed;
      if (timeline.backend) timeline.recover('network-buffer');
    }
    const delay = timeline.networkDelayMs;
    if (!timeline.synchronized) return localMs - delay;
    const clock = this.clock;
    if (!clock || !Number.isFinite(clock.localOriginMs) || !Number.isFinite(clock.serverOriginMs)) return null;
    // Origins are centered once on the main thread. PCM never receives a freshly remapped epoch timestamp.
    return clock.serverOriginMs + (localMs - delay - clock.localOriginMs) / (clock.rate || 1);
  }
  feedback(contextMs) {
    for (const timeline of this.timelines.values()) if (timeline instanceof ContinuousAudio) {
      const reference = timeline.reference(contextMs);
      reference.outputUncertaintyMs = this.outputUncertaintyMs;
      if (!timeline.synchronized && reference.state === 'playing') reference.state = 'untimed';
      reference.sequence = ++this.feedbackSequence;
      this.port.postMessage({ playout: reference });
    }
  }
  process(inputs, outputs) {
    const output = outputs[0];
    if (this.disposed) { for (const channel of output) channel.fill(0); return false; }
    const blockFrames = output[0].length;
    const hardwareFrame = typeof currentFrame === 'number' ? currentFrame : Math.round(currentTime * sampleRate);
    if (this.nextContextFrame === null) this.nextContextFrame = hardwareFrame;
    if (Math.abs(hardwareFrame - this.nextContextFrame) > blockFrames) {
      for (const timeline of this.timelines.values()) if (timeline instanceof ContinuousAudio) timeline.recover('device-clock-jump');
      this.nextContextFrame = hardwareFrame;
    }
    const contextMs = this.nextContextFrame * 1000 / sampleRate;
    this.nextContextFrame += blockFrames;
    this.renderedFrames += blockFrames;
    for (const channel of output) channel.fill(0);
    let voiceActive = false;
    for (const [type, stream] of this.streams) if (type >= 1 && type <= 4 && stream.queue.length > 0) { voiceActive = true; break; }
    for (const [type, stream] of this.streams) {
      const gain = (type === 0 || type === 6) && voiceActive ? 0.2 : 1;
      const step = stream.rate / sampleRate;
      for (let i = 0; i < output[0].length; i++) {
        while (stream.queue.length && stream.position >= stream.queue[0].length / stream.channels) {
          const done = stream.queue.shift(), frames = done.length / stream.channels;
          stream.position -= frames; stream.frames -= frames;
          this.credit(done.byteLength, done.generation, 'played', type);
        }
        const pcm = stream.queue[0];
        if (!pcm) { stream.position = 0; break; }
        const frame = Math.floor(stream.position), fraction = stream.position - frame;
        for (let c = 0; c < output.length; c++) {
          const index = frame * stream.channels + Math.min(c, stream.channels - 1);
          const next = Math.min(index + stream.channels, pcm.length - stream.channels + Math.min(c, stream.channels - 1));
          output[c][i] += gain * (pcm[index] + (pcm[next] - pcm[index]) * fraction) / 32768;
        }
        stream.position += step;
      }
    }
    const continuous = [];
    for (const [type, timeline] of this.timelines) if (timeline instanceof ContinuousAudio) {
      timeline.block ??= new Float32Array(512 * timeline.channels);
      timeline.render(this.targetTime(timeline, contextMs), contextMs, this.clock, blockFrames, timeline.block);
      continuous.push([type, timeline]);
    }
    for (let i = 0; i < blockFrames; i++) {
      let voice = voiceActive;
      for (const [type, timeline] of continuous) if (type >= 1 && type <= 4 && timeline.state === 'playing') voice = true;
      for (const [type, timeline] of continuous) for (let c = 0; c < output.length; c++) {
        output[c][i] += timeline.block[i * timeline.channels + Math.min(c, timeline.channels - 1)] * ((type === 0 || type === 6) && voice ? 0.2 : 1);
      }
      for (const tail of this.retiring) if (tail.remaining > 0) {
        for (let c = 0; c < output.length; c++) output[c][i] += tail.samples[Math.min(c, tail.samples.length - 1)]
          * (tail.remaining - 1) / tail.total * ((tail.type === 0 || tail.type === 6) && voice ? 0.2 : 1);
        tail.remaining--;
      }
    }
    this.retiring = this.retiring.filter(tail => tail.remaining > 0);
    if (this.clockBase !== null) for (let i = 0; i < output[0].length; i++) {
      const wallTime = this.clockBase + (currentTime + i / sampleRate) * 1000;
      let voice = voiceActive;
      for (const [type, timeline] of this.timelines) {
        if (timeline instanceof ContinuousAudio) continue;
        timeline.delayMs = audioDelayAt(this.plansByMode[timeline.mode] ?? this.delayPlans, wallTime);
        timeline.playbackTime = wallTime - timeline.delayMs;
        if (type >= 1 && type <= 4 && timeline.active(timeline.playbackTime)) voice = true;
      }
      for (const [type, timeline] of this.timelines) if (!(timeline instanceof ContinuousAudio)) for (let c = 0; c < output.length; c++) output[c][i] += timeline.sample(timeline.playbackTime, c) * ((type === 0 || type === 6) && voice ? 0.2 : 1);
    }
    for (const channel of output) for (let i = 0; i < channel.length; i++) {
      channel[i] = Math.max(-1, Math.min(1, channel[i]));
      if (this.diagnostics) {
        if (channel[i]) this.diagnostics.renderNonzero++;
        this.diagnostics.renderPeak = Math.max(this.diagnostics.renderPeak, Math.abs(channel[i]));
      }
    }
    if (this.diagnostics) {
      this.diagnostics.processCalls++; this.diagnostics.renderFrames += output[0].length;
      if (currentTime - this.lastReportTime >= 0.5) { this.lastReportTime = currentTime; this.report(); }
    }
    if (continuous.length && (contextMs - this.lastFeedbackMs >= 40 || continuous.some(([, timeline]) => timeline.feedbackState !== timeline.state))) {
      this.feedback(contextMs + blockFrames * 1000 / sampleRate); this.lastFeedbackMs = contextMs;
      for (const [, timeline] of continuous) timeline.feedbackState = timeline.state;
    }
    return true;
  }
}
registerProcessor('tiplay-audio', TiPlayAudio);
