// SPDX-License-Identifier: GPL-3.0-only
const LANGUAGE_ALIASES = { eng: 'en', zho: 'zh', chi: 'zh', jpn: 'ja', kor: 'ko', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', ita: 'it', por: 'pt', rus: 'ru' };
export function audioTrackLabel(name, language, locale, index) {
  if (name) return name;
  if (language && language !== 'und') {
    try { return new Intl.DisplayNames([locale || 'en'], { type: 'language' }).of(LANGUAGE_ALIASES[language] || language); } catch (_) { return language; }
  }
  return `${String(locale).startsWith('zh') ? '音轨' : 'Audio'} ${index + 1}`;
}
export function preferredAudioTrack(tracks, languages = []) {
  const normalize = value => LANGUAGE_ALIASES[String(value).toLowerCase()] || String(value).toLowerCase().split('-')[0];
  for (const language of languages) {
    const match = tracks.find(track => normalize(track.language) === normalize(language));
    if (match) return match;
  }
  return null;
}

/** Stable native-like list consumed by Video.js's public audio-track feature. */
export function createAudioTrackList(onSelect) {
  const list = new EventTarget();
  let entries = [], selected = null, indexed = 0;
  Object.defineProperty(list, 'length', { get: () => entries.length });
  list[Symbol.iterator] = () => entries[Symbol.iterator]();
  list.item = index => entries[index] ?? null;
  list.getTrackById = id => entries.find(track => track.id === id) ?? null;
  list.replace = (descriptors, selectedId) => {
    for (let index = 0; index < indexed; index++) delete list[index];
    for (const track of entries) { const event = new Event('removetrack'); event.track = track; list.dispatchEvent(event); }
    selected = selectedId;
    entries = descriptors.map(descriptor => Object.defineProperty({ ...descriptor }, 'enabled', {
      enumerable: true, get: () => selected === descriptor.id,
      set: value => { if (value && selected !== descriptor.id) onSelect(descriptor.id); },
    }));
    entries.forEach((track, index) => {
      list[index] = track; const event = new Event('addtrack'); event.track = track; list.dispatchEvent(event);
    });
    indexed = entries.length; list.dispatchEvent(new Event('change'));
  };
  list.select = id => {
    if (!list.getTrackById(id) || selected === id) return false;
    selected = id; list.dispatchEvent(new Event('change')); return true;
  };
  return list;
}
