/* SPDX-License-Identifier: GPL-3.0-only */
#include "soxr.h"
#include <stdlib.h>

static size_t input_done, output_done;
void * tiplay_create(double maximum_ratio, double initial_ratio, unsigned channels) {
  soxr_error_t error = 0;
  soxr_quality_spec_t quality = soxr_quality_spec(SOXR_HQ, SOXR_VR);
  soxr_runtime_spec_t runtime = soxr_runtime_spec(1);
  soxr_t engine = soxr_create(maximum_ratio, 1, channels, &error, 0, &quality, &runtime);
  if (!engine || error || soxr_set_io_ratio(engine, initial_ratio, 0)) {
    if (engine) soxr_delete(engine);
    return 0;
  }
  return engine;
}
int tiplay_process(soxr_t engine, float * input, size_t length, float * output, size_t capacity) {
  input_done = output_done = 0;
  return soxr_process(engine, input, length, &input_done, output, capacity, &output_done) != 0;
}
size_t tiplay_input_done(void) { return input_done; }
size_t tiplay_output_done(void) { return output_done; }
int tiplay_ratio(soxr_t engine, double ratio, size_t slew) { return soxr_set_io_ratio(engine, ratio, slew) != 0; }
void tiplay_delete(soxr_t engine) { soxr_delete(engine); }
