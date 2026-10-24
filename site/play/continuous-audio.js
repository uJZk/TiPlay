/*! SPDX-License-Identifier: GPL-3.0-only */
import { MAX_AUDIO_AHEAD_BYTES, MAX_PCM_PACKET_MS, MAX_TIMELINE_PACKETS } from './audio-buffer-policy.js';
import { AudioSourceClock } from './audio-source-clock.js';
import { rateProjectionUncertainty } from './audio-device-clock.js';
import { AudioKernel } from './wasm/audio-core.js';

export const AUDIO_RECOVERY_ERROR_MS = 30;
export const AUDIO_FADE_MS = 5;
const PHASE_CORRECTION_LIMIT = 0.001;

/** Add rate uncertainty only over the actual PCM/tail contribution. A block's
 * zero padding is neither emitted source content nor a longer output interval.
 */
export function sourceDeadlineUncertainty(deadline, localSpan = 0) {
  if (!Number.isFinite(deadline?.projectionContextMs) || !Number.isFinite(deadline?.projectionRate)) return deadline?.uncertaintyMs;
  const start = deadline.projectionContextMs, end = start + localSpan * deadline.projectionRate;
  return deadline.uncertaintyMs + rateProjectionUncertainty(Math.max(Math.abs(start), Math.abs(end)), deadline.projectionRate);
}

/** Shared source-age calculation for current output and scalar retired tails. */
export function sourceDeadlineAt(deadline, clock, firstSourceMs, localSpan, sourceSpan, result) {
  result.sourceDeadlineState = 'unknown'; result.sourceDeltaMs = result.sourceDeltaUpperMs = null;
  result.sourceDeadlineUncertaintyMs = null;
  result.sourceDeadlineReason = deadline?.unknownReason || 'no-output';
  if (deadline && clock && Number.isFinite(firstSourceMs) && Number.isFinite(deadline.outputAt)
    && Number.isFinite(clock.localOriginMs) && Number.isFinite(clock.serverOriginMs)
    && Number.isFinite(clock.rate) && clock.rate > 0) {
    const mappedSource = clock.localOriginMs + (firstSourceMs - clock.serverOriginMs) * clock.rate;
    result.sourceDeltaMs = deadline.outputAt - mappedSource;
    result.sourceDeadlineUncertaintyMs = sourceDeadlineUncertainty(deadline, localSpan);
    result.sourceDeltaUpperMs = result.sourceDeltaMs + Math.max(0, localSpan - sourceSpan) + result.sourceDeadlineUncertaintyMs;
    result.sourceDeadlineState = result.sourceDeltaUpperMs <= deadline.limitMs ? 'within-bound' : 'violated';
    result.sourceDeadlineReason = result.sourceDeadlineState === 'violated' ? 'source-deadline' : null;
  }
  return result.sourceDeadlineState !== 'violated';
}

