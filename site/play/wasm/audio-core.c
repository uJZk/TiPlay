/* SPDX-License-Identifier: GPL-3.0-only */
/* Bounded signal kernels. No allocator, imports, shared state or memory growth. */
#include <stdint.h>

enum { FRAMES = 4096, CHANNELS = 8, SAMPLES = FRAMES * CHANNELS };
static int16_t input16[SAMPLES];
static float input[SAMPLES], output[SAMPLES];
static float last[CHANNELS], recovery[CHANNELS];
static double media[SAMPLES], other[SAMPLES];
static uint8_t voice[FRAMES];
static double result_gain, result_peak;
static int result_remaining, result_nonzero, mix_frames, mix_channels;

int audio_input16(void) { return (int)(uintptr_t)input16; }
int audio_input(void) { return (int)(uintptr_t)input; }
int audio_output(void) { return (int)(uintptr_t)output; }
int audio_last(void) { return (int)(uintptr_t)last; }
int audio_recovery(void) { return (int)(uintptr_t)recovery; }
double audio_gain(void) { return result_gain; }
double audio_peak(void) { return result_peak; }
int audio_remaining(void) { return result_remaining; }
int audio_nonzero(void) { return result_nonzero; }

void audio_pcm16(int samples) {
  if (samples < 0 || samples > SAMPLES) return;
  for (int i = 0; i < samples; ++i) output[i] = input16[i] / 32768.0f;
}

/* Network PCM conversion shares the fixed scratch arena with rendering. */
void audio_unpack(int samples, int width, int little_endian) {
  if (samples < 0 || samples > SAMPLES || (width != 2 && width != 3)) return;
  const uint8_t *bytes = (const uint8_t *)input;
  for (int i = 0; i < samples; ++i) {
    const uint8_t *value = bytes + i * width;
    int high = little_endian ? width - 1 : 0;
    int low = little_endian ? width - 2 : 1;
    input16[i] = (int16_t)((uint16_t)value[high] << 8 | value[low]);
  }
}

void audio_quantize_planar(int frames, int channels) {
  if (frames < 0 || channels < 1 || channels > CHANNELS || frames > SAMPLES / channels) return;
  for (int channel = 0; channel < channels; ++channel) for (int i = 0; i < frames; ++i) {
    double value = (double)input[channel * frames + i] * 32768;
    int sample = value != value ? 0 : value >= 32767 ? 32767 : value <= -32768 ? -32768
      : (int)__builtin_floor(value + 0.5);
    input16[i * channels + channel] = (int16_t)sample;
  }
}

void audio_scan16(int samples) {
  if (samples < 0 || samples > SAMPLES) return;
  int nonzero = 0, peak = 0;
  for (int i = 0; i < samples; ++i) {
    int value = input16[i];
    nonzero += value != 0;
    if (value < 0) value = -value;
    if (value > peak) peak = value;
  }
  result_nonzero = nonzero; result_peak = peak / 32768.0;
}

void audio_fresh(int frames, int channels, int fade, double gain, int remaining) {
  if (frames < 0 || frames > FRAMES || channels < 1 || channels > CHANNELS || fade < 1) return;
  for (int i = 0; i < frames; ++i) {
    gain += 1.0 / fade;
    if (gain > 1) gain = 1;
    double envelope = remaining > 0 ? (remaining - 1.0) / remaining : 0;
    for (int c = 0; c < channels; ++c) {
      recovery[c] = (float)(recovery[c] * envelope);
      /* Float64 arithmetic matches JS; storage retains float32 PCM semantics. */
      double value = input[i * channels + c] * gain + recovery[c];
      output[i * channels + c] = last[c] = (float)value;
    }
    if (remaining > 0) --remaining;
  }
  result_gain = gain; result_remaining = remaining;
}

void audio_tail(int frames, int channels, int remaining) {
  if (frames < 0 || frames > FRAMES || channels < 1 || channels > CHANNELS) return;
  for (int i = 0; i < frames; ++i) {
    double envelope = remaining > 0 ? (remaining - 1.0) / remaining : 0;
    for (int c = 0; c < channels; ++c) output[i * channels + c] = last[c] = (float)(last[c] * envelope);
    if (remaining > 0) --remaining;
  }
  result_remaining = remaining;
}

int audio_mix_begin(int frames, int channels) {
  if (frames < 1 || frames > FRAMES || channels < 1 || channels > CHANNELS) return 0;
  mix_frames = frames; mix_channels = channels;
  for (int i = 0; i < frames * channels; ++i) media[i] = other[i] = 0;
  for (int i = 0; i < frames; ++i) voice[i] = 0;
  return 1;
}

void audio_mix_add(int channels, int is_media, int is_voice, int active_frames) {
  if (channels < 1 || channels > CHANNELS) return;
  double *sum = is_media ? media : other;
  for (int i = 0; i < mix_frames; ++i) {
    if (is_voice) {
      int active = i < active_frames;
      for (int c = 0; !active && c < channels; ++c) active = input[i * channels + c] != 0;
      if (active) voice[i] = 1;
    }
    for (int c = 0; c < mix_channels; ++c)
      sum[i * mix_channels + c] += input[i * channels + (c < channels ? c : channels - 1)];
  }
}

int audio_mix_tail(int channels, int is_media, int is_voice, int remaining, int total) {
  if (channels < 1 || channels > CHANNELS || total < 1) return remaining;
  double *sum = is_media ? media : other;
  for (int i = 0; i < mix_frames && remaining > 0; ++i, --remaining) {
    if (is_voice) voice[i] = 1;
    double gain = (remaining - 1.0) / total;
    for (int c = 0; c < mix_channels; ++c)
      sum[i * mix_channels + c] += last[c < channels ? c : channels - 1] * gain;
  }
  return remaining;
}

void audio_mix_end(double gain, double step, int debug) {
  int nonzero = 0; double peak = 0;
  for (int i = 0; i < mix_frames; ++i) {
    double target = voice[i] ? .2 : 1, difference = target - gain;
    gain += difference > step ? step : difference < -step ? -step : difference;
    for (int c = 0; c < mix_channels; ++c) {
      double value = media[i * mix_channels + c] * gain + other[i * mix_channels + c];
      if (value > 1) value = 1;
      else if (value < -1) value = -1;
      float sample = (float)value;
      output[c * mix_frames + i] = sample;
      if (debug) {
        if (sample != 0) ++nonzero;
        double absolute = sample < 0 ? -sample : sample;
        if (absolute > peak) peak = absolute;
      }
    }
  }
  result_gain = gain; result_nonzero = nonzero; result_peak = peak;
}
