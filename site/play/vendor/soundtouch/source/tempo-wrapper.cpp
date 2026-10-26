// SPDX-License-Identifier: GPL-3.0-only
// Only the browser ABI; the complete unmodified SoundTouch library supplies DSP.
#include "SoundTouch.h"
#include <cstdlib>
#include <new>
#include <cstdint>
#include <cstring>
#pragma clang fp reassociate(off)
#pragma clang fp contract(off)

static bool valid_tempo(double tempo) {
    // Integer classification survives the DSP build's fast-math assumptions.
    uint64_t bits;
    std::memcpy(&bits, &tempo, sizeof(bits));
    const volatile uint64_t exponent = bits & UINT64_C(0x7ff0000000000000);
    return exponent != UINT64_C(0x7ff0000000000000) && tempo >= .25 * (1 - .2) && tempo <= 4 * (1 + .2);
}

extern "C" {
soundtouch::SoundTouch *tempo_create(unsigned sample_rate, double tempo) {
    if (sample_rate < 8000 || sample_rate > 192000 || !valid_tempo(tempo)) return nullptr;
    auto *processor = new(std::nothrow) soundtouch::SoundTouch;
    if (!processor) return nullptr;
    processor->setSampleRate(sample_rate);
    processor->setChannels(2);
    // Match the established SoundTouchJS search policy using the upstream
    // library's maintained hierarchical correlation search.
    processor->setSetting(SETTING_USE_QUICKSEEK, 1);
    // This adapter changes tempo only; rate and pitch always remain exactly 1.
    // There is no sample-rate conversion that would require an anti-alias filter.
    processor->setSetting(SETTING_USE_AA_FILTER, 0);
    // Bounded WSOLA policy for URL playback. Live streams use NetEq.
    processor->setSetting(SETTING_SEQUENCE_MS, 20);
    processor->setSetting(SETTING_SEEKWINDOW_MS, 5);
    processor->setSetting(SETTING_OVERLAP_MS, 5);
    processor->setTempo(tempo);
    return processor;
}
int tempo_set(soundtouch::SoundTouch *processor, double tempo) {
    if (!processor || !valid_tempo(tempo)) return 0;
    processor->setTempo(tempo);
    return 1;
}
void tempo_delete(soundtouch::SoundTouch *processor) { delete processor; }
void tempo_put(soundtouch::SoundTouch *processor, const float *samples, unsigned frames) {
    processor->putSamples(samples, frames);
}
int tempo_put_planar(soundtouch::SoundTouch *processor, const float *planes, unsigned frames, unsigned channels) {
    if (frames > 4096 || (channels != 1 && channels != 2 && channels != 4 && channels != 6)) return 0;
    // The browser copies each original plane once. Fuse speaker downmix and
    // interleave before the library takes its own persistent input ownership.
    float samples[4096 * 2];
    const float *left = planes, *right = planes + 4096;
    if (channels == 1) {
        for (unsigned i = 0; i < frames; i++) samples[2 * i] = samples[2 * i + 1] = left[i];
    } else if (channels == 2) {
        for (unsigned i = 0; i < frames; i++) { samples[2 * i] = left[i]; samples[2 * i + 1] = right[i]; }
    } else if (channels == 4) {
        const float *surround_left = planes + 8192, *surround_right = planes + 12288;
        for (unsigned i = 0; i < frames; i++) {
            samples[2 * i] = ((double)left[i] + surround_left[i]) * 0.5;
            samples[2 * i + 1] = ((double)right[i] + surround_right[i]) * 0.5;
        }
    } else {
        const float *centre = planes + 8192, *surround_left = planes + 16384, *surround_right = planes + 20480;
        const double root_half = 0.7071067811865476;
        for (unsigned i = 0; i < frames; i++) {
            samples[2 * i] = left[i] + root_half * ((double)centre[i] + surround_left[i]);
            samples[2 * i + 1] = right[i] + root_half * ((double)centre[i] + surround_right[i]);
        }
    }
    processor->putSamples(samples, frames);
    return 1;
}
unsigned tempo_available(soundtouch::SoundTouch *processor) { return processor->numSamples(); }
unsigned tempo_receive(soundtouch::SoundTouch *processor, float *samples, unsigned frames) {
    return processor->receiveSamples(samples, frames);
}
void tempo_finish(soundtouch::SoundTouch *processor) { processor->flush(); }
}
