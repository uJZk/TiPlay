/* Third-Party Modified Version of the Fraunhofer FDK AAC Codec Library for Android.
 * TiPlay WASM interface, modified 2026-10-24. See ../NOTICE and ../MODIFICATIONS.txt.
 * The linked FDK 2.0.3 source is complete and unmodified.
 */
#include "aacdecoder_lib.h"
#include <stdint.h>

static HANDLE_AACDECODER decoder = nullptr;
static UCHAR input[8192];
static INT_PCM pcm[1024];
static INT expectedRate, expectedChannels, expectedFrames;

extern "C" {
uintptr_t eld_input() { return reinterpret_cast<uintptr_t>(input); }
uintptr_t eld_pcm() { return reinterpret_cast<uintptr_t>(pcm); }
void eld_close() {
  if (decoder) aacDecoder_Close(decoder);
  decoder = nullptr;
}
int eld_init(INT rate, INT channels, INT frames) {
  if ((rate != 44100 && rate != 48000) || (channels != 1 && channels != 2) ||
      (frames != 480 && frames != 512)) return AAC_DEC_UNSUPPORTED_FORMAT;
  eld_close();
  expectedRate = rate; expectedChannels = channels; expectedFrames = frames;
  input[0] = 0xf8; input[1] = rate == 44100 ? 0xe8 : 0xe6;
  input[2] = (channels << 5) | (frames == 480 ? 0x10 : 0); input[3] = 0;
  decoder = aacDecoder_Open(TT_MP4_RAW, 1);
  if (!decoder) return AAC_DEC_OUT_OF_MEMORY;
  UCHAR *config = input; UINT length = 4;
  int status = aacDecoder_ConfigRaw(decoder, &config, &length);
  if (status) eld_close();
  return status;
}
static int check_output(int status) {
  if (IS_OUTPUT_VALID(status)) {
    const CStreamInfo *info = aacDecoder_GetStreamInfo(decoder);
    if (info->sampleRate != expectedRate || info->numChannels != expectedChannels ||
        info->frameSize != expectedFrames) return AAC_DEC_UNSUPPORTED_FORMAT;
  }
  return status;
}
int eld_decode(INT length) {
  if (!decoder) return AAC_DEC_INVALID_HANDLE;
  if (length < 1 || length > 8192) return AAC_DEC_UNSUPPORTED_FORMAT;
  UCHAR *packet = input; UINT size = length, remaining = length;
  int status = aacDecoder_Fill(decoder, &packet, &size, &remaining);
  if (status) return status;
  if (remaining) return AAC_DEC_UNKNOWN;
  return check_output(aacDecoder_DecodeFrame(decoder, pcm, 1024, 0));
}
int eld_conceal() {
  if (!decoder) return AAC_DEC_INVALID_HANDLE;
  return check_output(aacDecoder_DecodeFrame(decoder, pcm, 1024, AACDEC_CONCEAL));
}
int eld_delay() { return decoder ? aacDecoder_GetStreamInfo(decoder)->outputDelay : 0; }
}
