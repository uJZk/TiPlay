// SPDX-License-Identifier: GPL-3.0-only
// Optional observation tap. Signal runs using it are not CPU benchmark runs.
class CaptureOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096 * 2); this.frames = 0; this.firstFrame = null;
    this.port.onmessage = ({ data }) => {
      if (data.flush) { this.flush(); this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (!this.frames) return;
    const pcm = this.buffer.slice(0, this.frames * 2);
    this.port.postMessage({ startFrame: this.firstFrame, frames: this.frames, pcm: pcm.buffer }, [pcm.buffer]);
    this.frames = 0; this.firstFrame = null;
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0], count = output[0].length;
    if (this.firstFrame !== null && this.firstFrame + this.frames !== currentFrame) this.flush();
    for (let c = 0; c < output.length; c++) {
      if (input[c]) output[c].set(input[c]);
      else output[c].fill(0);
    }
    for (let i = 0; i < count; i++) {
      this.firstFrame ??= currentFrame + i;
      this.buffer[this.frames * 2] = output[0][i];
      this.buffer[this.frames * 2 + 1] = output[1]?.[i] ?? output[0][i];
      if (++this.frames === 4096) this.flush();
    }
    return true;
  }
}
registerProcessor('capture-output', CaptureOutput);
