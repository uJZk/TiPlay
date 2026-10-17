/* SoX Resampler Library      Copyright (c) 2007-16 robs@users.sourceforge.net
 * SPDX-License-Identifier: LGPL-2.1-or-later
 * TiPlay float32-only IO adaptation. DSP filter and phase clock unchanged.
 * Only reachable through tiplay_create's float32 interleaved ABI. */
#include <string.h>
#include "soxr.h"
void _soxr_deinterleave_f(float **dest, soxr_datatype_t type, const void **input, size_t frames, unsigned channels) {
  const float *src = *input;
  (void)type;
  if (channels == 1) memcpy(dest[0], src, frames * sizeof(float));
  else if (channels == 2) {
    float *left = dest[0], *right = dest[1];
    for (size_t i = 0; i < frames; i++) { left[i] = src[2*i]; right[i] = src[2*i+1]; }
  } else for (size_t i = 0; i < frames; i++) for (unsigned c = 0; c < channels; c++) dest[c][i] = src[i*channels+c];
  *input = src + frames * channels;
}
size_t _soxr_interleave_f(soxr_datatype_t type, void **output, const float *const *src, size_t frames, unsigned channels, unsigned long *seed) {
  float *dest = *output;
  (void)type; (void)seed;
  if (channels == 1) memcpy(dest, src[0], frames * sizeof(float));
  else if (channels == 2) {
    const float *left = src[0], *right = src[1];
    for (size_t i = 0; i < frames; i++) { dest[2*i] = left[i]; dest[2*i+1] = right[i]; }
  } else for (size_t i = 0; i < frames; i++) for (unsigned c = 0; c < channels; c++) dest[i*channels+c] = src[c][i];
  *output = dest + frames * channels;
  return 0;
}
