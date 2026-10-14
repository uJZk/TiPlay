// SPDX-License-Identifier: GPL-3.0-only

/** Web Audio's speaker downmix for its defined mono, stereo, quad and 5.1 layouts. */
export function downmixStereo(channels) {
  if (!channels.length || channels.some(channel => channel.length !== channels[0].length)) {
    throw new TypeError('Audio channels must contain equally sized sample arrays.');
  }
  if (channels.length === 1) return [channels[0], channels[0]];
  if (channels.length === 2) return channels;
  if (channels.length !== 4 && channels.length !== 6) {
    throw new DOMException('Pitch-preserving playback supports mono, stereo, quad and 5.1 audio layouts.', 'NotSupportedError');
  }
  const left = new Float32Array(channels[0].length), right = new Float32Array(channels[0].length);
  for (let i = 0; i < left.length; i++) {
    if (channels.length === 4) {
      left[i] = (channels[0][i] + channels[2][i]) * 0.5;
      right[i] = (channels[1][i] + channels[3][i]) * 0.5;
    } else {
      // Match Web Audio's 1x speaker mix: L/R + sqrt(1/2) × (C + SL/SR); LFE is omitted.
      // Keep float headroom instead of clipping or changing gain when the user changes speed.
      left[i] = channels[0][i] + Math.SQRT1_2 * (channels[2][i] + channels[4][i]);
      right[i] = channels[1][i] + Math.SQRT1_2 * (channels[2][i] + channels[5][i]);
    }
  }
  return [left, right];
}

/** A continuous WSOLA stream. Its tempo changes time without resampling the waveform's pitch. */
export function createTempoProcessor(core, sampleRate, rate) {
  if (rate === 1) return null;
  if (!core?.Stretch) throw new Error('Pitch-preserving audio playback is unavailable.');
  const stretch = new core.Stretch({ sampleRate, createBuffers: true });
  stretch.tempo = rate;
  let inputFrames = 0, outputFrames = 0, closed = false;
  function extract(limit = Infinity) {
    const frames = Math.min(stretch.outputBuffer.frameCount, limit);
    if (frames < 1) return null;
    const samples = new Float32Array(frames * 2);
    stretch.outputBuffer.extract(samples, 0, frames);
    stretch.outputBuffer.receive(frames);
    outputFrames += frames;
    return samples;
  }
  return {
    push(left, right = left) {
      if (closed) throw new Error('The tempo processor is closed.');
      const samples = new Float32Array(left.length * 2);
      for (let i = 0; i < left.length; i++) { samples[i * 2] = left[i]; samples[i * 2 + 1] = right[i]; }
      inputFrames += left.length;
      stretch.inputBuffer.putSamples(samples);
      stretch.process();
      return extract();
    },
    finish() {
      if (closed) return null;
      // WSOLA needs lookahead. Pad its last window, then expose only the source's true duration.
      const remaining = Math.max(0, Math.round(inputFrames / rate) - outputFrames);
      const padding = Math.max(stretch.sampleReq * 2, Math.ceil(sampleRate * 0.3 * Math.max(1, rate)));
      stretch.inputBuffer.putSamples(new Float32Array(padding * 2));
      stretch.process();
      const samples = extract(remaining);
      closed = true; stretch.clear();
      return samples;
    },
    dispose() { closed = true; stretch.clear(); },
  };
}
