/*! SPDX-License-Identifier: GPL-3.0-only */
// Debug-only flight recorder. Its clocks never steer playback or certify speaker timing.
export const AUDIO_EVIDENCE_BYTES = 12 * 1024;
export const AUDIO_EVIDENCE_REASONS = ['frame-discontinuity', 'frame-invalid', 'callback-budget', 'output-edge',
  'output-invalid', 'output-range', 'packet-gap', 'arrival-gap', 'packet-reset', 'packet-format', 'decoder-error', 'decoded-range', 'decoded-invalid', 'processor-error',
  'clock-step', 'underrun', 'source-deadline', 'clock-generation', 'suspended', 'sender-deadline', 'network-buffer', 'device-clock-jump'];
const BEFORE = 3, AFTER = 3, WAVE_FRAMES = 128;
export const AUDIO_EVIDENCE_LANES = ['type', 'epoch', 'sourceFrame', 'inputFrame', 'queueBytes', 'phaseErrorMs',
  'appliedPpm', 'requestedPpm', 'ratio', 'consumedFrames', 'producedFrames', 'dspCalls', 'sourceTimeMs',
  'nextPacketFirst', 'nextPacketEnd', 'tempoActive', 'inputPeak', 'inputMaxStep', 'dspPeak', 'dspNonFinite', 'dspMaxStep'];
