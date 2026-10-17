/* SPDX-License-Identifier: GPL-3.0-only */
#include <jni.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include "soxr.h"

typedef struct { soxr_t engine; double ratio; unsigned channels; } Engine;

JNIEXPORT jlong JNICALL Java_com_shilapi_xcertplay_media_NativeSoxr_nativeCreate(
    JNIEnv *env, jclass cls, jdouble ratio, jint channels) {
  (void)env; (void)cls;
  if (!isfinite(ratio) || ratio < 1.0 / 12 || ratio > 12 || channels < 1 || channels > 2) return 0;
  Engine *state = calloc(1, sizeof(*state));
  if (!state) return 0;
  soxr_error_t error = 0;
  soxr_quality_spec_t quality = soxr_quality_spec(SOXR_HQ, SOXR_VR);
  soxr_runtime_spec_t runtime = soxr_runtime_spec(1);
  state->ratio = ratio; state->channels = (unsigned)channels;
  state->engine = soxr_create(ratio * 1.05, 1, state->channels, &error, 0, &quality, &runtime);
  if (!state->engine || error || soxr_set_io_ratio(state->engine, ratio, 0)) {
    if (state->engine) soxr_delete(state->engine);
    free(state); return 0;
  }
  return (jlong)(intptr_t)state;
}

JNIEXPORT jlong JNICALL Java_com_shilapi_xcertplay_media_NativeSoxr_nativeProcess(
    JNIEnv *env, jclass cls, jlong handle, jfloatArray input, jint frames, jfloatArray output, jint capacity) {
  (void)cls;
  Engine *state = (Engine *)(intptr_t)handle;
  if (!state || !input || !output || frames < 0 || frames > 4096 || capacity < 1 || capacity > 4096 ||
      (*env)->GetArrayLength(env, input) / state->channels < (unsigned)frames ||
      (*env)->GetArrayLength(env, output) / state->channels < (unsigned)capacity) return -1;
  jfloat *in = (*env)->GetFloatArrayElements(env, input, 0);
  if (!in) return -1;
  jfloat *out = (*env)->GetFloatArrayElements(env, output, 0);
  if (!out) { (*env)->ReleaseFloatArrayElements(env, input, in, JNI_ABORT); return -1; }
  size_t consumed = 0, produced = 0;
  float empty = 0;
  /* A non-NULL zero-length input drains available output; it must never signal EOF. */
  soxr_error_t error = soxr_process(state->engine, frames ? in : &empty, (size_t)frames,
      &consumed, out, (size_t)capacity, &produced);
  (*env)->ReleaseFloatArrayElements(env, output, out, error ? JNI_ABORT : 0);
  (*env)->ReleaseFloatArrayElements(env, input, in, JNI_ABORT);
  return error ? -1 : (jlong)(((uint64_t)consumed << 32) | produced);
}

JNIEXPORT jboolean JNICALL Java_com_shilapi_xcertplay_media_NativeSoxr_nativeRatio(
    JNIEnv *env, jclass cls, jlong handle, jdouble ratio, jint slew) {
  (void)env; (void)cls;
  Engine *state = (Engine *)(intptr_t)handle;
  if (!state || !isfinite(ratio) || ratio < state->ratio * .95 || ratio > state->ratio * 1.05 || slew < 0) return JNI_FALSE;
  return soxr_set_io_ratio(state->engine, ratio, (size_t)slew) ? JNI_FALSE : JNI_TRUE;
}

JNIEXPORT void JNICALL Java_com_shilapi_xcertplay_media_NativeSoxr_nativeDestroy(
    JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  Engine *state = (Engine *)(intptr_t)handle;
  if (state) { soxr_delete(state->engine); free(state); }
}
