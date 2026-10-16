// SPDX-License-Identifier: GPL-3.0-only
import { requireSdrTrack } from './airplay-sdr.js';

const checkAbort = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Media playback was interrupted.', 'AbortError'); };
const unsupported = () => new DOMException('This browser cannot decode the media codec.', 'NotSupportedError');

/** Keep hydration out of Mediabunny's concurrent query sorter. Default ranking reads master metadata;
 * only the selected candidate may load a child playlist/segment, then a failed candidate is excluded. */
export async function selectPlayableTrack(select, { signal, video = false } = {}) {
  const attempted = new Set();
  let failure = null;
  while (true) {
    checkAbort(signal);
    const track = await select({ filter: candidate => !attempted.has(candidate) });
    checkAbort(signal);
    if (!track) { if (failure) throw failure; return null; }
    if (attempted.has(track)) throw failure || unsupported();
    attempted.add(track);
    try {
      if (video) await requireSdrTrack(track);
      checkAbort(signal);
      const supported = await track.canDecode();
      checkAbort(signal);
      if (supported) return track;
      failure = unsupported();
    } catch (cause) {
      checkAbort(signal);
      if (cause?.name === 'AbortError') throw cause;
      failure = cause;
    }
  }
}

/** Audio menu discovery is sequential too; an unavailable rendition must not discard usable audio. */
export async function decodableAudioTracks(candidates, { signal } = {}) {
  const result = [];
  for (const track of candidates) {
    checkAbort(signal);
    try {
      const supported = await track.canDecode();
      checkAbort(signal);
      if (supported) result.push(track);
    } catch (cause) {
      checkAbort(signal);
      if (cause?.name === 'AbortError') throw cause;
    }
  }
  return result;
}
