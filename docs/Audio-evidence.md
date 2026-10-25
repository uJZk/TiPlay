# Audio evidence capture (browser v87 / beta.20)

Debug capture now retains bounded `audio-evidence` events in the raw
`browser/audio-evidence` channel, with a compact `stage=EVIDENCE` metadata line.
The paired receiver validates the schema, float byte lengths, current capture ID
and 12 KiB event limit before recording. Standard mode does not collect waveforms,
scan native decoder floats or run the pre-clamp mixer measurement. Existing encoded
source records and send-attempt/admission evidence remain separate.

Each event freezes up to three completed render blocks before its first trigger
and three subsequent blocks. Blocks retain callback ordinal, cumulative processed
frames, raw `currentFrame`, independently expected frame, render-domain generation,
block/channel counts, diagnostic clock readings, final-output peak/sample-step and
IEEE Float32 output samples. Samples are explicitly `f32le`, interleaved, before the
browser audio backend. At 48 kHz/128 frames this window is approximately 16 ms.
Waveforms retain the first 128 frames and two channels per block; compare
`waveFrames`/`waveChannels` with actual block dimensions before claiming coverage.
Up to four per-block stream lanes retain epoch, source/input cursors, queued bytes,
PD requested/applied corrections, ratio, DSP consumption/output/calls, input
peak/step, DSP peak/non-finite count and next packet bounds. `omittedStreams`
reports additional streams; unmeasured DSP lanes retain null rather than zero.

Triggers include exact frame discrepancies, recovery before DSP disposal, packet
sequence gaps/reset, browser-read gaps over 100 ms, decoder failure, native decoded
float over-range/non-finite values, pre-clamp mixer over-range/non-finite values,
large output sample steps and observed callback budget overruns. Read gaps include
browser scheduling and decode/backpressure waits; they do not identify network
loss. A step over 0.5 is a waveform candidate, including legitimate transients,
not an acoustic click verdict. Native float scans precede PCM16 conversion;
`nativeScanFrames` and `nativeScanErrors` distinguish measured coverage from failed
or unavailable scans. Mixed-sum diagnostics precede the final limiter while the
playback arithmetic and existing recovery policy remain unchanged.

The recorder opens at most one window per two seconds of processed frames,
retains at most four causes per window, and counts suppressed triggers by reason.
First/last `device-clock-jump` witnesses also survive in ordinary Debug scalar
snapshots (`evidenceFirstJump.*`, `evidenceLastJump.*`) even when a waveform event
is suppressed. `evidenceAttempts`, `evidenceSuppressed`, `evidenceCounts.*`,
`evidenceForwarded`, `evidenceDropped`, `waveformOmittedBlocks`, `incomplete`, and
`omittedFields` bound interpretations of absent records. Main-thread serialization
first removes waveform blocks to meet the byte budget and reports every omission.
A busy control queue, smaller negotiated message limit or stale capture/generation
can prevent delivery. Debug changes and processor/session termination can truncate
pending post-trigger blocks. Forwarded means accepted by the local outbox;
only the normalized receiver channel establishes that evidence was recorded.

A baseline of the most recent blocks accompanies the existing half-second worklet
report. Processor exceptions can therefore retain pre-failure evidence without
requiring another callback; `main.baselineAgeMs` states its age. Main receipt time,
processor instance, diagnostic revision, playback generation, visibility, render
underrun counters, output-clock observations, source read/post observations and
native decoder metrics accompany each event. Main receipt time is not callback
execution time. Source packet observations refer to the last observed packet per
stream, not an asserted decode-latency match for a buffered output.

Callback timing uses an available monotonic diagnostic timer, otherwise `Date.now`
with `clock=wall`; neither drives playback. `durationMs` covers entry observation
through DSP, before the final waveform scan/report/feedback. It is elapsed time,
including preemption, not thread CPU. `evidenceEndWorkMsMax` separately measures
end-of-block recorder work, not all diagnostic overhead. Wall timers can be coarse
or jump; only monotonic observed overruns generate `callback-budget`. No application
counter proves CPU saturation, throttling, a browser frame-counter defect, speaker
output or one universal crackle cause.

Extract events and exact float blocks with:

```sh
python3 scripts/analyze_audio_evidence.py TiPlay-debug.zip --output /tmp/audio-evidence
```

The output directory must be new. Zstandard captures require the Python
`zstandard` package. The analyzer keeps frame discontinuities as separate blocks,
reports incomplete/omitted coverage, and leaves CPU/acoustic verdicts unknown.
CPU attribution remains unavailable from these application logs alone: elapsed
callback duration cannot distinguish CPU computation, preemption or throttling.
This release does not add a manual browser/system tracing workflow. A synchronized
acoustic/loopback recording is needed to connect software events to the sound
reported by the driver.