/** Stable source/sample anchors; only an interruption starts a new resampler signal. */
export class ContinuousAudio {
  constructor(runtime, rate, channels, outputRate, consumed, maximumMs, { buffered = false, mode = 'carplay', type = 0, semanticType = type } = {}) {
    this.runtime = runtime; this.rate = rate; this.channels = channels; this.outputRate = outputRate;
    this.kernel = runtime.audioKernel ??= new AudioKernel();
    this.consumed = consumed; this.maximumMs = maximumMs; this.buffered = buffered; this.mode = mode; this.type = type; this.semanticType = semanticType;
    this.queue = []; this.sequences = new Set(); this.bytes = 0; this.counters = null;
    this.sourceAnchorMs = null; this.sampleAnchorUs = null; this.sampleOriginKnown = false;
    this.sourceFrame = 0; this.inputFrame = 0; this.outputFrames = 0;
    this.lastContextTimeMs = null;
    this.state = 'priming'; this.reason = 'startup'; this.clockGeneration = null;
    this.rawCursorMs = null; this.phaseErrorMs = 0; this.gain = 0; this.last = new Float32Array(channels);
    this.lastSourceMs = this.recoverySourceMs = this.deadlineSourceMs = null;
    this.deadlineScratch = {};
    this.fadeFrames = Math.max(1, Math.round(AUDIO_FADE_MS * outputRate / 1000));
    this.tailRemaining = 0;
    this.recoveryTail = new Float32Array(channels); this.recoveryRemaining = 0;
    this.input = new Float32Array(4096 * channels); this.output = new Float32Array(512 * channels);
    this.filterDelayMs = runtime.filterDelay(rate, outputRate); this.filterUncertaintyMs = 1;
    this.sourceClock = new AudioSourceClock(rate, { arrival: mode === 'carplay' && !buffered });
    this.backend = null; this.slewRatio = rate / outputRate; this.lastPacket = null; this.missingSince = null;
    this.lastRecoveryReason = null; this.recoveryCounts = {};
    this.lastClockStep = null; this.lastSourceDeadline = null;
    this.sourceDeadlineState = 'unknown'; this.sourceDeltaMs = null; this.sourceDeltaUpperMs = null;
    this.sourceDeadlineUncertaintyMs = null;
    this.sourceDeadlineReason = 'no-output';
    this.sourceDeadlineRejectedFrames = 0;
    this.hasEmitted = false; this.voicePreparation = null;
    this.voicePreparationState = 'idle'; this.voicePreparedFrames = this.voiceRequiredFrames = this.voiceWaitMs = 0;
    this.voicePreparationResult = { targetMs: null, waiting: true, state: 'idle' };
  }
  debug(enabled) {
    this.counters = enabled ? { capacityPackets: 0, latePackets: 0, duplicatePackets: 0, playedPackets: 0, resetPackets: 0, invalidPackets: 0, rebufferCount: 0 } : null;
    this.lastSourceDeadline = null;
    this.sourceClock.debug(enabled);
  }
  retire(packet, reason) {
    this.bytes -= packet.pcm.byteLength; this.sequences.delete(packet.sequence);
    if (this.counters) this.counters[reason + 'Packets']++;
    this.consumed(packet.pcm.byteLength, reason, packet.generation);
  }
  reject(bytes, reason, generation) { if (this.counters) this.counters[reason + 'Packets']++; this.consumed(bytes, reason, generation); }
  clear() {
    for (const packet of this.queue) this.retire(packet, 'reset');
    this.queue = []; this.backend?.dispose(); this.backend = null; this.state = 'ended'; this.lastContextTimeMs = null;
    this.lastSourceMs = this.recoverySourceMs = this.deadlineSourceMs = null;
    this.voicePreparation = null; this.voicePreparationState = 'idle';
  }
  synchronize(data) {
    if (this.synchronized || !Number.isFinite(data.presentationMs) || this.sourceAnchorMs === null
      || this.sequences.has(data.sequence)) return false;
    const frames = data.pcm.byteLength / 2 / this.channels;
    if (!Number.isInteger(frames) || frames <= 0 || frames * 1000 / this.rate > MAX_PCM_PACKET_MS) return false;
    let frame;
    if (this.mode === 'airplay-mirror') {
      // A record sequence is not a source sample clock: it may hide missing RTP.
      // Translate only a decode coordinate known from this PCM epoch's start.
      if (!this.sampleOriginKnown || !Number.isFinite(data.decodeTimestampUs)) return false;
      frame = Math.round((data.decodeTimestampUs - this.sampleAnchorUs) * this.rate / 1000000);
    } else if (this.arrivalPlayback) frame = this.lastPacket?.end ?? 0;
    else return false;
    const offset = data.presentationMs - (this.sourceAnchorMs + frame * 1000 / this.rate);
    this.sourceAnchorMs += offset;
    if (Number.isFinite(this.rawCursorMs)) this.rawCursorMs += offset;
    for (const packet of this.queue) packet.presentationMs += offset;
    if (this.lastPacket && !this.queue.includes(this.lastPacket)) this.lastPacket.presentationMs += offset;
    // Provisional presentation times cannot train the real source oscillator.
    // Arrival-based CarPlay guidance keeps its independent measured oscillator.
    if (!this.sourceClock.arrival) { this.sourceClock = new AudioSourceClock(this.rate); this.sourceClock.debug(Boolean(this.counters)); }
    // No source-age proof exists for copies of the previously untimed output.
    // Retain the live filter/sample cursor, but never blend that old tail into
    // a quantum whose source deadline is now verifiable.
    this.last.fill(0); this.recoveryTail.fill(0); this.recoveryRemaining = this.tailRemaining = 0;
    this.lastSourceMs = this.recoverySourceMs = this.deadlineSourceMs = null;
    this.arrivalPlayback = false; this.synchronized = true;
    return true;
  }
  push(data, browserRate = 1, observedContextMs = null) {
    const pcm = new Int16Array(data.pcm), frames = pcm.length / this.channels;
    if (!frames) return;
    if (!Number.isInteger(frames) || frames * 1000 / this.rate > MAX_PCM_PACKET_MS) { this.reject(pcm.byteLength, 'invalid', data.generation); return; }
    if (this.sequences.has(data.sequence)) { this.reject(pcm.byteLength, 'duplicate', data.generation); return; }
    const sampleTimeUs = this.mode === 'airplay-mirror' && Number.isFinite(data.decodeTimestampUs) ? data.decodeTimestampUs : null;
    if (this.sourceAnchorMs === null) this.sampleOriginKnown = sampleTimeUs !== null;
    this.sourceAnchorMs ??= data.presentationMs;
    let nominalFrame = Math.round((data.presentationMs - this.sourceAnchorMs) * this.rate / 1000);
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
    if (!this.buffered) this.sourceClock.observe(first, this.sourceClock.arrival ? data.arrivalLocalTimeMs : data.presentationMs, browserRate, observedContextMs);
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
      this.kernel.pcm16(packet.pcm, start, this.input, copied * this.channels, take * this.channels);
      copied += take; if (copied === count) break;
    }
    return copied;
  }
  recover(reason) {
    if (!this.voicePreparation || this.voicePreparation.admitted) {
      this.voiceWaitStartedAt = undefined; this.voiceWaitLastContextMs = undefined; this.voiceWaitElapsedMs = 0;
      this.voiceCandidateFloorFrame = undefined;
      this.voiceFreshnessFrames = 0;
    }
    if (this.backend) {
      this.recoveryTail.set(this.last); this.recoveryRemaining = this.fadeFrames;
      this.recoverySourceMs = this.lastSourceMs;
    }
    this.backend?.dispose(); this.backend = null; this.state = 'rebuffering'; this.reason = reason;
    this.voicePreparation = null; this.voicePreparedFrames = 0;
    this.lastRecoveryReason = reason; this.recoveryCounts[reason] = (this.recoveryCounts[reason] || 0) + 1;
    this.gain = Math.min(1, this.gain); this.missingSince = null;
    if (this.counters) this.counters.rebufferCount++;
  }
  start(targetMs, clockGeneration) {
    if (!this.queue.length) return false;
    if (Number.isFinite(this.rawCursorMs) && targetMs < this.rawCursorMs) return false;
    const first = this.queue[0], tail = this.queue.at(-1);
    let frame = this.frameAtRaw(targetMs);
    if (frame < first.first) return false;
    frame = Math.max(frame, first.first);
    if (frame >= tail.end || !this.read(frame, Math.ceil(this.outputRate * 0.01 * this.rate / this.outputRate))) return false;
    this.backend = this.runtime.create(this.rate, this.outputRate, this.channels);
    this.slewRatio = this.rate / this.outputRate; this.backend.setRatio(this.slewRatio, 0);
    const rawStart = this.rawAtFrame(frame);
    this.inputFrame = frame; this.sourceFrame = frame; this.rawCursorMs = rawStart;
    this.clockGeneration = clockGeneration; this.state = 'playing'; this.reason = null; this.gain = 0;
    return true;
  }
  /** The raw media coordinate of an integer input frame in the current signal.
   * Keep this inverse beside start(): a recovery must never replay its cursor.
   */
  rawAtFrame(frame) {
    return Number.isFinite(this.rawCursorMs)
      ? this.rawCursorMs + (frame - this.sourceFrame) * 1000 / this.rate / this.sourceClock.rate - this.filterDelayMs
      : this.sourceAnchorMs + frame * 1000 / this.rate - this.filterDelayMs;
  }
  frameAtRaw(rawMs) {
    return Number.isFinite(this.rawCursorMs)
      ? Math.ceil(this.sourceFrame + (rawMs + this.filterDelayMs - this.rawCursorMs) * this.rate / 1000 * this.sourceClock.rate)
      : Math.ceil((rawMs + this.filterDelayMs - this.sourceAnchorMs) * this.rate / 1000);
  }
  checkPhase(targetMs, contextMs, deviceRate, deadline) {
    if (!Number.isFinite(targetMs) || !Number.isFinite(this.rawCursorMs)) return;
    this.phaseErrorMs = targetMs - this.rawCursorMs;
    if (Math.abs(this.phaseErrorMs) <= AUDIO_RECOVERY_ERROR_MS) return;
    const deviceRatePpm = (deviceRate - 1) * 1e6, uncertaintyMs = sourceDeadlineUncertainty(deadline);
    this.lastClockStep = {
      phaseErrorMs: Number.isFinite(this.phaseErrorMs) ? this.phaseErrorMs : null,
      deviceRatePpm: Number.isFinite(deviceRate) && deviceRate > 0 && Number.isFinite(deviceRatePpm) ? deviceRatePpm : null,
      uncertaintyMs: Number.isFinite(uncertaintyMs) && uncertaintyMs >= 0 ? uncertaintyMs : null,
      contextMs: Number.isFinite(contextMs) && contextMs >= 0 ? contextMs : null,
    };
    this.recover('clock-step');
  }
  voiceResult(targetMs) {
    const result = this.voicePreparationResult;
    result.targetMs = targetMs; result.waiting = !Number.isFinite(targetMs); result.state = this.voicePreparationState;
    return result;
  }
  voicePlanDelay(minimumDelayMs, reserveMs, deadline, frames, deviceRate, clockRate) {
    if (!Number.isFinite(deadline?.uncertaintyMs) || !Number.isFinite(deadline.limitMs)) return minimumDelayMs;
    const span = frames * 1000 / this.outputRate / deviceRate;
    const ratio = this.rate / this.outputRate * this.sourceClock.rate / clockRate / deviceRate;
    const sourceSpan = frames * Math.min(this.rate / this.outputRate, ratio) * 1000 / this.rate / this.sourceClock.rate * clockRate;
    return Math.min(minimumDelayMs, deadline.limitMs - reserveMs - sourceDeadlineUncertainty(deadline, span)
      - Math.max(0, span - sourceSpan));
  }
  /** Prepare a voice signal transactionally. Input/filter progress may run
   * ahead, but its audible source cursor commits only when render emits PCM.
   * A finite callback budget is retained across quanta, including low-rate
   * Soxr priming which needs more than sixteen calls for its first output.
   */
  prepareVoice({ contextMs, frames, clock, deviceRate = 1, deadline, outputAt = deadline?.outputAt,
    minimumDelayMs, admissionReserveMs = 0, waitMs = 20 }) {
    const validClock = clock && Number.isFinite(clock.localOriginMs) && Number.isFinite(clock.serverOriginMs)
      && Number.isFinite(clock.rate) && clock.rate > 0;
    const localMs = outputAt;
    if (!validClock || !Number.isFinite(localMs) || !(frames > 0) || !(deviceRate > 0)) {
      this.voicePreparationState = 'waiting-clock'; return this.voiceResult(null);
    }
    this.sourceClock.advance(contextMs);
    // Arrival-anchored guidance may acquire a real presentation mapping while
    // its filter is live. Adopt that same audible cursor without re-priming it.
    if (this.backend && !this.voicePreparation && !Number.isFinite(this.networkDelayMs) && Number.isFinite(this.rawCursorMs)) {
      this.networkDelayMs = localMs - (clock.localOriginMs + (this.rawCursorMs - clock.serverOriginMs) * clock.rate);
      this.networkPlanTargetMs = minimumDelayMs;
      if (this.clockGeneration === undefined) this.clockGeneration = clock.generation;
    }
    if (this.backend && clock.generation !== this.clockGeneration && clock.state !== 'stale') this.recover('clock-generation');
    if (this.backend && Number.isFinite(this.networkPlanTargetMs)
      && Math.abs(minimumDelayMs - this.networkPlanTargetMs) >= 8
      && (!Number.isFinite(this.networkDelayMs) || Math.abs(this.voicePlanDelay(minimumDelayMs,
        admissionReserveMs, deadline, frames, deviceRate, clock.rate) - this.networkDelayMs) >= 8)) this.recover('network-buffer');
    if (this.backend && (!this.voicePreparation || this.voicePreparation.admitted)) {
      const target = clock.serverOriginMs + (localMs - this.networkDelayMs - clock.localOriginMs) / clock.rate;
      this.checkPhase(target, contextMs, deviceRate, deadline);
      if (this.backend) { this.voicePreparationState = 'playing'; return this.voiceResult(target); }
    }
    const mapped = raw => clock.localOriginMs + (raw - clock.serverOriginMs) * clock.rate;
    const rawTarget = delay => clock.serverOriginMs + (localMs - delay - clock.localOriginMs) / clock.rate;
    this.networkPlanTargetMs = minimumDelayMs;
    if (this.voiceWaitStartedAt === undefined && this.queue.length) {
      this.voiceWaitStartedAt = contextMs; this.voiceWaitLastContextMs = contextMs; this.voiceWaitElapsedMs = 0;
    }
    if (Number.isFinite(this.voiceWaitLastContextMs)) {
      this.voiceWaitElapsedMs += Math.max(0, contextMs - this.voiceWaitLastContextMs) / deviceRate;
      this.voiceWaitLastContextMs = contextMs;
    }
    this.voiceWaitMs = this.voiceWaitElapsedMs || 0;
    const sourceRate = this.sourceClock.rate;
    const ratio = this.rate / this.outputRate * sourceRate / clock.rate / deviceRate;
    const acceptable = (raw, contributionFrames) => {
      const probe = {};
      const span = contributionFrames * 1000 / this.outputRate / deviceRate;
      sourceDeadlineAt(deadline && { ...deadline, limitMs: deadline.limitMs - admissionReserveMs }, clock, raw,
        span, contributionFrames * Math.min(this.rate / this.outputRate, ratio) * 1000 / this.rate / sourceRate * clock.rate, probe);
      return probe.sourceDeadlineState !== 'violated';
    };
    let preparation = this.voicePreparation;
    if (preparation && (!acceptable(preparation.rawMs, Math.min(frames, preparation.prepared)) || preparation.generation !== clock.generation)) {
      // Discard unpublished samples without advancing the audible frontier.
      this.backend?.dispose(); this.backend = null; this.voicePreparation = preparation = null;
      this.voicePreparedFrames = 0;
    }
    if (!preparation) {
      let earliestRaw = Number.isFinite(this.rawCursorMs) ? this.rawCursorMs : -Infinity;
      const contributionFrames = this.voiceFreshnessFrames || 0;
      // The network plan is a preferred delay, bounded by the track's actual
      // admission budget just as the ordinary renderer bounds its soft plan.
      const latestRaw = rawTarget(this.voicePlanDelay(minimumDelayMs, admissionReserveMs,
        deadline, contributionFrames, deviceRate, clock.rate));
      const latestFrame = this.frameAtRaw(latestRaw);
      const span = contributionFrames * 1000 / this.outputRate / deviceRate;
      if (Number.isFinite(deadline?.uncertaintyMs) && Number.isFinite(deadline.limitMs)) {
        const uncertainty = sourceDeadlineUncertainty(deadline, span);
        const extra = Math.max(0, span - contributionFrames * Math.min(this.rate / this.outputRate, ratio) * 1000 / this.rate / sourceRate * clock.rate);
        earliestRaw = Math.max(earliestRaw, clock.serverOriginMs
          + (localMs + uncertainty + extra - deadline.limitMs + admissionReserveMs - clock.localOriginMs) / clock.rate);
      }
      let startFrame = null, runEnd = null, hasFreshCandidate = false;
      for (let index = 0; index < this.queue.length;) {
        const first = this.queue[index].first; let end = this.queue[index++].end;
        while (index < this.queue.length && this.queue[index].first <= end) end = Math.max(end, this.queue[index++].end);
        const frame = Math.max(first, this.voiceCandidateFloorFrame ?? first,
          Number.isFinite(earliestRaw) ? this.frameAtRaw(earliestRaw) : first);
        if (frame < end && acceptable(this.rawAtFrame(frame), contributionFrames)) hasFreshCandidate = true;
        if (frame < end && frame <= latestFrame && acceptable(this.rawAtFrame(frame), contributionFrames)) {
          startFrame = frame; runEnd = end; break;
        }
      }
      if (startFrame === null) {
        const expired = this.queue.length && !hasFreshCandidate;
        this.voicePreparationState = expired ? 'waiting-deadline' : 'waiting-data';
        this.state = expired ? 'infeasible' : 'priming'; this.reason = expired ? 'sender-deadline' : 'startup';
        if (expired) this.senderCeilingViolations = (this.senderCeilingViolations || 0) + 1;
        return this.voiceResult(null);
      }
      const rawMs = this.rawAtFrame(startFrame);
      this.backend = this.runtime.create(this.rate, this.outputRate, this.channels);
      this.backend.setRatio(this.rate / this.outputRate, 0);
      preparation = this.voicePreparation = { generation: clock.generation, frame: startFrame, rawMs,
        nextFrame: startFrame, nextRawMs: rawMs, ratio: this.rate / this.outputRate,
        inputFrame: startFrame, runEnd, segments: [], prepared: 0, needInput: false, admitted: false };
      this.clockGeneration = clock.generation;
    }
    this.voiceRequiredFrames = Math.max(frames, Math.ceil(waitMs * this.outputRate * deviceRate / 1000));
    // Stage raw filter output, never a gain envelope or saved recovery tail.
    // At most sixteen actual native calls belong to one worklet callback.
    this.fillVoicePreparation(preparation, this.voiceRequiredFrames, ratio, sourceRate, contextMs);
    this.voicePreparedFrames = preparation.prepared;
    this.voiceFreshnessFrames = Math.min(frames, preparation.prepared);
    if (!acceptable(preparation.rawMs, this.voiceFreshnessFrames)) {
      this.backend.dispose(); this.backend = null; this.voicePreparation = null;
      this.voicePreparedFrames = 0; this.voicePreparationState = 'waiting-deadline';
      return this.voiceResult(null);
    }
    if (!preparation.prepared && preparation.stalled
      && this.queue.some(packet => packet.first > preparation.inputFrame)) {
      // A known source hole ends this contiguous signal. A later queued run
      // must not remain blocked behind an unprimeable unpublished prefix.
      this.voiceCandidateFloorFrame = preparation.runEnd;
      this.backend.dispose(); this.backend = null; this.voicePreparation = null;
      this.voicePreparationState = 'waiting-data'; return this.voiceResult(null);
    }
    // A finite short utterance cannot satisfy an arbitrary full-quantum PCM
    // threshold. After the same wall-clock wait, real partial output may play;
    // its unused block remainder follows the ordinary fade/underrun path.
    if (this.voiceWaitMs < waitMs || preparation.prepared === 0) {
      this.voicePreparationState = preparation.prepared < frames ? 'priming' : 'waiting-reserve';
      this.state = 'priming'; this.reason = 'startup'; return this.voiceResult(null);
    }
    preparation.admitted = true;
    this.voicePreparationState = 'ready';
    this.sourceStartupDelayMs = this.networkDelayMs = localMs - mapped(preparation.rawMs);
    this.sourceFrame = preparation.frame; this.rawCursorMs = preparation.rawMs;
    this.inputFrame = preparation.inputFrame; this.slewRatio = preparation.segments[0]?.firstRatio ?? preparation.ratio;
    this.gain = 0; this.phaseErrorMs = 0; this.state = 'playing'; this.reason = null;
    return this.voiceResult(preparation.rawMs);
  }
  fillVoicePreparation(preparation, required, nextRatio, sourceRate, contextMs) {
    preparation.stalled = false;
    if (preparation.budgetContextMs !== contextMs) { preparation.budgetContextMs = contextMs; preparation.calls = 0; }
    while (preparation.calls < 16 && preparation.prepared < required) {
      preparation.calls++;
      const count = Math.min(512, required - preparation.prepared);
      this.backend.setRatio(nextRatio, count);
      const available = preparation.needInput
        ? this.read(preparation.inputFrame, Math.min(4096, Math.ceil(count * nextRatio) + Math.ceil(this.rate * 0.006))) : 0;
      const converted = this.backend.process(this.input, available, this.output, count);
      preparation.inputFrame += converted.consumed;
      const finalRatio = preparation.ratio + (nextRatio - preparation.ratio) * converted.produced / count;
      if (converted.produced) {
        const advanced = converted.produced * (preparation.ratio + finalRatio) / 2;
        preparation.segments.push({ pcm: this.output.slice(0, converted.produced * this.channels), offset: 0,
          count: converted.produced, frame: preparation.nextFrame, rawMs: preparation.nextRawMs,
          firstRatio: preparation.ratio, finalRatio, sourceRate });
        preparation.nextFrame += advanced;
        preparation.nextRawMs += advanced * 1000 / this.rate / sourceRate;
        preparation.prepared += converted.produced;
      }
      preparation.ratio = finalRatio;
      if (!converted.consumed && !converted.produced && preparation.needInput) { preparation.stalled = true; break; }
      preparation.needInput = true;
    }
  }
  renderVoicePreparation(contextMs, clock, frames, output, deviceRate, deadline, sourceRate) {
    const preparation = this.voicePreparation;
    if (!preparation.admitted) {
      const tailFrames = Math.min(frames, this.tailRemaining), sourceMs = this.lastSourceMs;
      this.fadeTail(output, 0, frames); this.recoveryTail.set(this.last); this.recoveryRemaining = this.tailRemaining;
      this.recoverySourceMs = this.lastSourceMs;
      if (tailFrames) this.checkDeadline(deadline, clock, sourceMs, tailFrames * 1000 / this.outputRate / deviceRate,
        0, output, frames, contextMs);
      return 0;
    }
    const correction = Math.max(-PHASE_CORRECTION_LIMIT, Math.min(PHASE_CORRECTION_LIMIT, this.phaseErrorMs / 10000));
    this.deviceRate = deviceRate; this.phaseCorrectionPpm = correction * 1e6;
    const nextRatio = this.rate / this.outputRate * sourceRate / (clock?.rate || 1) / deviceRate * (1 + correction);
    this.fillVoicePreparation(preparation, frames, nextRatio, sourceRate, contextMs);
    const recoverySourceMs = this.recoverySourceMs, recoveryFrames = this.recoveryRemaining;
    let produced = 0;
    while (produced < frames && preparation.segments.length) {
      const segment = preparation.segments[0], take = Math.min(frames - produced, segment.count - segment.offset);
      const rawAt = offset => {
        const ratioAt = segment.firstRatio + (segment.finalRatio - segment.firstRatio) * offset / segment.count;
        return segment.rawMs + offset * (segment.firstRatio + ratioAt) / 2 * 1000 / this.rate / segment.sourceRate;
      };
      const firstRaw = rawAt(segment.offset), firstRatio = segment.firstRatio
        + (segment.finalRatio - segment.firstRatio) * segment.offset / segment.count;
      const lastRatio = segment.firstRatio + (segment.finalRatio - segment.firstRatio) * (segment.offset + take) / segment.count;
      const offsetMs = produced * 1000 / this.outputRate / deviceRate;
      const segmentDeadline = deadline && { ...deadline,
        outputAt: Number.isFinite(deadline.outputAt) ? deadline.outputAt + offsetMs : deadline.outputAt,
        projectionContextMs: Number.isFinite(deadline.projectionContextMs)
          ? deadline.projectionContextMs + produced * 1000 / this.outputRate : deadline.projectionContextMs };
      this.boundDeadline(segmentDeadline, clock, firstRaw, take * 1000 / this.outputRate / deviceRate,
        take * Math.min(firstRatio, lastRatio) * 1000 / this.rate / segment.sourceRate * (clock?.rate || 1));
      this.mixFreshBlock(segment.pcm, segment.offset, output, produced, take,
        rawAt(segment.offset + take - 1));
      segment.offset += take; produced += take; preparation.prepared -= take;
      this.rawCursorMs = rawAt(segment.offset);
      this.sourceFrame = segment.frame + segment.offset * (segment.firstRatio + lastRatio) / 2;
      this.slewRatio = lastRatio;
      if (segment.offset === segment.count) preparation.segments.shift();
    }
    this.inputFrame = preparation.inputFrame;
    this.voicePreparedFrames = preparation.prepared;
    if (recoveryFrames > 1 && produced) this.boundDeadline(deadline, clock, recoverySourceMs,
      Math.min(recoveryFrames - 1, produced) * 1000 / this.outputRate / deviceRate, 0);
    if (produced < frames) {
      const tailFrames = Math.min(frames - produced, this.tailRemaining), heldSourceMs = this.lastSourceMs;
      this.fadeTail(output, produced, frames);
      if (tailFrames) this.boundDeadline(deadline, clock, heldSourceMs,
        (produced + tailFrames) * 1000 / this.outputRate / deviceRate, 0);
      this.recover('underrun');
    }
    this.deadlineSourceMs = this.lastSourceMs;
    if (!this.checkDeadline(deadline, clock, null, 0, 0, output, frames, contextMs)) return 0;
    if (produced > 0) { this.hasEmitted = true; this.voiceWaitStartedAt = undefined; }
    // Preparation is a finite transition. Once its exact prefix is drained,
    // continue through the ordinary renderer with the same live filter state;
    // steady voice playback does not allocate per-quantum staging objects.
    if (this.voicePreparation === preparation && preparation.prepared === 0) this.voicePreparation = null;
    return produced;
  }
  mixFreshBlock(input, inputFrame, output, outputFrame, frames, lastSourceMs) {
    if (!frames) return;
    // Source identity is scalar metadata. Only a still-contributing saved tail
    // can make the final sample older than its freshly emitted source sample.
    const remaining = this.recoveryRemaining;
    this.kernel.fresh(input, inputFrame, output, outputFrame, frames, this);
    this.lastSourceMs = remaining > frames && Number.isFinite(this.recoverySourceMs)
      ? Math.min(lastSourceMs, this.recoverySourceMs) : lastSourceMs;
  }
  /** targetMs is the raw Android-media position due at the speaker for this quantum. */
  render(targetMs, contextMs, clock, frames, output, deviceRate = 1, deadline = null) {
    output.fill(0); this.outputFrames += frames;
    this.sourceDeadlineState = 'unknown'; this.sourceDeltaMs = this.sourceDeltaUpperMs = null;
    this.sourceDeadlineUncertaintyMs = null;
    this.sourceDeadlineReason = deadline?.unknownReason || 'no-output';
    this.deadlineSourceMs = null;
    this.lastContextTimeMs = Number.isFinite(contextMs) ? contextMs + frames * 1000 / this.outputRate : null;
    const sourceRate = this.sourceClock.advance(contextMs), clockRate = clock?.rate || 1;
    if (this.voicePreparation) return this.renderVoicePreparation(contextMs, clock, frames, output, deviceRate, deadline, sourceRate);
    if (this.backend && clock && clock.generation !== this.clockGeneration && clock.state !== 'stale') this.recover('clock-generation');
    if (this.backend && Number.isFinite(targetMs)) this.checkPhase(targetMs, contextMs, deviceRate, deadline);
    if (!this.backend && Number.isFinite(targetMs)) this.start(targetMs, clock?.generation);
    if (!this.backend) {
      const hadTail = this.tailRemaining > 0;
      const tailFrames = Math.min(frames, this.tailRemaining);
      if (hadTail) this.deadlineSourceMs = this.lastSourceMs;
      this.fadeTail(output, 0, frames); this.recoveryTail.set(this.last); this.recoveryRemaining = this.tailRemaining;
      this.recoverySourceMs = this.lastSourceMs;
      // An inactive cursor is not newly emitted content. Still validate an
      // actual fade tail, including explicitly silent PCM, before it can play.
      if (hadTail) this.checkDeadline(deadline, clock, this.deadlineSourceMs, tailFrames * 1000 / this.outputRate / deviceRate, 0, output, frames, contextMs);
      return 0;
    }
    const correction = Math.max(-PHASE_CORRECTION_LIMIT, Math.min(PHASE_CORRECTION_LIMIT, this.phaseErrorMs / 10000));
    this.deviceRate = deviceRate; this.phaseCorrectionPpm = correction * 1e6;
    const nextRatio = this.rate / this.outputRate * sourceRate / clockRate / deviceRate * (1 + correction);
    this.backend.setRatio(nextRatio, frames);
    const firstRatio = this.slewRatio, firstSourceMs = this.rawCursorMs;
    // Reuse the deadline's slowest-ratio bound for individual emitted samples.
    // A retired last sample must not inherit a whole render block's extra age.
    const sourceMsPerFrame = Math.min(firstRatio, nextRatio) * 1000 / this.rate / sourceRate;
    const recoverySourceMs = this.recoverySourceMs, recoveryFrames = this.recoveryRemaining;
    let heldSourceMs = null, heldFrames = 0;
    let produced = 0, needInput = false;
    for (let call = 0; call < 16 && produced < frames; call++) {
      // Keep filter state across network packet boundaries; never flush at a temporary shortage.
      // Drain the filter before feeding again: producer lead belongs to the bounded PCM queue.
      const available = needInput ? this.read(this.inputFrame, Math.min(4096, Math.ceil((frames - produced) * nextRatio) + Math.ceil(this.rate * 0.006))) : 0;
      const result = this.backend.process(this.input, available, this.output, frames - produced);
      this.inputFrame += result.consumed;
      this.mixFreshBlock(this.output, 0, output, produced, result.produced,
        firstSourceMs + (produced + result.produced - 1) * sourceMsPerFrame);
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
    if (produced < frames) {
      heldSourceMs = this.lastSourceMs; heldFrames = Math.min(frames - produced, this.tailRemaining);
      this.fadeTail(output, produced, frames); this.recover('underrun');
    }
    this.deadlineSourceMs = this.lastSourceMs;
    const localSpan = produced * 1000 / this.outputRate / deviceRate;
    const sourceSpan = produced * Math.min(firstRatio, finalRatio) * 1000 / this.rate / sourceRate * (clock?.rate || 1);
    // Bound every fresh sample and held tail over its actual output interval.
    // A partial render must not inherit the zero-filled remainder of a larger
    // block as extra source age; a full render keeps the original quantum bound.
    if (recoveryFrames > 1 && produced > 0) this.boundDeadline(deadline, clock, recoverySourceMs,
      Math.min(recoveryFrames - 1, produced) * 1000 / this.outputRate / deviceRate, 0);
    if (heldFrames > 0) this.boundDeadline(deadline, clock, heldSourceMs,
      (produced + heldFrames) * 1000 / this.outputRate / deviceRate, 0);
    if (!this.checkDeadline(deadline, clock, produced > 0 ? firstSourceMs : null, localSpan, sourceSpan, output, frames, contextMs)) return 0;
    if (produced > 0) this.hasEmitted = true;
    return produced;
  }
  boundDeadline(deadline, clock, firstSourceMs, localSpan, sourceSpan) {
    const candidate = this.deadlineScratch;
    sourceDeadlineAt(deadline, clock, firstSourceMs, localSpan, sourceSpan, candidate);
    if (candidate.sourceDeadlineState !== 'unknown' && (this.sourceDeadlineState === 'unknown'
      || candidate.sourceDeltaUpperMs > this.sourceDeltaUpperMs)) {
      this.sourceDeadlineState = candidate.sourceDeadlineState;
      this.sourceDeltaMs = candidate.sourceDeltaMs; this.sourceDeltaUpperMs = candidate.sourceDeltaUpperMs;
      this.sourceDeadlineUncertaintyMs = candidate.sourceDeadlineUncertaintyMs;
      this.sourceDeadlineReason = candidate.sourceDeadlineReason;
    }
  }
  checkDeadline(deadline, clock, firstSourceMs, localSpan, sourceSpan, output, frames, contextMs) {
    // Bound actual PCM and tail contributions within the quantum with the same
    // calculation used after a timeline has been reduced to a retired scalar tail.
    this.boundDeadline(deadline, clock, firstSourceMs, localSpan, sourceSpan);
    if (this.sourceDeadlineState === 'violated') {
      // A periodic snapshot can already show healthy output after this
      // rejection. Preserve its bounded Debug evidence before retiring DSP.
      if (this.counters) this.lastSourceDeadline = {
        upperMs: Number.isFinite(this.sourceDeltaUpperMs) ? this.sourceDeltaUpperMs : null,
        uncertaintyMs: Number.isFinite(this.sourceDeadlineUncertaintyMs) && this.sourceDeadlineUncertaintyMs >= 0
          ? this.sourceDeadlineUncertaintyMs : null,
        limitMs: Number.isFinite(deadline.limitMs) && deadline.limitMs >= 0 ? deadline.limitMs : null,
        contextMs: Number.isFinite(contextMs) && contextMs >= 0 ? contextMs : null,
      };
      // The whole quantum is still application-owned. Never emit expired
      // content or crossfade an expired recovery tail into fresh output.
      output.fill(0); this.sourceDeadlineRejectedFrames += frames;
      const infeasibleReason = this.state === 'infeasible' ? this.reason : null;
      this.recover('source-deadline');
      // Preserve a stronger startup feasibility failure while retiring its expired DSP tail.
      if (infeasibleReason) { this.state = 'infeasible'; this.reason = infeasibleReason; }
      this.last.fill(0); this.recoveryTail.fill(0);
      this.recoveryRemaining = this.tailRemaining = 0;
      this.lastSourceMs = this.recoverySourceMs = this.deadlineSourceMs = null;
      return false;
    }
    return true;
  }
  fadeTail(output, from, frames) {
    this.kernel.tail(output, from, frames - from, this);
  }
  reference(contextTimeMs) {
    const step = this.lastClockStep;
    return { type: this.type, semanticType: this.semanticType, mode: this.mode, epoch: this.epoch, generation: this.generation,
      anchoring: this.arrivalPlayback ? 'arrival' : 'presentation',
      senderTimingState: this.arrivalPlayback ? 'arrival-anchored-unverified' : this.synchronized ? 'mapped-presentation' : 'unavailable',
      senderRelativePolicyCeilingMs: this.mode === 'carplay' && this.synchronized && !this.arrivalPlayback ? 300 : null,
      senderCeilingViolations: this.senderCeilingViolations || 0,
      sourceStartupDelayMs: this.sourceStartupDelayMs ?? null,
      ...(this.mode === 'carplay' && this.semanticType >= 1 && this.semanticType <= 4 ? {
        voicePreparationState: this.voicePreparationState, voicePreparedFrames: this.voicePreparedFrames,
        voiceRequiredFrames: this.voiceRequiredFrames, voiceWaitMs: this.voiceWaitMs } : {}),
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
      ...(Number.isFinite(step?.phaseErrorMs) ? { lastClockStepPhaseErrorMs: step.phaseErrorMs } : {}),
      ...(Number.isFinite(step?.deviceRatePpm) ? { lastClockStepDeviceRatePpm: step.deviceRatePpm } : {}),
      ...(Number.isFinite(step?.uncertaintyMs) ? { lastClockStepUncertaintyMs: step.uncertaintyMs } : {}),
      ...(Number.isFinite(step?.contextMs) && Number.isFinite(contextTimeMs) && contextTimeMs >= step.contextMs
        ? { lastClockStepAgeMs: contextTimeMs - step.contextMs } : {}),
      sourceRatePpm: (this.sourceClock.rate - 1) * 1e6, sourceRateConfidence: this.sourceClock.confidence };
  }
  stats() {
    const source = this.counters ? this.sourceClock.snapshot(this.lastContextTimeMs) : null;
    const deadline = this.counters ? this.lastSourceDeadline : null;
    return { ...this.counters, queueBytes: this.bytes, queuePackets: this.queue.length,
      headMs: this.queue.length ? this.sourceAnchorMs + this.queue[0].first * 1000 / this.rate : null,
      tailMs: this.queue.length ? this.sourceAnchorMs + this.queue.at(-1).end * 1000 / this.rate : null,
      playbackMs: this.rawCursorMs, outputFrames: this.outputFrames, state: this.state, ...this.reference(this.lastContextTimeMs),
      ...(Number.isFinite(deadline?.upperMs) ? { lastSourceDeadlineDeltaUpperMs: deadline.upperMs } : {}),
      ...(Number.isFinite(deadline?.uncertaintyMs) ? { lastSourceDeadlineUncertaintyMs: deadline.uncertaintyMs } : {}),
      ...(Number.isFinite(deadline?.limitMs) ? { lastSourceDeadlineLimitMs: deadline.limitMs } : {}),
      ...(Number.isFinite(deadline?.contextMs) && Number.isFinite(this.lastContextTimeMs) && this.lastContextTimeMs >= deadline.contextMs
        ? { lastSourceDeadlineAgeMs: this.lastContextTimeMs - deadline.contextMs } : {}),
      ...(source ? { sourceClockFitStatus: this.buffered ? 'disabled' : source.status,
        sourceClockFitRejectReason: this.buffered ? 'buffered-prefetch' : source.reason,
        sourceClockPoints: source.points, sourceClockSpanMs: source.spanMs, sourceClockFitRejected: source.rejected,
        ...(Number.isFinite(source.dispersionMs) ? { sourceClockDispersionMs: source.dispersionMs } : {}),
        ...(Number.isFinite(source.acceptedFitAgeMs) ? { sourceClockAcceptedFitAgeMs: source.acceptedFitAgeMs } : {}) } : {}) };
  }
}
