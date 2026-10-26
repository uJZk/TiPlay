/* Decode synthetic fixture access units using unmodified native FFmpeg 9.0.
 * Link with libavcodec/libavcodec.a libavutil/libavutil.a -lm -lpthread.
 * Usage: native-oracle fixture.bin sampleRate channels > output.s16le
 * PCM16 conversion uses IEEE round-to-nearest, matching the no-dither filter.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "libavcodec/avcodec.h"
#include "libavutil/mem.h"
static unsigned length(FILE *file) {
    uint8_t bytes[4];
    if (fread(bytes, 1, 4, file) != 4) return 0;
    return bytes[0] | bytes[1] << 8 | bytes[2] << 16 | (unsigned)bytes[3] << 24;
}
int main(int argc, char **argv) {
    if (argc != 4) return 2;
    FILE *file = fopen(argv[1], "rb");
    if (!file) return 3;
    const AVCodec *codec = avcodec_find_decoder_by_name("aac");
    AVCodecContext *context = avcodec_alloc_context3(codec);
    context->sample_rate = atoi(argv[2]);
    av_channel_layout_default(&context->ch_layout, atoi(argv[3]));
    unsigned size = length(file);
    context->extradata = av_mallocz(size + AV_INPUT_BUFFER_PADDING_SIZE);
    context->extradata_size = size;
    if (fread(context->extradata, 1, size, file) != size || avcodec_open2(context, codec, NULL) < 0) return 4;
    AVPacket *packet = av_packet_alloc();
    AVFrame *frame = av_frame_alloc();
    while ((size = length(file))) {
        if (av_new_packet(packet, size) < 0 || fread(packet->data, 1, size, file) != size) return 5;
        if (avcodec_send_packet(context, packet) < 0 || avcodec_receive_frame(context, frame) < 0) return 6;
        if (frame->format != AV_SAMPLE_FMT_FLTP) return 7;
        for (int i = 0; i < frame->nb_samples; i++) for (int ch = 0; ch < frame->ch_layout.nb_channels; ch++) {
            float value = ((float *)frame->extended_data[ch])[i] * 32768.0f;
            long sample = lrintf(value);
            if (sample < -32768) sample = -32768;
            if (sample > 32767) sample = 32767;
            uint8_t bytes[2] = { (uint16_t)sample & 255, ((uint16_t)sample >> 8) & 255 };
            fwrite(bytes, 1, 2, stdout);
        }
        av_packet_unref(packet); av_frame_unref(frame);
    }
    av_frame_free(&frame); av_packet_free(&packet); avcodec_free_context(&context); fclose(file);
    return 0;
}
