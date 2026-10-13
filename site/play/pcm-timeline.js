/*! SPDX-License-Identifier: GPL-3.0-only */
/** Missing packets leave silence at their source time; late packets cannot shift later audio. */
export class PcmTimeline {
  constructor(rate, channels, consumed, maximumMs = 1000) {
    this.rate = rate; this.channels = channels; this.consumed = consumed;
    this.queue = []; this.sequences = new Set(); this.through = -Infinity; this.maximumMs = maximumMs;
  }
  discard(packet) { this.sequences.delete(packet.sequence); this.consumed(packet.pcm.byteLength); }
  clear() { for (const packet of this.queue) this.discard(packet); this.queue = []; this.through = -Infinity; }
  push(data) {
    const pcm = new Int16Array(data.pcm), end = data.sourceTime + pcm.length / this.channels / this.rate * 1000;
    if (end <= this.through || end - data.sourceTime > 1000 || this.sequences.has(data.sequence)) { this.consumed(pcm.byteLength); return; }
    const packet = { pcm, start: data.sourceTime, end, sequence: data.sequence };
    this.sequences.add(packet.sequence); this.queue.push(packet); this.queue.sort((a, b) => a.start - b.start);
    while (this.queue.length > 160 || (this.queue.length > 1 && this.queue.at(-1).end - this.queue[0].start > this.maximumMs)) this.discard(this.queue.shift());
  }
  active(time) {
    for (let i = 0; i < this.queue.length; i++) {
      const packet = this.queue[i];
      if (packet.start <= time && packet.end > time) return true;
    }
    return false;
  }
  sample(time, channel) {
    // A discontinuous/backwards clock must never replay samples; normal delay plans advance continuously.
    if (time < this.through) return 0;
    this.through = Math.max(this.through, time);
    while (this.queue.length && this.queue[0].end <= time) this.discard(this.queue.shift());
    const packet = this.queue[0];
    if (!packet || packet.start > time) return 0;
    const position = (time - packet.start) * this.rate / 1000, frame = Math.floor(position), fraction = position - frame;
    const index = Math.min(frame * this.channels, packet.pcm.length - this.channels) + Math.min(channel, this.channels - 1);
    const next = Math.min(index + this.channels, packet.pcm.length - this.channels + Math.min(channel, this.channels - 1));
    return (packet.pcm[index] + (packet.pcm[next] - packet.pcm[index]) * fraction) / 32768;
  }
}
