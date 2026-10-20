/*! SPDX-License-Identifier: GPL-3.0-only */
import { MAX_AUDIO_AHEAD_BYTES, MAX_PCM_PACKET_MS, MAX_TIMELINE_PACKETS } from './audio-buffer-policy.js';
import { AudioSourceClock } from './audio-source-clock.js';

export const AUDIO_RECOVERY_ERROR_MS = 30;
const FADE_MS = 5, PHASE_CORRECTION_LIMIT = 0.001;

/** Stable source/sample anchors; only an interruption starts a new resampler signal. */
export class ContinuousAudio {
  constructor(runtime, rate, channels, outputRate, consumed, maximumMs, { buffered = false, mode = 'carplay', type = 0, semanticType = type } = {}) {
    this.runtime = runtime; this.rate = rate; this.channels = channels; this.outputRate = outputRate;
    this.consumed = consumed; this.maximumMs = maximumMs; this.buffered = buffered; this.mode = mode; this.type = type; this.semanticType = semanticType;
    this.queue = []; this.sequences = new Set(); this.bytes = 0; this.counters = null;
    this.sourceAnchorMs = null; this.sampleAnchorUs = null; this.sourceFrame = 0; this.inputFrame = 0; this.outputFrames = 0;
    this.lastContextTimeMs = null;
    this.state = 'priming'; this.reason = 'startup'; this.clockGeneration = null;
    this.rawCursorMs = null; this.phaseErrorMs = 0; this.gain = 0; this.last = new Float32Array(channels);
    this.fadeFrames = Math.max(1, Math.round(FADE_MS * outputRate / 1000));
    this.tailRemaining = 0;
    this.recoveryTail = new Float32Array(channels); this.recoveryRemaining = 0;
    this.input = new Float32Array(4096 * channels); this.output = new Float32Array(512 * channels);
    this.filterDelayMs = runtime.filterDelay(rate, outputRate); this.filterUncertaintyMs = 1;
    this.sourceClock = new AudioSourceClock(rate, { arrival: mode === 'carplay' && !buffered });
    this.backend = null; this.slewRatio = rate / outputRate; this.lastPacket = null; this.missingSince = null;
    this.lastRecoveryReason = null; this.recoveryCounts = {};
    this.sourceDeadlineState = 'unknown'; this.sourceDeltaMs = null; this.sourceDeltaUpperMs = null;
    this.sourceDeadlineReason = 'no-output';
    this.sourceDeadlineRejectedFrames = 0;
  }
  debug(enabled) { this.counters = enabled ? { capacityPackets: 0, latePackets: 0, duplicatePackets: 0, playedPackets: 0, resetPackets: 0, invalidPackets: 0, rebufferCount: 0 } : null; }
  retire(packet, reason) {
    this.bytes -= packet.pcm.byteLength; this.sequences.delete(packet.sequence);
    if (this.counters) this.counters[reason + 'Packets']++;
    this.consumed(packet.pcm.byteLength, reason, packet.generation);
  }
  reject(bytes, reason, generation) { if (this.counters) this.counters[reason + 'Packets']++; this.consumed(bytes, reason, generation); }
  clear() {
    for (const packet of this.queue) this.retire(packet, 'reset');
    this.queue = []; this.backend?.dispose(); this.backend = null; this.state = 'ended'; this.lastContextTimeMs = null;
  }
  push(data, browserRate = 1) {
    const pcm = new Int16Array(data.pcm), frames = pcm.length / this.channels;
    if (!frames) return;
    if (!Number.isInteger(frames) || frames * 1000 / this.rate > MAX_PCM_PACKET_MS) { this.reject(pcm.byteLength, 'invalid', data.generation); return; }
    if (this.sequences.has(data.sequence)) { this.reject(pcm.byteLength, 'duplicate', data.generation); return; }
    this.sourceAnchorMs ??= data.presentationMs;
    let nominalFrame = Math.round((data.presentationMs - this.sourceAnchorMs) * this.rate / 1000);
    const sampleTimeUs = this.mode === 'airplay-mirror' && Number.isFinite(data.decodeTimestampUs) ? data.decodeTimestampUs : null;
    if (sampleTimeUs !== null) {
      this.sampleAnchorUs ??= sampleTimeUs - nominalFrame * 1000000 / this.rate;
      nominalFrame = Math.round((sampleTimeUs - this.sampleAnchorUs) * this.rate / 1000000);
    }
    const previous = this.lastPacket, consecutive = previous && ((data.sequence - previous.sequence) >>> 0) === 1;
    // CarPlay's RTP-derived timestamps count nominal samples, independently of
    // the arrival oscillator fit. Presentation-only AirPlay anchors reflect that
    // oscillator, so their compatibility path uses its rate for adjacency.
    const anchorRate = !this.sourceClock.arrival && this.sourceClock.confidence ? this.sourceClock.rate : 1;
    const expectedStart = previous ? previous.presentationMs + (previous.end - previous.first) * 1000 / this.rate / anchorRate : data.presentationMs;
    // RTP/decode timestamps count source samples. Refining an NTP presentation
    // anchor changes its clock mapping, not the packet's sample continuity.
    const sampleTimed = sampleTimeUs !== null && Number.isFinite(previous?.decodeTimestampUs);
    const deltaMs = sampleTimed ? (sampleTimeUs - previous.decodeTimestampUs) / 1000
      - (previous.end - previous.first) * 1000 / this.rate : data.presentationMs - expectedStart;
    const precisionMs = Number.EPSILON * (sampleTimed
      ? Math.max(1, Math.abs(sampleTimeUs), Math.abs(previous.decodeTimestampUs)) / 1000
      : Math.max(1, Math.abs(expectedStart), Math.abs(data.presentationMs))) * 2;
    // A quarter sample covers quantized clock refinement; a real half-sample gap still breaks the signal.
    const connected = consecutive && Math.abs(deltaMs) <= Math.max(precisionMs, 250 / this.rate);
    let first = connected ? previous.end : nominalFrame;
    if (consecutive && !connected && first <= previous.end && deltaMs > 0) first = previous.end + 1;
    if (this.backend && first + frames <= this.inputFrame) { this.reject(pcm.byteLength, 'late', data.generation); return; }
    const packet = { pcm, first, end: first + frames, sequence: data.sequence, generation: data.generation,
      presentationMs: data.presentationMs, decodeTimestampUs: sampleTimeUs };
    this.queue.push(packet); this.sequences.add(packet.sequence); this.bytes += pcm.byteLength;
    this.queue.sort((a, b) => a.first - b.first);
    this.lastPacket = packet;
    if (!this.buffered) this.sourceClock.observe(first, this.sourceClock.arrival ? data.arrivalLocalTimeMs : data.presentationMs, browserRate);
    while (this.queue.length > MAX_TIMELINE_PACKETS || this.bytes > MAX_AUDIO_AHEAD_BYTES || (this.queue.length > 1 && (this.queue.at(-1).end - this.queue[0].first) * 1000 / this.rate > this.maximumMs)) {
      this.retire(this.buffered ? this.queue.pop() : this.queue.shift(), 'capacity');
    }
  }
  read(frame, count) {
    // Retain the filter's lookahead until it is audible, including across a recovery.
    const retiredThrough = Math.min(frame, Math.floor(this.sourceFrame));
    while (this.queue.length && this.queue[0].end <= retiredThrough) this.retire(this.queue.shift(), 'played');
    let copied = 0;
    for (const packet of this.queue) {
      const position = frame + copied;
      if (packet.first > position) break;
      if (packet.end <= position) continue;
      const take = Math.min(count - copied, packet.end - position), start = (position - packet.first) * this.channels;
      for (let i = 0; i < take * this.channels; i++) this.input[copied * this.channels + i] = packet.pcm[start + i] / 32768;
      copied += take; if (copied === count) break;
    }
    return copied;
  }
  recover(reason) {
    if (this.backend) { this.recoveryTail.set(this.last); this.recoveryRemaining = this.fadeFrames; }
    this.backend?.dispose(); this.backend = null; this.state = 'rebuffering'; this.reason = reason;
    this.lastRecoveryReason = reason; this.recoveryCounts[reason] = (this.recoveryCounts[reason] || 0) + 1;
    this.gain = Math.min(1, this.gain); this.missingSince = null;
    if (this.counters) this.counters.rebufferCount++;
  }
  start(targetMs, clockGeneration) {
    if (!this.queue.length) return false;
    if (Number.isFinite(this.rawCursorMs) && targetMs < this.rawCursorMs) return false;
    const first = this.queue[0], tail = this.queue.at(-1);
    const sourceRate = this.sourceClock.rate;
    let frame = Number.isFinite(this.rawCursorMs)
      ? Math.ceil(this.sourceFrame + (targetMs + this.filterDelayMs - this.rawCursorMs) * this.rate / 1000 * sourceRate)
      : Math.ceil((targetMs + this.filterDelayMs - this.sourceAnchorMs) * this.rate / 1000);
    if (frame < first.first) return false;
    frame = Math.max(frame, first.first);
    if (frame >= tail.end || !this.read(frame, Math.ceil(this.outputRate * 0.01 * this.rate / this.outputRate))) return false;
    this.backend = this.runtime.create(this.rate, this.outputRate, this.channels);
    this.slewRatio = this.rate / this.outputRate; this.backend.setRatio(this.slewRatio, 0);
    const rawStart = Number.isFinite(this.rawCursorMs)
      ? this.rawCursorMs + (frame - this.sourceFrame) * 1000 / this.rate / sourceRate - this.filterDelayMs
      : this.sourceAnchorMs + frame * 1000 / this.rate - this.filterDelayMs;
    this.inputFrame = frame; this.sourceFrame = frame; this.rawCursorMs = rawStart;
    this.clockGeneration = clockGeneration; this.state = 'playing'; this.reason = null; this.gain = 0;
    return true;
  }
  /** targetMs is the raw Android-media position due at the speaker for this quantum. */
  render(targetMs, contextMs, clock, frames, output, deviceRate = 1, deadline = null) {
    output.fill(0); this.outputFrames += frames;
    this.sourceDeadlineState = 'unknown'; this.sourceDeltaMs = this.sourceDeltaUpperMs = null;
    this.sourceDeadlineReason = deadline?.unknownReason || 'no-output';
    this.lastContextTimeMs = Number.isFinite(contextMs) ? contextMs + frames * 1000 / this.outputRate : null;
    const sourceRate = this.sourceClock.advance(contextMs), clockRate = clock?.rate || 1;
    if (this.backend && clock && clock.generation !== this.clockGeneration && clock.state !== 'stale') this.recover('clock-generation');
    if (this.backend && Number.isFinite(targetMs)) {
      this.phaseErrorMs = targetMs - this.rawCursorMs;
      if (Math.abs(this.phaseErrorMs) > AUDIO_RECOVERY_ERROR_MS) this.recover('clock-step');
    }
    if (!this.backend && Number.isFinite(targetMs)) this.start(targetMs, clock?.generation);
    if (!this.backend) {
      this.fadeTail(output, 0, frames); this.recoveryTail.set(this.last); this.recoveryRemaining = this.tailRemaining;
      this.checkDeadline(deadline, clock, this.rawCursorMs, frames * 1000 / this.outputRate / deviceRate, 0, output, frames);
      return 0;
    }
    const correction = Math.max(-PHASE_CORRECTION_LIMIT, Math.min(PHASE_CORRECTION_LIMIT, this.phaseErrorMs / 10000));
    this.deviceRate = deviceRate; this.phaseCorrectionPpm = correction * 1e6;
    const nextRatio = this.rate / this.outputRate * sourceRate / clockRate / deviceRate * (1 + correction);
    this.backend.setRatio(nextRatio, frames);
    const firstRatio = this.slewRatio, firstSourceMs = this.rawCursorMs;
    let produced = 0, needInput = false;
    for (let call = 0; call < 16 && produced < frames; call++) {
      // Keep filter state across network packet boundaries; never flush at a temporary shortage.
      // Drain the filter before feeding again: producer lead belongs to the bounded PCM queue.
      const available = needInput ? this.read(this.inputFrame, Math.min(4096, Math.ceil((frames - produced) * nextRatio) + Math.ceil(this.rate * 0.006))) : 0;
      const result = this.backend.process(this.input, available, this.output, frames - produced);
      this.inputFrame += result.consumed;
      for (let i = 0; i < result.produced; i++) {
        this.gain = Math.min(1, this.gain + 1 / this.fadeFrames);
        for (let c = 0; c < this.channels; c++) {
          const value = this.output[i * this.channels + c] * this.gain
            + this.recoveryTail[c] * this.recoveryRemaining / this.fadeFrames;
          output[(produced + i) * this.channels + c] = value; this.last[c] = value;
        }
        this.recoveryRemaining = Math.max(0, this.recoveryRemaining - 1);
        this.tailRemaining = this.fadeFrames;
      }
      produced += result.produced;
      if (!result.consumed && !result.produced && needInput) break;
      needInput = true;
    }
    // Soxr's slew is measured in emitted output frames, not packet/input frames.
    const fraction = produced / frames, finalRatio = firstRatio + (nextRatio - firstRatio) * fraction;
    const advanced = produced * (firstRatio + finalRatio) / 2;
    this.sourceFrame += advanced;
    this.rawCursorMs += advanced * 1000 / this.rate / sourceRate;
    this.slewRatio = finalRatio;
    if (produced < frames) { this.fadeTail(output, produced, frames); this.recover('underrun'); }
    const localSpan = frames * 1000 / this.outputRate / deviceRate;
    const sourceSpan = produced * Math.min(firstRatio, finalRatio) * 1000 / this.rate / sourceRate * (clock?.rate || 1);
    if (!this.checkDeadline(deadline, clock, firstSourceMs, localSpan, sourceSpan, output, frames)) return 0;
    return produced;
  }
  checkDeadline(deadline, clock, firstSourceMs, localSpan, sourceSpan, output, frames) {
    if (deadline && clock && Number.isFinite(firstSourceMs) && Number.isFinite(deadline.outputAt)
      && Number.isFinite(clock.localOriginMs) && Number.isFinite(clock.serverOriginMs)
      && Number.isFinite(clock.rate) && clock.rate > 0) {
      const mappedSource = clock.localOriginMs + (firstSourceMs - clock.serverOriginMs) * clock.rate;
      this.sourceDeltaMs = deadline.outputAt - mappedSource;
      // A conservative bound across the complete quantum includes the slowest
      // slew ratio, device oscillator, filter and both clock uncertainties.
      this.sourceDeltaUpperMs = this.sourceDeltaMs + Math.max(0, localSpan - sourceSpan) + deadline.uncertaintyMs;
      this.sourceDeadlineState = this.sourceDeltaUpperMs <= deadline.limitMs ? 'within-bound' : 'violated';
      this.sourceDeadlineReason = this.sourceDeadlineState === 'violated' ? 'source-deadline' : null;
      if (this.sourceDeadlineState === 'violated') {
        // The whole quantum is still application-owned. Never emit expired
        // content or crossfade an expired recovery tail into fresh output.
        output.fill(0); this.sourceDeadlineRejectedFrames += frames;
        this.recover('source-deadline'); this.last.fill(0); this.recoveryTail.fill(0);
        this.recoveryRemaining = this.tailRemaining = 0;
        return false;
      }
    }
    return true;
  }
  fadeTail(output, from, frames) {
    for (let i = from; i < frames; i++) {
      const envelope = this.tailRemaining > 0 ? (this.tailRemaining - 1) / this.tailRemaining : 0;
      for (let c = 0; c < this.channels; c++) { this.last[c] *= envelope; output[i * this.channels + c] = this.last[c]; }
      this.tailRemaining = Math.max(0, this.tailRemaining - 1);
    }
  }
  reference(contextTimeMs) {
    return { type: this.type, semanticType: this.semanticType, mode: this.mode, epoch: this.epoch, generation: this.generation,
      anchoring: this.arrivalPlayback ? 'arrival' : 'presentation',
      contextTimeMs, sourceTimeMs: this.rawCursorMs, mediaRate: this.slewRatio * this.outputRate / this.rate / this.sourceClock.rate,
      resampleRatio: this.slewRatio, networkDelayMs: this.networkDelayMs,
      resampleRatePpm: (this.slewRatio * this.outputRate / this.rate - 1) * 1e6,
      deviceRatePpm: ((this.deviceRate ?? 1) - 1) * 1e6, phaseCorrectionPpm: this.phaseCorrectionPpm ?? 0,
      filterDelayMs: this.filterDelayMs, filterUncertaintyMs: this.filterUncertaintyMs,
      state: this.state, reason: this.reason, clockGeneration: this.clockGeneration, phaseErrorMs: this.phaseErrorMs,
      sourceDeadlineState: this.sourceDeadlineState, sourceDeltaMs: this.sourceDeltaMs, sourceDeltaUpperMs: this.sourceDeltaUpperMs,
      sourceDeadlineReason: this.sourceDeadlineReason,
      sourceDeadlineRejectedFrames: this.sourceDeadlineRejectedFrames,
      lastRecoveryReason: this.lastRecoveryReason, recoveryCounts: { ...this.recoveryCounts },
      sourceRatePpm: (this.sourceClock.rate - 1) * 1e6, sourceRateConfidence: this.sourceClock.confidence };
  }
  stats() {
    return { ...this.counters, queueBytes: this.bytes, queuePackets: this.queue.length,
      headMs: this.queue.length ? this.sourceAnchorMs + this.queue[0].first * 1000 / this.rate : null,
      tailMs: this.queue.length ? this.sourceAnchorMs + this.queue.at(-1).end * 1000 / this.rate : null,
      playbackMs: this.rawCursorMs, outputFrames: this.outputFrames, state: this.state, ...this.reference(this.lastContextTimeMs) };
  }
}
