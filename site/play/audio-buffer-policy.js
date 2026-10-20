// SPDX-License-Identifier: GPL-3.0-only
import { MAX_MEDIA_DELAY } from './delay-plan.js';

// BufferedAudioStream feeds two seconds ahead of its receiver-owned 400 ms anchor.
// Retain that lead plus playback delay, clock jitter and a complete accepted PCM packet.
export const BUFFERED_FEED_LEAD_MS = 2000;
export const BUFFERED_START_LATENCY_MS = 400;
export const AUDIO_CLOCK_MARGIN_MS = 250;
const AUDIO_SCHEDULING_MARGIN_MS = 125;
export const MAX_PCM_PACKET_MS = 1000;
export const BUFFERED_AUDIO_WINDOW_MS = BUFFERED_FEED_LEAD_MS + BUFFERED_START_LATENCY_MS
  + MAX_MEDIA_DELAY + AUDIO_SCHEDULING_MARGIN_MS + AUDIO_CLOCK_MARGIN_MS + MAX_PCM_PACKET_MS;
export const MAX_AUDIO_AHEAD_BYTES = 1024 * 1024;
export const MAX_DECODED_PACKET_BYTES = 64 * 1024;
export const MAX_TIMELINE_PACKETS = 512;
