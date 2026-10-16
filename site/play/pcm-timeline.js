/*! SPDX-License-Identifier: GPL-3.0-only */
import { MAX_AUDIO_AHEAD_BYTES, MAX_PCM_PACKET_MS, MAX_TIMELINE_PACKETS } from './audio-buffer-policy.js';
/** Missing packets leave silence at their source time; late packets cannot shift later audio. */
export class PcmTimeline {
  constructor(rate, channels, consumed, maximumMs = 1000, { buffered = false } = {}) {
    this.rate = rate; this.channels = channels; this.consumed = consumed;
    this.queue = []; this.sequences = new Set(); this.through = -Infinity; this.maximumMs = maximumMs;
    this.buffered = buffered; this.bytes = 0; this.counters = null;
  }
  debug(enabled) { this.counters = enabled ? { capacityPackets: 0, latePackets: 0, duplicatePackets: 0, playedPackets: 0, resetPackets: 0, invalidPackets: 0 } : null; }
  discard(packet, reason) {
    this.sequences.delete(packet.sequence); this.bytes -= packet.pcm.byteLength;
    if (this.counters) this.counters[reason + 'Packets']++;
    this.consumed(packet.pcm.byteLength, reason);
  }
  reject(bytes, reason) {
    if (this.counters) this.counters[reason + 'Packets']++;
    this.consumed(bytes, reason);
  }
  clear() { for (const packet of this.queue) this.discard(packet, 'reset'); this.queue = []; this.through = -Infinity; }
  push(data) {
    const pcm = new Int16Array(data.pcm), end = data.sourceTime + pcm.length / this.channels / this.rate * 1000;
    if (end <= this.through) { this.reject(pcm.byteLength, 'late'); return; }
    if (end - data.sourceTime > MAX_PCM_PACKET_MS) { this.reject(pcm.byteLength, 'invalid'); return; }
    if (this.sequences.has(data.sequence)) { this.reject(pcm.byteLength, 'duplicate'); return; }
    const packet = { pcm, start: data.sourceTime, end, sequence: data.sequence, rendered: false };
    this.sequences.add(packet.sequence); this.queue.push(packet); this.bytes += pcm.byteLength; this.queue.sort((a, b) => a.start - b.start);
    while (this.queue.length > MAX_TIMELINE_PACKETS || this.bytes > MAX_AUDIO_AHEAD_BYTES
      || (this.queue.length > 1 && this.queue.at(-1).end - this.queue[0].start > this.maximumMs)) {
      // Buffered future arrivals must not continually evict the sample that is about to play.
      // Live streams instead retain the newest bounded window to recover from a stalled consumer.
      this.discard(this.buffered ? this.queue.pop() : this.queue.shift(), 'capacity');
    }
  }
  active(time) {
    for (let i = 0; i < this.queue.length; i++) {
      const packet = this.queue[i];
      if (packet.start <= time && packet.end > time) return true;
    }
    return false;
  }
  sample(time, channel) {
    if (!Number.isFinite(time)) return 0;
    // A discontinuous/backwards clock must never replay samples; normal delay plans advance continuously.
    if (time < this.through) return 0;
    this.through = Math.max(this.through, time);
    while (this.queue.length && this.queue[0].end <= time) {
      const expired = this.queue.shift(); this.discard(expired, expired.rendered ? 'played' : 'late');
    }
    const packet = this.queue[0];
    if (!packet || packet.start > time) return 0;
    packet.rendered = true;
    const position = (time - packet.start) * this.rate / 1000, frame = Math.floor(position), fraction = position - frame;
    const index = Math.min(frame * this.channels, packet.pcm.length - this.channels) + Math.min(channel, this.channels - 1);
    const next = Math.min(index + this.channels, packet.pcm.length - this.channels + Math.min(channel, this.channels - 1));
    return (packet.pcm[index] + (packet.pcm[next] - packet.pcm[index]) * fraction) / 32768;
  }
  stats() {
    return { ...this.counters, queueBytes: this.bytes, queuePackets: this.queue.length,
      headMs: this.queue[0]?.start ?? null, tailMs: this.queue.at(-1)?.end ?? null,
      playbackMs: Number.isFinite(this.playbackTime) ? this.playbackTime : null };
  }
}
