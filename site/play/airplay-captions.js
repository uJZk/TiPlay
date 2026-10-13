// SPDX-License-Identifier: GPL-3.0-only
/** Keep native/HLS caption cues visible above the canvas while the video is hidden. */
export function createVideoCaptions(video, surface) {
  const overlay = document.createElement('div');
  overlay.className = 'airplay-captions'; surface.append(overlay);
  const tracks = video.textTracks, attached = new Set();
  function render() {
    const lines = [];
    for (const track of tracks) {
      if (track.mode !== 'showing' || !['captions', 'subtitles'].includes(track.kind)) continue;
      for (const cue of track.activeCues ?? []) lines.push(cue.getCueAsHTML?.().textContent ?? cue.text);
    }
    // Render cue text as text, never as markup supplied by the media source.
    overlay.textContent = lines.join('\n');
    overlay.hidden = !lines.length;
  }
  function refresh() {
    for (const track of attached) if (![...tracks].includes(track)) {
      track.removeEventListener('cuechange', render); attached.delete(track);
    }
    for (const track of tracks) if (!attached.has(track)) {
      track.addEventListener('cuechange', render); attached.add(track);
    }
    render();
  }
  for (const type of ['addtrack', 'removetrack', 'change']) tracks.addEventListener(type, refresh);
  refresh();
  return { dispose() {
    for (const type of ['addtrack', 'removetrack', 'change']) tracks.removeEventListener(type, refresh);
    for (const track of attached) track.removeEventListener('cuechange', render);
    attached.clear(); overlay.remove();
  } };
}
