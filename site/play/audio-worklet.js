/*! SPDX-License-Identifier: GPL-3.0-only */
import { PcmTimeline } from './pcm-timeline.js';
import { initialPlaybackPlans, audioDelayAt } from './playback-window.js';
import { BUFFERED_AUDIO_WINDOW_MS } from './audio-buffer-policy.js';

class TiPlayAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.timelines = new Map(); this.epochs = new Map(); this.delayPlans = initialPlaybackPlans(); this.clockBase = null;
    this.plansByMode = {};
    this.diagnostics = null; this.lastReportTime = -Infinity; this.diagnosticRevision = null;
    this.port.onmessage = ({ data }) => {
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
        for (const timeline of this.timelines.values()) timeline.clear();
        this.timelines.clear();
        this.epochs.clear();
      }
      if (!data.pcm) return;
      const previousEpoch = this.epochs.get(data.type);
      if (previousEpoch !== undefined && ((data.epoch - previousEpoch) | 0) < 0) { this.credit(data.pcm.byteLength, data.generation, 'late', data.type); return; }
      if (previousEpoch !== undefined && previousEpoch !== data.epoch) {
        this.timelines.get(data.type)?.clear(); this.timelines.delete(data.type);
        const legacy = this.streams.get(data.type);
        if (legacy) for (const pcm of legacy.queue) this.credit(pcm.byteLength, pcm.generation, 'reset', data.type);
        this.streams.delete(data.type);
      }
      this.epochs.set(data.type, data.epoch);
      if (Number.isFinite(data.sourceTime)) {
        let timeline = this.timelines.get(data.type);
        if (!timeline || timeline.rate !== data.rate || timeline.channels !== data.channels || timeline.epoch !== data.epoch || data.flags & 2) {
          timeline?.clear();
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
      if (timed) { timed.clear(); this.timelines.delete(data.type); }
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
  report() {
    const metrics = this.diagnostics;
    if (!metrics) return;
    const { streams, ...scalars } = metrics, details = {};
    for (const type of new Set([...Object.keys(streams).map(Number), ...this.timelines.keys(), ...this.streams.keys()])) {
      const timeline = this.timelines.get(type), legacy = this.streams.get(type);
      const fields = timeline ? { ...timeline.stats(), mode: timeline.mode, rate: timeline.rate, channels: timeline.channels, delayMs: timeline.delayMs }
        : { queueBytes: legacy?.queue.reduce((bytes, pcm) => bytes + pcm.byteLength, 0) ?? 0, queuePackets: legacy?.queue.length ?? 0, rate: legacy?.rate, channels: legacy?.channels };
      details['stream' + type] = { ...fields, epoch: this.epochs.get(type), ...streams[type] };
    }
    this.port.postMessage({ diagnosticRevision: this.diagnosticRevision, diagnostics: { ...scalars, ...details, renderTimeMs: currentTime * 1000 } });
  }
  process(inputs, outputs) {
    const output = outputs[0];
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
    if (this.clockBase !== null) for (let i = 0; i < output[0].length; i++) {
      const wallTime = this.clockBase + (currentTime + i / sampleRate) * 1000;
      let voice = voiceActive;
      for (const [type, timeline] of this.timelines) {
        timeline.delayMs = audioDelayAt(this.plansByMode[timeline.mode] ?? this.delayPlans, wallTime);
        timeline.playbackTime = wallTime - timeline.delayMs;
        if (type >= 1 && type <= 4 && timeline.active(timeline.playbackTime)) voice = true;
      }
      for (const [type, timeline] of this.timelines) for (let c = 0; c < output.length; c++) output[c][i] += timeline.sample(timeline.playbackTime, c) * ((type === 0 || type === 6) && voice ? 0.2 : 1);
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
    return true;
  }
}
registerProcessor('tiplay-audio', TiPlayAudio);
