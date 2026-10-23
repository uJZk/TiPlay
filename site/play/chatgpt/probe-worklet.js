/*! SPDX-License-Identifier: GPL-3.0-only */
class ClockProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0; this.blocks = 0; this.expected = null; this.generation = 0;
    this.runStart = null; this.minQuantum = Infinity; this.maxQuantum = 0;
    this.discontinuities = 0; this.lastReport = -Infinity; this.pending = null;
    this.gain = .02; this.targetGain = .02; this.phase = 0; this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (Number.isSafeInteger(data?.probe) && data.probe > 0) this.pending = data.probe;
      if (typeof data?.tone === 'boolean') this.targetGain = data.tone ? .02 : 0;
      if (data?.stop) this.stopped = true;
    };
  }
  process(_, outputs) {
    const channels = outputs[0], count = channels[0]?.length || 0;
    if (this.stopped) { for (const channel of channels) channel.fill(0); return false; }
    const start = currentFrame, valid = Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(start + count);
    let changed = false;
    if (valid) {
      if (this.expected !== null && start !== this.expected) { this.discontinuities++; this.generation++; changed = true; this.runStart = start; }
      if (this.runStart === null) this.runStart = start;
      this.expected = start + count;
    }
    const state = { frame: valid ? start : null, endFrame: valid ? start + count : null,
      totalFrames: this.frames, blocks: this.blocks, generation: this.generation,
      runStart: this.runStart, discontinuities: this.discontinuities, quantum: count,
      minQuantum: Math.min(this.minQuantum, count), maxQuantum: Math.max(this.maxQuantum, count) };
    if (this.pending !== null) { this.port.postMessage({ probe: this.pending, ...state }); this.pending = null; }
    if (this.frames - this.lastReport >= sampleRate * .04 || changed) {
      this.lastReport = this.frames; this.port.postMessage({ report: true, ...state });
    }
    const increment = 2 * Math.PI * 440 / sampleRate, gainStep = .02 / Math.max(1, Math.round(sampleRate * .005));
    for (let i = 0; i < count; i++) {
      this.gain += Math.sign(this.targetGain - this.gain) * Math.min(gainStep, Math.abs(this.targetGain - this.gain));
      const value = Math.sin(this.phase) * this.gain;
      this.phase = (this.phase + increment) % (2 * Math.PI);
      for (const channel of channels) channel[i] = value;
    }
    this.frames += count; this.blocks++; this.minQuantum = Math.min(this.minQuantum, count); this.maxQuantum = Math.max(this.maxQuantum, count);
    return true;
  }
}
registerProcessor('clock-probe', ClockProbe);
