/*! SPDX-License-Identifier: GPL-3.0-only */
import { MAX_AUDIO_AHEAD_BYTES } from './audio-buffer-policy.js';
import { AudioKernel } from './wasm/audio-core.js';

const RATE = 48000, CHUNK = 480;
const unwrap = (value, near) => near + ((value - (near >>> 0)) | 0);

/** One source stream. NetEq alone owns jitter delay and time stretching. */
export class NetEqAudio {
  constructor(neteq, rate, channels, outputRate, credit, { codec = 'pcm', type, semanticType = type, mode, epoch, generation } = {}) {
    Object.assign(this, { rate, channels, outputRate, credit, codec, type, semanticType, mode, epoch, generation });
    if (rate !== RATE || outputRate !== RATE) throw Error('NetEq requires a 48 kHz graph and input.');
    this.engine = neteq.create(codec, channels);
    this.kernel = new AudioKernel();
    this.input = new Float32Array(4096 * channels);
    this.chunk = new Float32Array(CHUNK * channels); this.chunkFrames = 0; this.chunkStart = 0;
    this.decoded = new Float32Array(CHUNK * channels); this.decodedOffset = CHUNK;
    this.sequence = 0; this.inputFrame = this.sourceFrame = this.outputFrames = this.endFrame = this.endExact = 0;
    this.tokens = []; this.queueBytes = 0; this.state = 'priming'; this.ended = false; this.closed = false;
    this.playedNear = 0; this.clockMs = null; this.last = new Float32Array(channels);
    this.fadeFrames = Math.max(1, Math.round(outputRate * .005)); this.tailRemaining = 0;
    this.outputDrained = false;
  }
  timestamp(record) {
    const us = Number.isFinite(record.decodeTimestampUs) ? record.decodeTimestampUs : null;
    if (us === null) return this.endExact;
    this.originUs ??= us;
    return (us - this.originUs) * RATE / 1e6;
  }
  insert(bytes, timestamp, arrival) {
    if (!this.engine.insert(bytes, this.sequence++, timestamp, arrival)) throw new Error('NetEq rejected an audio packet.');
  }
  pcmSamples(samples, frames, arrival) {
    let offset = 0;
    while (offset < frames) {
      if (!this.chunkFrames) this.chunkStart = this.inputFrame;
      const count = Math.min(CHUNK - this.chunkFrames, frames - offset);
      this.chunk.set(samples.subarray(offset * this.channels, (offset + count) * this.channels), this.chunkFrames * this.channels);
      this.chunkFrames += count; this.inputFrame += count; offset += count;
      if (this.chunkFrames === CHUNK) this.submitChunk(arrival);
    }
  }

  submitChunk(arrival) {
    if (!this.engine.insertPcm(this.chunk, this.chunkFrames, this.sequence++, this.chunkStart, arrival)) throw new Error('NetEq rejected PCM audio.');
    this.chunkFrames = 0;
  }
  push(record, nowMs) {
    if (this.closed || this.ended) throw new Error('Audio arrived after its stream ended.');
    const size = record.pcm?.byteLength ?? record.payload?.byteLength ?? 0;
    if (this.queueBytes + size > MAX_AUDIO_AHEAD_BYTES || this.tokens.length >= 1024) throw new Error('NetEq stream exceeds its input memory limit.');
    const arrival = Number.isFinite(record.arrivalLocalTimeMs) ? record.arrivalLocalTimeMs : nowMs;
    this.clockMs ??= arrival;
    this.lastArrivalMs = arrival;
    const exactStart = this.timestamp(record), start = Math.round(exactStart);
    // Timestamp gaps remain gaps; packet arrival time never becomes a source timestamp.
    if (this.codec === 'pcm' && start < this.endFrame - 1) { this.credit(size, record.generation, 'late'); return; }
    if (this.codec === 'opus') {
      this.insert(new Uint8Array(record.payload), start, arrival);
      // Encoded packet reordering/duplicates belong to NetEq, not this adapter.
      this.endExact = Math.max(this.endExact, exactStart + this.engine.packetFrames()); this.endFrame = Math.round(this.endExact);
      this.inputFrame = this.endFrame;
    } else {
      const pcm = new Int16Array(record.pcm), frames = pcm.length / this.channels;
      if (!Number.isInteger(frames) || !frames || frames > this.rate) throw new Error('Invalid NetEq PCM input.');
      if (start > this.endFrame + 1) {
        if (this.chunkFrames) this.submitChunk(arrival);
        this.inputFrame = start;
      }
      for (let offset = 0; offset < frames;) {
        const count = Math.min(4096, frames - offset);
        this.kernel.pcm16(pcm, offset * this.channels, this.input, 0, count * this.channels);
        this.pcmSamples(this.input, count, arrival); offset += count;
      }
      this.endExact = exactStart + frames * RATE / this.rate; this.endFrame = Math.round(this.endExact);
    }
    this.tokens.push({ bytes: size, end: this.endFrame, generation: record.generation }); this.queueBytes += size;
  }
  finish(nowMs = this.lastArrivalMs ?? 0) {
    if (this.closed || this.ended) return;
    if (this.chunkFrames) this.submitChunk(nowMs);
    this.ended = true;
  }
  pull(nowMs) {
    if (this.ended && this.sourceFrame >= this.endFrame) return 0;
    const count = this.engine.pull(this.decoded, nowMs);
    if (!count) return 0;
    const timestamp = this.engine.timestamp();
    if (timestamp >= 0) {
      this.playedNear = unwrap(timestamp, this.playedNear);
      this.sourceFrame = this.playedNear;
      while (this.tokens.length && this.tokens[0].end <= this.sourceFrame) {
        const token = this.tokens.shift(); this.queueBytes -= token.bytes;
        this.credit(token.bytes, token.generation, 'played');
      }
    }
    this.decodedOffset = 0;
    return count;
  }
  render(output, frames, nowMs) {
    output.fill(0, 0, frames * this.channels);
    if (this.closed || this.clockMs === null) return 0;
    let produced = 0;
    while (produced < frames) {
      if (this.decodedOffset === CHUNK && !this.pull(nowMs + produced * 1000 / this.outputRate)) break;
      const count = Math.min(frames - produced, CHUNK - this.decodedOffset);
      output.set(this.decoded.subarray(this.decodedOffset * this.channels, (this.decodedOffset + count) * this.channels), produced * this.channels);
      this.decodedOffset += count; produced += count;
    }
    this.outputFrames += frames;
    if (produced) {
      for (let c = 0; c < this.channels; c++) this.last[c] = output[(produced - 1) * this.channels + c];
      this.tailRemaining = this.fadeFrames;
    }
    if (produced < frames && this.ended && this.tailRemaining) {
      const count = Math.min(frames - produced, this.tailRemaining);
      this.kernel.tail(output, produced, count, this); produced += count;
    }
    this.state = this.ended && !produced && !this.tailRemaining ? 'ended' : produced ? 'playing' : 'priming';
    if (this.state === 'ended') this.release('played');
    return produced;
  }
  release(reason) {
    for (const token of this.tokens) this.credit(token.bytes, token.generation, reason);
    this.tokens.length = 0; this.queueBytes = 0;
  }
  stats() { return { ...this.engine.stats(), backend: 'neteq', codec: this.codec, state: this.state,
    queueBytes: this.queueBytes, queuePackets: this.tokens.length, rate: this.rate, channels: this.channels,
    sourceFrame: this.sourceFrame, inputFrame: this.inputFrame, outputFrames: this.outputFrames }; }
  clear() {
    if (this.closed) return;
    this.release('reset'); this.engine.dispose(); this.closed = true;
  }
}
