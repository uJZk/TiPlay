/*! SPDX-License-Identifier: GPL-3.0-only */
import { PcmCapture } from './audio-protocol.js';

class TiPlayAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.capture = null;
    this.port.onmessage = ({ data }) => {
      if (data.reset) this.streams.clear();
      if (data.captureRate !== undefined) this.capture = data.captureRate
        ? new PcmCapture(sampleRate, data.captureRate, pcm => this.port.postMessage({ microphone: pcm }, [pcm])) : null;
      if (!data.pcm) return;
      const maximum = data.rate * (data.flags & 1 ? 2 : 0.25);
      let stream = this.streams.get(data.type);
      if (!stream || stream.rate !== data.rate || stream.channels !== data.channels || data.flags & 2) {
        if (stream) for (const pcm of stream.queue) this.port.postMessage({ consumed: pcm.byteLength });
        stream = { rate: data.rate, channels: data.channels, queue: [], frames: 0, position: 0 };
        this.streams.set(data.type, stream);
      }
      const pcm = new Int16Array(data.pcm), frames = pcm.length / data.channels;
      // A broken producer cannot grow memory without bound; drop the oldest whole packet.
      while (stream.frames + frames > maximum && stream.queue.length) {
        const old = stream.queue.shift();
        stream.frames -= old.length / stream.channels; stream.position = 0;
        this.port.postMessage({ consumed: old.byteLength });
      }
      if (frames > maximum) { this.port.postMessage({ consumed: pcm.byteLength }); return; }
      stream.queue.push(pcm); stream.frames += frames;
    };
  }
  process(inputs, outputs) {
    const output = outputs[0];
    for (const channel of output) channel.fill(0);
    let voiceActive = false;
    for (const [type, stream] of this.streams) if (type !== 0 && stream.queue.length > 0) { voiceActive = true; break; }
    for (const [type, stream] of this.streams) {
      const gain = type === 0 && voiceActive ? 0.2 : 1;
      const step = stream.rate / sampleRate;
      for (let i = 0; i < output[0].length; i++) {
        while (stream.queue.length && stream.position >= stream.queue[0].length / stream.channels) {
          const done = stream.queue.shift(), frames = done.length / stream.channels;
          stream.position -= frames; stream.frames -= frames;
          this.port.postMessage({ consumed: done.byteLength });
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
    for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i] = Math.max(-1, Math.min(1, channel[i]));
    if (this.capture && inputs[0]?.[0]) this.capture.push(inputs[0][0]);
    return true;
  }
}
registerProcessor('tiplay-audio', TiPlayAudio);
