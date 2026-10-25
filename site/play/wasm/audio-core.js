/*! SPDX-License-Identifier: GPL-3.0-only */
const MAX_FRAMES = 4096, MAX_CHANNELS = 8, MAX_SAMPLES = MAX_FRAMES * MAX_CHANNELS;
let preparedModule, loading, signalKernel;

export function prepareAudioCore(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('Invalid audio core module.');
  preparedModule = module;
  signalKernel = undefined;
  return module;
}

/** Main-thread PCM conversion and diagnostics share one scratch arena. */
export function audioSignalKernel() { return signalKernel ??= new AudioKernel(); }

/** Compile away from the render thread; pass the module through processorOptions. */
export function loadAudioCore() {
  if (preparedModule) return Promise.resolve(preparedModule);
  return loading ??= (async () => {
    const response = await fetch(new URL('audio-core.wasm', import.meta.url));
    if (!response.ok) throw new Error('Audio core could not be loaded.');
    return prepareAudioCore(await WebAssembly.compile(await response.arrayBuffer()));
  })().catch(error => { loading = null; throw error; });
}

/** One fixed, private scratch arena per audio runtime. Calls never grow memory. */
export class AudioKernel {
  constructor(module = preparedModule) {
    if (!module) throw new Error('Audio core was not prepared.');
    this.api = new WebAssembly.Instance(module).exports;
    this.input16 = new Int16Array(this.api.memory.buffer, this.api.audio_input16(), MAX_SAMPLES);
    this.input = new Float32Array(this.api.memory.buffer, this.api.audio_input(), MAX_SAMPLES);
    this.inputBytes = new Uint8Array(this.api.memory.buffer, this.api.audio_input(), MAX_SAMPLES * 4);
    this.output = new Float32Array(this.api.memory.buffer, this.api.audio_output(), MAX_SAMPLES);
    this.last = new Float32Array(this.api.memory.buffer, this.api.audio_last(), MAX_CHANNELS);
    this.recovery = new Float32Array(this.api.memory.buffer, this.api.audio_recovery(), MAX_CHANNELS);
  }
  supports(frames, channels) {
    return Number.isSafeInteger(frames) && frames > 0
      && Number.isInteger(channels) && channels > 0 && channels <= MAX_CHANNELS;
  }
  pcm16(input, start, output, offset, samples) {
    if (!Number.isInteger(samples) || samples < 0 || samples > MAX_SAMPLES)
      throw new RangeError('PCM conversion exceeds audio core capacity.');
    // At this size copying across the WASM boundary costs more than conversion.
    if (samples < 256) {
      for (let i = 0; i < samples; i++) output[offset + i] = input[start + i] / 32768;
      return;
    }
    this.input16.set(input.subarray(start, start + samples));
    this.api.audio_pcm16(samples);
    output.set(this.output.subarray(0, samples), offset);
  }
  unpack(bytes, width, littleEndian) {
    const output = new Int16Array(bytes.length / width);
    for (let offset = 0; offset < output.length; offset += MAX_SAMPLES) {
      const count = Math.min(MAX_SAMPLES, output.length - offset);
      this.inputBytes.set(bytes.subarray(offset * width, (offset + count) * width));
      this.api.audio_unpack(count, width, Boolean(littleEndian));
      output.set(this.input16.subarray(0, count), offset);
    }
    return output.buffer;
  }
  quantize(data, output) {
    const channels = data.numberOfChannels, capacity = Math.floor(MAX_SAMPLES / channels);
    for (let offset = 0; offset < data.numberOfFrames; offset += capacity) {
      const count = Math.min(capacity, data.numberOfFrames - offset);
      for (let channel = 0; channel < channels; channel++) {
        data.copyTo(this.input.subarray(channel * count, (channel + 1) * count), { planeIndex: channel, format: 'f32-planar',
          frameOffset: offset, frameCount: count });
      }
      this.api.audio_quantize_planar(count, channels);
      output.set(this.input16.subarray(0, count * channels), offset * channels);
    }
  }
  scanPcm(pcm) {
    let nonzero = 0, peak = 0;
    for (let offset = 0; offset < pcm.length; offset += MAX_SAMPLES) {
      const count = Math.min(MAX_SAMPLES, pcm.length - offset);
      this.input16.set(pcm.subarray(offset, offset + count));
      this.api.audio_scan16(count);
      nonzero += this.api.audio_nonzero(); peak = Math.max(peak, this.api.audio_peak());
    }
    return { nonzero, peak };
  }
  fresh(input, first, output, offset, frames, timeline) {
    const { channels } = timeline, samples = frames * channels;
    this.input.set(input.subarray(first * channels, first * channels + samples));
    this.recovery.set(timeline.recoveryTail);
    this.api.audio_fresh(frames, channels, timeline.fadeFrames, timeline.gain, timeline.recoveryRemaining);
    output.set(this.output.subarray(0, samples), offset * channels);
    timeline.last.set(this.last.subarray(0, channels));
    timeline.recoveryTail.set(this.recovery.subarray(0, channels));
    timeline.gain = this.api.audio_gain(); timeline.recoveryRemaining = this.api.audio_remaining();
    timeline.tailRemaining = timeline.fadeFrames;
  }
  tail(output, offset, frames, timeline) {
    // Render quantum sizes are browser-owned. Chunk an unusually large block
    // while keeping the exact envelope state and the fixed WASM arena.
    while (frames > 0) {
      const take = Math.min(frames, MAX_FRAMES);
      this.last.set(timeline.last);
      this.api.audio_tail(take, timeline.channels, timeline.tailRemaining);
      output.set(this.output.subarray(0, take * timeline.channels), offset * timeline.channels);
      timeline.last.set(this.last.subarray(0, timeline.channels));
      timeline.tailRemaining = this.api.audio_remaining();
      frames -= take; offset += take;
    }
  }
  measureMix(continuous, retiring, output, gain, step, diagnostics) {
    let peak = 0, over = 0, invalid = 0;
    for (let i = 0; i < output[0].length; i++) {
      let voice = false;
      for (const [type, timeline, produced] of continuous) {
        const semantic = timeline.semanticType ?? type;
        if (semantic < 1 || semantic > 4) continue;
        if (timeline.state === 'playing' || i < produced) voice = true;
        else for (let c = 0; c < timeline.channels; c++) if (timeline.block[i * timeline.channels + c]) voice = true;
      }
      for (const tail of retiring) {
        const semantic = tail.semanticType ?? tail.type;
        if (tail.remaining > i && semantic >= 1 && semantic <= 4) voice = true;
      }
      const difference = (voice ? .2 : 1) - gain;
      gain += Math.max(-step, Math.min(step, difference));
      for (let c = 0; c < output.length; c++) {
        let media = 0, other = 0;
        for (const [type, timeline] of continuous) {
          const semantic = timeline.semanticType ?? type;
          const value = timeline.block[i * timeline.channels + Math.min(c, timeline.channels - 1)];
          if (semantic === 0 || semantic === 6) media += value; else other += value;
        }
        for (const tail of retiring) if (tail.remaining > i) {
          const semantic = tail.semanticType ?? tail.type;
          const value = tail.samples[Math.min(c, tail.samples.length - 1)] * (tail.remaining - i - 1) / tail.total;
          if (semantic === 0 || semantic === 6) media += value; else other += value;
        }
        const value = media * gain + other;
        if (!Number.isFinite(value)) invalid++;
        else { peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) > 1) over++; }
      }
    }
    diagnostics.mixPreClipPeak = Math.max(diagnostics.mixPreClipPeak || 0, peak);
    diagnostics.mixOverFullScaleSamples = (diagnostics.mixOverFullScaleSamples || 0) + over;
    diagnostics.mixNonFiniteSamples = (diagnostics.mixNonFiniteSamples || 0) + invalid;
  }
  mix(continuous, retiring, output, gain, step, diagnostics) {
    const totalFrames = output[0].length;
    if (!this.supports(totalFrames, output.length)) return null;
    if (diagnostics) this.measureMix(continuous, retiring, output, gain, step, diagnostics);
    // Browser-owned render quanta need not fit the private arena. Carry the
    // envelope, voice prefix and retired-tail state across bounded bulk calls.
    for (let offset = 0; offset < totalFrames; offset += MAX_FRAMES) {
      const frames = Math.min(MAX_FRAMES, totalFrames - offset);
      this.api.audio_mix_begin(frames, output.length);
      for (const [type, timeline, produced] of continuous) {
        const semantic = timeline.semanticType ?? type;
        this.input.set(timeline.block.subarray(offset * timeline.channels, (offset + frames) * timeline.channels));
        this.api.audio_mix_add(timeline.channels, semantic === 0 || semantic === 6,
          semantic >= 1 && semantic <= 4, timeline.state === 'playing' ? frames : Math.max(0, produced - offset));
      }
      for (const tail of retiring) if (tail.remaining > 0) {
        const semantic = tail.semanticType ?? tail.type;
        this.last.set(tail.samples);
        tail.remaining = this.api.audio_mix_tail(tail.samples.length, semantic === 0 || semantic === 6,
          semantic >= 1 && semantic <= 4, tail.remaining, tail.total);
      }
      this.api.audio_mix_end(gain, step, Boolean(diagnostics));
      for (let channel = 0; channel < output.length; channel++)
        output[channel].set(this.output.subarray(channel * frames, (channel + 1) * frames), offset);
      if (diagnostics) {
        diagnostics.renderNonzero += this.api.audio_nonzero();
        diagnostics.renderPeak = Math.max(diagnostics.renderPeak, this.api.audio_peak());
      }
      gain = this.api.audio_gain();
    }
    return gain;
  }
}
