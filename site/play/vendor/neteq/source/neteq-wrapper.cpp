// SPDX-License-Identifier: GPL-3.0-only
// Host/decoder adapter; the linked libWebRTC NetEq sources are unmodified.
#include <algorithm>
#include <cmath>
#include <memory>
#include <span>
#include <string>
#include "opus.h"
#include "api/environment/environment_factory.h"
#include "api/audio/audio_frame.h"
#include "api/audio_codecs/audio_decoder_factory.h"
#include "api/make_ref_counted.h"
#include "api/neteq/default_neteq_controller_factory.h"
#include "modules/audio_coding/neteq/neteq_impl.h"
#include "modules/audio_coding/codecs/opus/audio_decoder_opus.h"
#include "modules/audio_coding/codecs/pcm16b/audio_decoder_pcm16b.h"

namespace {
using namespace webrtc;
class Trials final : public FieldTrialsView {
 public:
  std::string Lookup(absl::string_view) const override { return ""; }
};
class SampleClock final : public Clock {
 public:
  int64_t us = 0;
  Timestamp CurrentTime() override { return Timestamp::Micros(us); }
  NtpTime ConvertTimestampToNtpTime(Timestamp) override { return NtpTime(); }
};
class DecoderFactory : public AudioDecoderFactory {
 public:
  // This private factory is configured explicitly, never used for SDP advertisement.
  std::vector<AudioCodecSpec> GetSupportedDecoders() override { return {}; }
  bool IsSupportedDecoder(const SdpAudioFormat& f) override {
    return (f.name == "opus" || f.name == "L16") && f.clockrate_hz == 48000 &&
           (f.num_channels == 1 || f.num_channels == 2);
  }
  std::unique_ptr<AudioDecoder> Create(const Environment& env,
                                       const SdpAudioFormat& f) override {
    if (!IsSupportedDecoder(f)) return nullptr;
    if (f.name == "opus") return std::make_unique<AudioDecoderOpusImpl>(
        env.field_trials(), f.num_channels, 48000);
    return std::make_unique<AudioDecoderPcm16B>(48000, f.num_channels);
  }
};
struct Stream {
  Trials trials;
  SampleClock clock;
  std::unique_ptr<NetEq> neteq;
  AudioFrame frame;
  alignas(float) unsigned char input[65536];
  float pcm[960];
  int codec, channels, packet_frames = 0;
  bool have = false;
  Stream(int c, int ch) : codec(c), channels(ch) {
    EnvironmentFactory factory;
    factory.Set(&trials); factory.Set(&clock);
    auto env = factory.Create();
    NetEq::Config config;
    config.sample_rate_hz = 48000;
    // Bounded independently of codec bitrate; matches the receiver packet budget.
    config.max_packets_in_buffer = 512;
    config.enable_fast_accelerate = true;
    DefaultNetEqControllerFactory controller;
    neteq = std::make_unique<NetEqImpl>(config, NetEqImpl::Dependencies(
        env, config, make_ref_counted<DecoderFactory>(), controller));
    if (!neteq->RegisterPayloadType(96, SdpAudioFormat(c == 1 ? "opus" : "L16", 48000, ch))) neteq.reset();
  }
};
bool ValidTime(double ms) { return std::isfinite(ms) && ms >= 0 && ms < 9e12; }
}  // namespace

extern "C" {
uintptr_t neteq_create(int codec, int channels) {
  if ((codec != 0 && codec != 1) || (channels != 1 && channels != 2)) return 0;
  auto* stream = new Stream(codec, channels);
  if (!stream->neteq) { delete stream; return 0; }
  return reinterpret_cast<uintptr_t>(stream);
}
void neteq_delete(Stream* stream) { delete stream; }
uintptr_t neteq_input(Stream* s) { return reinterpret_cast<uintptr_t>(s->input); }
uintptr_t neteq_pcm(Stream* s) { return reinterpret_cast<uintptr_t>(s->pcm); }
int neteq_duration(Stream* s) { return s->packet_frames; }
int neteq_insert(Stream* s, int length, int sequence, uint32_t timestamp, double arrival_ms) {
  if (!s || length < 1 || length > 65536 || !ValidTime(arrival_ms)) return -1;
  s->packet_frames = s->codec == 1 ? opus_packet_get_nb_samples(s->input, length, 48000)
                                  : length / (2 * s->channels);
  if (s->packet_frames < 1 || s->packet_frames > 5760) return -1;
  s->clock.us = static_cast<int64_t>(arrival_ms * 1000);
  webrtc::RTPHeader header;
  header.payloadType = 96; header.sequenceNumber = sequence;
  header.timestamp = timestamp; header.ssrc = 1;
  int result = s->neteq->InsertPacket(header, std::span<const uint8_t>(s->input, length));
  if (!result) s->have = true;
  return result;
}
int neteq_insert_float(Stream* s, int frames, int sequence, uint32_t timestamp, double arrival_ms) {
  if (!s || frames < 1 || frames > 480) return -1;
  float* samples = reinterpret_cast<float*>(s->input);
  for (int i = 0; i < frames * s->channels; i++) {
    float value = samples[i];
    if (!std::isfinite(value)) return -1;
    int n = std::clamp(static_cast<int>(std::round(std::clamp(value, -1.f, 1.f) * 32768.f)), -32768, 32767);
    // In-place conversion is safe: output advances by two bytes, input by four.
    s->input[2 * i] = static_cast<uint16_t>(n) >> 8;
    s->input[2 * i + 1] = n;
  }
  return neteq_insert(s, frames * s->channels * 2, sequence, timestamp, arrival_ms);
}
int neteq_pull(Stream* s, double now_ms) {
  if (!s || !s->have || !ValidTime(now_ms)) return 0;
  s->clock.us = static_cast<int64_t>(now_ms * 1000);
  bool muted = false;
  if (s->neteq->GetAudio(&s->frame, &muted) != 0) return -1;
  if (s->frame.samples_per_channel_ != 480 || s->frame.num_channels_ != s->channels) return -1;
  const auto data = s->frame.data();
  for (int i = 0; i < 480 * s->channels; i++) s->pcm[i] = muted ? 0 : data[i] / 32768.f;
  return 480;
}
double neteq_timestamp(Stream* s) {
  auto timestamp = s->neteq->GetPlayoutTimestamp();
  return timestamp ? static_cast<double>(*timestamp) : -1;
}
double neteq_stat(Stream* s, int key) {
  auto stats = s->neteq->GetLifetimeStatistics();
  switch (key) {
    case 0: return s->neteq->TargetDelayMs();
    case 1: return s->neteq->FilteredCurrentDelayMs();
    case 2: return stats.concealed_samples;
    case 3: return stats.inserted_samples_for_deceleration;
    case 4: return stats.removed_samples_for_acceleration;
    case 5: return stats.packets_discarded;
    case 6: return s->neteq->GetOperationsAndState().current_buffer_size_ms;
    case 7: return stats.fec_packets_received;
    case 8: return stats.fec_packets_discarded;
    case 9: return stats.concealment_events;
    default: return 0;
  }
}
}
