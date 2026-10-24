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
  const frontLeft = channels[0], frontRight = channels[1], third = channels[2];
  const left = new Float32Array(frontLeft.length), right = new Float32Array(frontLeft.length);
  // This is the short-block/non-SIMD path. Hoist channel lookup and layout selection
  // out of the numeric loop; crossing the WASM boundary costs more on short blocks.
  if (channels.length === 4) {
    const fourth = channels[3];
    for (let i = 0; i < left.length; i++) {
      left[i] = (frontLeft[i] + third[i]) * 0.5;
      right[i] = (frontRight[i] + fourth[i]) * 0.5;
    }
  } else {
    const surroundLeft = channels[4], surroundRight = channels[5];
    // Match Web Audio's 1x speaker mix: L/R + sqrt(1/2) × (C + SL/SR); LFE is omitted.
    // Keep float headroom instead of clipping or changing gain when the user changes speed.
    for (let i = 0; i < left.length; i++) {
      left[i] = frontLeft[i] + Math.SQRT1_2 * (third[i] + surroundLeft[i]);
      right[i] = frontRight[i] + Math.SQRT1_2 * (third[i] + surroundRight[i]);
    }
  }
  return [left, right];
}

/** SoundTouch's continuous WSOLA engine changes time while retaining waveform pitch. */
export function createTempoProcessor(core, sampleRate, rate) {
  if (rate === 1) return null;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      !Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new TypeError('Invalid tempo format.');
  if (core?.create) return Object.assign(core.create(sampleRate, rate), { backend: core.backend });
  if (!core?.Stretch) throw new Error('Pitch-preserving audio playback is unavailable.');
  // Portable WASM loses to the existing JS engine on some fast-tempo blocks.
  // Retain this mature implementation only for browsers without WASM SIMD.
  const stretch = new core.Stretch({ sampleRate, createBuffers: true });
  stretch.tempo = rate;
  let inputFrames = 0, outputFrames = 0, closed = false;
  function extract(limit = Infinity) {
    const frames = Math.min(stretch.outputBuffer.frameCount, limit);
    if (frames < 1) return null;
    const samples = new Float32Array(frames * 2);
    stretch.outputBuffer.extract(samples, 0, frames);
    stretch.outputBuffer.receive(frames); outputFrames += frames;
    return samples;
  }
  return {
    backend: 'soundtouchjs',
    push(left, right = left) {
      if (closed) throw new Error('The tempo processor is closed.');
      if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length)
        throw new TypeError('Audio channels must contain equally sized Float32 arrays.');
      const samples = new Float32Array(left.length * 2);
      for (let i = 0; i < left.length; i++) { samples[i * 2] = left[i]; samples[i * 2 + 1] = right[i]; }
      inputFrames += left.length; stretch.inputBuffer.putSamples(samples); stretch.process();
      return extract();
    },
    finish() {
      if (closed) return null;
      const remaining = Math.max(0, Math.round(inputFrames / rate) - outputFrames);
      const padding = Math.max(stretch.sampleReq * 2, Math.ceil(sampleRate * 0.3 * Math.max(1, rate)));
      stretch.inputBuffer.putSamples(new Float32Array(padding * 2)); stretch.process();
      const samples = extract(remaining); closed = true; stretch.clear(); return samples;
    },
    dispose() { closed = true; stretch.clear(); },
  };
}
