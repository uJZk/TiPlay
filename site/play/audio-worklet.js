/*! SPDX-License-Identifier: GPL-3.0-only */
import { PcmTimeline } from './pcm-timeline.js';
import { initialPlaybackPlans, audioDelayAt } from './playback-window.js';

class TiPlayAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.timelines = new Map(); this.epochs = new Map(); this.delayPlans = initialPlaybackPlans(); this.clockBase = null;
    this.plansByMode = {};
    this.muted = false;
    this.port.onmessage = ({ data }) => {
      if (data.plans) this.delayPlans = data.plans;
      if (data.plansByMode) this.plansByMode = data.plansByMode;
      if (data.clockBase !== undefined) this.clockBase = data.clockBase;
      if (data.muted !== undefined) this.muted = Boolean(data.muted);
      if (data.reset || data.muted === true) {
        for (const stream of this.streams.values()) for (const pcm of stream.queue) this.port.postMessage({ consumed: pcm.byteLength, generation: pcm.generation });
        this.streams.clear();
        for (const timeline of this.timelines.values()) timeline.clear();
        this.timelines.clear();
        this.epochs.clear();
      }
      if (!data.pcm) return;
      if (this.muted) { this.port.postMessage({ consumed: data.pcm.byteLength, generation: data.generation }); return; }
      const previousEpoch = this.epochs.get(data.type);
      if (previousEpoch !== undefined && ((data.epoch - previousEpoch) | 0) < 0) { this.port.postMessage({ consumed: data.pcm.byteLength, generation: data.generation }); return; }
      if (previousEpoch !== undefined && previousEpoch !== data.epoch) {
        this.timelines.get(data.type)?.clear(); this.timelines.delete(data.type);
        const legacy = this.streams.get(data.type);
        if (legacy) for (const pcm of legacy.queue) this.port.postMessage({ consumed: pcm.byteLength, generation: pcm.generation });
        this.streams.delete(data.type);
      }
      this.epochs.set(data.type, data.epoch);
      if (Number.isFinite(data.sourceTime)) {
        let timeline = this.timelines.get(data.type);
        if (!timeline || timeline.rate !== data.rate || timeline.channels !== data.channels || timeline.epoch !== data.epoch || data.flags & 2) {
          timeline?.clear();
          timeline = new PcmTimeline(data.rate, data.channels, consumed => this.port.postMessage({ consumed, generation: data.generation }), data.flags & 1 ? 2500 : 1000);
          timeline.epoch = data.epoch; this.timelines.set(data.type, timeline);
        }
        timeline.mode = data.mode;
        const legacy = this.streams.get(data.type);
        if (legacy) { for (const pcm of legacy.queue) this.port.postMessage({ consumed: pcm.byteLength, generation: pcm.generation }); this.streams.delete(data.type); }
        timeline.push(data); return;
      }
      const timed = this.timelines.get(data.type);
      if (timed) { timed.clear(); this.timelines.delete(data.type); }
      const maximum = data.rate * (data.flags & 1 ? 2 : 0.25);
      let stream = this.streams.get(data.type);
      if (!stream || stream.rate !== data.rate || stream.channels !== data.channels || data.flags & 2) {
        if (stream) for (const pcm of stream.queue) this.port.postMessage({ consumed: pcm.byteLength, generation: pcm.generation });
        stream = { rate: data.rate, channels: data.channels, queue: [], frames: 0, position: 0 };
        this.streams.set(data.type, stream);
      }
      const pcm = new Int16Array(data.pcm), frames = pcm.length / data.channels;
      pcm.generation = data.generation;
      // A broken producer cannot grow memory without bound; drop the oldest whole packet.
      while (stream.frames + frames > maximum && stream.queue.length) {
        const old = stream.queue.shift();
        stream.frames -= old.length / stream.channels; stream.position = 0;
        this.port.postMessage({ consumed: old.byteLength, generation: old.generation });
      }
      if (frames > maximum) { this.port.postMessage({ consumed: pcm.byteLength, generation: pcm.generation }); return; }
      stream.queue.push(pcm); stream.frames += frames;
    };
  }
  process(inputs, outputs) {
    const output = outputs[0];
    for (const channel of output) channel.fill(0);
    if (this.muted) return true;
    let voiceActive = false;
    for (const [type, stream] of this.streams) if (type >= 1 && type <= 4 && stream.queue.length > 0) { voiceActive = true; break; }
    for (const [type, stream] of this.streams) {
      const gain = (type === 0 || type === 6) && voiceActive ? 0.2 : 1;
      const step = stream.rate / sampleRate;
      for (let i = 0; i < output[0].length; i++) {
        while (stream.queue.length && stream.position >= stream.queue[0].length / stream.channels) {
          const done = stream.queue.shift(), frames = done.length / stream.channels;
          stream.position -= frames; stream.frames -= frames;
          this.port.postMessage({ consumed: done.byteLength, generation: done.generation });
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
        timeline.playbackTime = wallTime - audioDelayAt(this.plansByMode[timeline.mode] ?? this.delayPlans, wallTime);
        if (type >= 1 && type <= 4 && timeline.active(timeline.playbackTime)) voice = true;
      }
      for (const [type, timeline] of this.timelines) for (let c = 0; c < output.length; c++) output[c][i] += timeline.sample(timeline.playbackTime, c) * ((type === 0 || type === 6) && voice ? 0.2 : 1);
    }
    for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i] = Math.max(-1, Math.min(1, channel[i]));
    return true;
  }
}
registerProcessor('tiplay-audio', TiPlayAudio);
