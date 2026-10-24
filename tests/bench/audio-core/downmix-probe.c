/* SPDX-License-Identifier: GPL-3.0-only */
/* Measurement-only equivalent of a separate shared-core downmix boundary.
 * Production fuses the large SIMD path into SoundTouch instead. */
#include <stdint.h>
enum { FRAMES = 4096, SAMPLES = FRAMES * 8 };
static float input[SAMPLES], output[SAMPLES];
int audio_input(void) { return (int)(uintptr_t)input; }
int audio_output(void) { return (int)(uintptr_t)output; }
void audio_downmix(int frames, int channels) {
  if (frames < 0 || frames > FRAMES || (channels != 4 && channels != 6)) return;
  if (channels == 4) {
    for (int i = 0; i < frames; ++i) {
      output[i] = (float)(((double)input[i] + input[2 * frames + i]) * .5);
      output[frames + i] = (float)(((double)input[frames + i] + input[3 * frames + i]) * .5);
    }
  } else {
    for (int i = 0; i < frames; ++i) {
      const double surround = 0.7071067811865476;
      output[i] = (float)((double)input[i] + surround * ((double)input[2 * frames + i] + input[4 * frames + i]));
      output[frames + i] = (float)((double)input[frames + i] + surround * ((double)input[2 * frames + i] + input[5 * frames + i]));
    }
  }
}
