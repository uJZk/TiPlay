// SPDX-License-Identifier: GPL-3.0-only
/** Track selection descriptors only; AVPlayer owns subtitle parsing, timing and rendering. */
export function createSubtitleTrackList(select) {
  const list = new EventTarget();
  let tracks = [];
  Object.defineProperty(list, 'length', { get: () => tracks.length });
  list[Symbol.iterator] = () => tracks[Symbol.iterator]();
  list.item = index => tracks[index] || null;
  list.getTrackById = id => tracks.find(track => track.id === id) || null;
  list.replace = descriptors => {
    const previous = tracks;
    for (let index = 0; index < previous.length; index++) delete list[index];
    tracks = descriptors.map(descriptor => {
      let mode = 'disabled';
      const track = Object.assign(new EventTarget(), descriptor, { kind: 'subtitles', supported: true });
      Object.defineProperty(track, 'mode', { enumerable: true, get: () => mode, set: value => {
        if (!['disabled', 'hidden', 'showing'].includes(value) || value === mode) return;
        if (value === 'showing') {
          for (const other of tracks) if (other !== track && other.mode !== 'disabled') other.mode = 'disabled';
        }
        mode = value; select(track.id, value === 'showing'); list.dispatchEvent(new Event('change'));
      } });
      return track;
    });
    tracks.forEach((track, index) => { list[index] = track; });
    for (const track of previous) list.dispatchEvent(Object.assign(new Event('removetrack'), { track }));
    for (const track of tracks) list.dispatchEvent(Object.assign(new Event('addtrack'), { track }));
    list.dispatchEvent(new Event('change'));
  };
  return list;
}