const finite = value => Number.isFinite(value) ? value : null;
const stamp = () => {
  try { if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now(); } catch (_) {}
  return Date.now();
};
export class AudioEvidence {
  constructor(rate, emit, now = stamp, clock = typeof performance !== 'undefined' && typeof performance.now === 'function' ? 'monotonic' : 'wall') {
    this.rate = rate; this.emit = emit; this.now = now; this.clock = clock;
    this.lanes = new Float64Array(4 * AUDIO_EVIDENCE_LANES.length); this.laneCount = 0;
    this.rows = Array.from({ length: BEFORE }, () => ({ wave: new Float32Array(WAVE_FRAMES * 2) }));
    this.currentRow = { wave: new Float32Array(WAVE_FRAMES * 2) };
    this.head = this.count = this.calls = this.sequence = 0; this.pending = null;
    this.nextAllowedFrame = 0; this.frames = 0; this.previousStart = null; this.previousLast = [null, null];
    this.reasonCounts = Object.fromEntries(AUDIO_EVIDENCE_REASONS.map(reason => [reason, 0])); this.endWorkMsMax = 0;
    this.attempts = this.suppressed = this.completed = this.incomplete = 0;
  }
  copy(row) { const { wave, lanes, ...meta } = row; return { ...meta, lanes: lanes?.slice() ?? [], wave: wave.slice(0, row.waveSamples ?? 0) }; }
  trigger(reason, detail = {}) {
    if (!AUDIO_EVIDENCE_REASONS.includes(reason)) return;
    this.attempts++; this.reasonCounts[reason]++;
    if (reason === 'device-clock-jump') {
      const witness = { observedFrame: finite(detail.observedFrame), expectedFrame: finite(detail.expectedFrame),
        deltaFrames: finite(detail.deltaFrames), blockFrames: finite(detail.blockFrames), renderedFrames: this.frames, call: this.calls };
      this.firstJump ??= witness; this.lastJump = witness;
    }
    const cause = { reason, call: this.calls, renderedFrames: this.frames, ...detail };
    if (this.pending) {
      if (this.pending.causes.length < 4) this.pending.causes.push(cause); else this.suppressed++;
      return;
    }
    if (this.frames < this.nextAllowedFrame) { this.suppressed++; return; }
    const blocks = [];
    for (let i = this.count; i > 0; i--) blocks.push(this.copy(this.rows[(this.head - i + BEFORE) % BEFORE]));
    this.pending = { schema: 1, timeOriginMs: typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : null, id: ++this.sequence, sampleRate: this.rate, clock: this.clock,
      causes: [cause], blocks, remaining: AFTER };
    this.nextAllowedFrame = this.frames + this.rate * 2;
  }
  begin(observedFrame, expectedFrame, blockFrames, channels, domain, renderedFrames, mediaGainStart = 1) {
    this.laneCount = 0; this.omittedStreams = 0;
    const startMs = finite(this.now()); this.calls++; this.frames = renderedFrames;
    this.current = { call: this.calls, renderedFrames, observedFrame: finite(observedFrame), expectedFrame: finite(expectedFrame),
      blockFrames, channels, domain, mediaGainStart, startMs, sincePreviousStartMs: startMs !== null && this.previousStart !== null ? startMs - this.previousStart : null };
    this.previousStart = startMs;
  }
  stage(timeline, produced, frames) {
    if (this.laneCount >= 4) { this.omittedStreams++; return; }
    let peak = 0, invalid = 0, maxStep = 0;
    timeline.evidenceLastDsp ??= new Float32Array(timeline.channels);
    for (let i = 0; i < frames * timeline.channels; i++) {
      const v = timeline.block[i], c = i % timeline.channels;
      if (!Number.isFinite(v)) invalid++;
      else { peak = Math.max(peak, Math.abs(v));
        if (timeline.evidenceDspSeen) maxStep = Math.max(maxStep, Math.abs(v - timeline.evidenceLastDsp[c])); }
      timeline.evidenceLastDsp[c] = v;
      if (c === timeline.channels - 1) timeline.evidenceDspSeen = true;
    }
    if (invalid || peak > 1) this.trigger(invalid ? 'output-invalid' : 'output-range', { type: timeline.type, epoch: timeline.epoch, dspPeak: peak, dspNonFinite: invalid });
    if (maxStep > .5) this.trigger('output-edge', { type: timeline.type, epoch: timeline.epoch, stage: 'dsp', maxStep });
    // Preserve the published evidence schema. Retired PD/source-clock fields are
    // unknown, not invented zero corrections. NetEq counters use scalar telemetry.
    const values = [timeline.type, timeline.epoch, timeline.sourceFrame, timeline.inputFrame, timeline.queueBytes,
      null, null, null, null, null, produced, null, null, null, null, null, null, null, peak, invalid, maxStep];
    this.lanes.set(values.map(v => Number.isFinite(v) ? v : NaN), this.laneCount++ * AUDIO_EVIDENCE_LANES.length);
  }
  end(output, mediaGain, domainAfter = this.current.domain) {
    const evidenceStart = this.now();
    const row = this.currentRow, wave = row.wave;
    // Replace all metadata, including optional values, when reusing a ring slot.
    Object.assign(row, this.current);
    row.omittedStreams = this.omittedStreams;
    row.lanes = Array.from(this.lanes.subarray(0, this.laneCount * AUDIO_EVIDENCE_LANES.length), finite);
    row.durationMs = row.startMs === null ? null : finite(this.now() - row.startMs);
    row.domainAfter = domainAfter; row.mediaGain = mediaGain; row.peak = row.maxStep = row.nonFinite = row.overFullScale = 0;
    row.waveFrames = Math.min(WAVE_FRAMES, row.blockFrames); row.waveChannels = Math.min(2, output.length);
    row.waveSamples = row.waveFrames * row.waveChannels;
    for (let c = 0; c < output.length; c++) {
      let previous = this.previousLast[c] ?? null;
      for (let i = 0; i < output[c].length; i++) {
        const value = output[c][i];
        if (!Number.isFinite(value)) row.nonFinite++;
        else {
          row.peak = Math.max(row.peak, Math.abs(value));
          if (Math.abs(value) > 1) row.overFullScale++;
          if (previous !== null) row.maxStep = Math.max(row.maxStep, Math.abs(value - previous));
        }
        if (c < row.waveChannels && i < row.waveFrames) wave[i * row.waveChannels + c] = value;
        previous = Number.isFinite(value) ? value : null;
      }
      this.previousLast[c] = previous;
    }
    if (row.nonFinite) this.trigger('output-invalid');
    if (row.overFullScale) this.trigger('output-range');
    // A large sample step is only a waveform candidate, never an acoustic diagnosis.
    if (row.maxStep > .5) this.trigger('output-edge');
    if (this.clock === 'monotonic' && row.durationMs > row.blockFrames * 1000 / this.rate) this.trigger('callback-budget');
    this.currentRow = this.rows[this.head]; this.rows[this.head] = row;
    this.head = (this.head + 1) % BEFORE; this.count = Math.min(BEFORE, this.count + 1);
    if (this.pending) {
      this.pending.blocks.push(this.copy(row));
      if (--this.pending.remaining === 0) this.flush(false);
    }
    this.endWorkMsMax = Math.max(this.endWorkMsMax, this.now() - evidenceStart);
  }
  baseline() {
    const blocks = [];
    for (let i = this.count; i > 0; i--) blocks.push(this.copy(this.rows[(this.head - i + BEFORE) % BEFORE]));
    return { schema: 1, sampleRate: this.rate, clock: this.clock,
      timeOriginMs: typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : null,
      attempts: this.attempts, suppressed: this.suppressed, blocks };
  }
  flush(incomplete = true) {
    if (!this.pending) return;
    const { remaining, ...event } = this.pending; this.pending = null;
    if (incomplete) this.incomplete++;
    this.completed++;
    event.reasonCounts = { ...this.reasonCounts }; event.incomplete = incomplete; event.attempts = this.attempts; event.suppressed = this.suppressed;
    this.emit(event);
  }
  stats() { return { evidenceAttempts: this.attempts, evidenceSuppressed: this.suppressed,
    evidenceCompleted: this.completed, evidenceIncomplete: this.incomplete, evidenceClock: this.clock, evidenceEndWorkMsMax: this.endWorkMsMax, evidenceCounts: { ...this.reasonCounts }, evidenceFirstJump: this.firstJump, evidenceLastJump: this.lastJump }; }
}

/** Serialization stays on the main thread. Keep IEEE floats (including NaNs) in explicitly little-endian PCM. */
export function packAudioEvidence(event, main, budget = AUDIO_EVIDENCE_BYTES) {
  if (!(budget >= 1024)) return null;
  const packed = { ...event, main, laneFields: AUDIO_EVIDENCE_LANES, blocks: event.blocks.map(({ wave, ...row }) => {
    const bytes = new Uint8Array(wave.length * 4), view = new DataView(bytes.buffer);
    for (let i = 0; i < wave.length; i++) view.setFloat32(i * 4, wave[i], true);
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return { ...row, pcm: btoa(binary) };
  }), pcmFormat: 'f32le', waveformOmittedBlocks: 0 };
  const size = () => new TextEncoder().encode(JSON.stringify(packed)).byteLength;
  // Preserve trigger metadata and all row positions before waveform bytes. Omission is explicit.
  for (const row of packed.blocks) {
    if (size() <= budget) break;
    if (row.pcm) { row.pcm = ''; packed.waveformOmittedBlocks++; }
  }
  return size() <= budget ? packed : null;
}
