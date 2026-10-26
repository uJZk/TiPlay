/*! SPDX-License-Identifier: GPL-3.0-only */
// SDP defaults are not a measured receive ceiling. Probe only the existing
// profiles at the product's bounded format; this does not establish hardware
// decoding, sustained level throughput or physical presentation performance.
const TARGET_LEVEL = '2a'; // H.264 level 4.2, sufficient for 1920x1080 at 60 fps.
const EMPTY_LEVELS = Object.freeze({});
const LEVELS = new Set([10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62]);
const PROFILES = [
  [0x42, 0x4f, 0x40], [0x4d, 0x8f, 0x80], [0x58, 0xcf, 0xc0], // constrained baseline
  [0x42, 0x4f, 0x00], [0x58, 0xcf, 0x80], // baseline
  [0x4d, 0xaf, 0x00], // main
  [0x64, 0xff, 0x0c], [0x64, 0xff, 0x00], // constrained high, high
];
function legalProfile(prefix) {
  if (!/^[0-9a-f]{4}$/i.test(prefix)) return false;
  const id = parseInt(prefix.slice(0, 2), 16), flags = parseInt(prefix.slice(2), 16);
  return PROFILES.some(([profile, mask, value]) => id === profile && (flags & mask) === value);
}
function h264Parameters(line) {
  if (typeof line !== 'string' || line.length > 4096 || /[^\x20-\x7e\t]/.test(line)) return null;
  const parameters = new Map(); let offset = 0, profileOffset = null;
  for (const part of line.split(';')) {
    const match = /^([ \t]*)([A-Za-z0-9!#$%&'*+.^_`|~-]+)([ \t]*=[ \t]*)([^;]*?)([ \t]*)$/.exec(part);
    if (!match || !match[4] || parameters.has(match[2].toLowerCase())) return null;
    const key = match[2].toLowerCase(); parameters.set(key, match[4]);
    if (key === 'profile-level-id') profileOffset = offset + match[1].length + match[2].length + match[3].length;
    offset += part.length + 1;
  }
  const profileLevel = parameters.get('profile-level-id');
  if (parameters.get('packetization-mode') !== '1' || !/^[0-9a-f]{6}$/i.test(profileLevel || '')
    || parameters.has('level-asymmetry-allowed') && !/^[01]$/.test(parameters.get('level-asymmetry-allowed'))) return null;
  const profile = profileLevel.slice(0, 4).toLowerCase(), level = parseInt(profileLevel.slice(4), 16);
  return legalProfile(profile) && LEVELS.has(level) ? { profile, level, profileOffset } : null;
}
function nativeDecodingInfo() {
  try {
    const capabilities = globalThis.navigator?.mediaCapabilities;
    return typeof capabilities?.decodingInfo === 'function' ? capabilities.decodingInfo.bind(capabilities) : null;
  } catch (_) { return null; }
}

/** Probe existing H264 profiles only; the returned policy is immutable and has a fixed 4.2 ceiling. */
export async function probeRtcVideoReceiveLevels(codecs, { decodingInfo = nativeDecodingInfo(),
  width = 1920, height = 1080, framerate = 60, bitrate = 20000000 } = {}) {
  if (typeof decodingInfo !== 'function' || !Array.isArray(codecs) || codecs.length > 128
    || !Number.isInteger(width) || width < 1 || width > 1920 || !Number.isInteger(height) || height < 1 || height > 1080
    || !Number.isFinite(framerate) || framerate <= 0 || framerate > 60
    || !Number.isFinite(bitrate) || bitrate <= 0 || bitrate > 20000000) return EMPTY_LEVELS;
  const profiles = new Set();
  for (const codec of codecs) {
    if (!/^video\/H264$/i.test(codec?.mimeType || '') || codec.clockRate !== undefined && codec.clockRate !== 90000) continue;
    const parameters = h264Parameters(codec.sdpFmtpLine);
    if (parameters && parameters.level < parseInt(TARGET_LEVEL, 16)) profiles.add(parameters.profile);
  }
  if (!profiles.size) return EMPTY_LEVELS;
  let timer;
  const started = performance.now(), deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), 1200); });
  const probes = Promise.all([...profiles].map(async profile => {
    try {
      const result = await decodingInfo({ type: 'webrtc', video: {
        contentType: `video/H264;profile-level-id=${profile}${TARGET_LEVEL}`, width, height, bitrate, framerate,
      } });
      return result?.supported === true && result.smooth === true ? profile : null;
    } catch (_) { return null; }
  }));
  let supported;
  try { supported = await Promise.race([probes, deadline]); }
  finally { clearTimeout(timer); }
  // Results arriving after the deadline cannot mutate the already returned policy.
  return supported && performance.now() - started < 1200
    ? Object.freeze(Object.fromEntries(supported.filter(Boolean).map(profile => [profile, TARGET_LEVEL]))) : EMPTY_LEVELS;
}

/** Raise only a proven existing receive profile's level byte; every other SDP byte is retained. */
export function applyRtcVideoReceiveLevels(sdp, levels) {
  if (typeof sdp !== 'string' || sdp.length > 48 * 1024 || !levels || typeof levels !== 'object' || Array.isArray(levels)) return sdp;
  const permitted = new Set();
  try {
    const entries = Object.entries(levels);
    if (entries.length > 128) return sdp;
    for (const [profile, target] of entries) if (target === TARGET_LEVEL && legalProfile(profile)) permitted.add(profile.toLowerCase());
  } catch (_) { return sdp; }
  if (!permitted.size) return sdp;
  if (new TextEncoder().encode(sdp).byteLength > 48 * 1024) return sdp;
  const lines = sdp.split(/(\r\n|\n)/);
  if (lines.some((line, index) => index % 2 === 0 && line.includes('\r'))) return sdp;
  const sections = []; let section = null;
  for (let index = 0; index < lines.length; index += 2) {
    if (lines[index].startsWith('m=')) { section = { index, lines: [] }; sections.push(section); }
    else section?.lines.push(index);
  }
  for (const section of sections) {
    const media = /^m=video ([1-9][0-9]*)(?:\/[1-9][0-9]*)? (?:UDP\/TLS\/RTP\/SAVPF|TCP\/TLS\/RTP\/SAVPF) ([0-9 ]+)$/i.exec(lines[section.index]);
    if (!media || Number(media[1]) > 65535) continue;
    const payloads = media[2].split(' ');
    if (payloads.some(value => !/^(?:0|[1-9][0-9]*)$/.test(value) || Number(value) > 127) || new Set(payloads).size !== payloads.length) continue;
    const directions = section.lines.filter(index => /^a=(?:recvonly|sendonly|sendrecv|inactive)$/.test(lines[index]));
    if (directions.length !== 1 || lines[directions[0]] !== 'a=recvonly') continue;
    const mappings = new Map(), formats = new Map(); let malformed = false;
    for (const index of section.lines) {
      const mapping = /^a=rtpmap:([0-9]+)(?:[ \t]+(.*))?$/.exec(lines[index]);
      const format = /^a=fmtp:([0-9]+)(?:[ \t]+(.*))?$/.exec(lines[index]);
      const entry = mapping || format;
      if (!entry) { if (/^a=(?:rtpmap|fmtp):/.test(lines[index])) malformed = true; continue; }
      if (!/^(?:0|[1-9][0-9]*)$/.test(entry[1]) || Number(entry[1]) > 127) { malformed = true; continue; }
      const collection = mapping ? mappings : formats, previous = collection.get(entry[1]);
      collection.set(entry[1], previous ? { duplicate: true } : { value: entry[2], index });
    }
    if (malformed) continue;
    for (const payload of payloads) {
      const mapping = mappings.get(payload), format = formats.get(payload);
      if (!mapping || mapping.duplicate || !/^H264\/90000[ \t]*$/i.test(mapping.value || '') || !format || format.duplicate) continue;
      const parameters = h264Parameters(format.value);
      if (!parameters || !permitted.has(parameters.profile) || parameters.level >= parseInt(TARGET_LEVEL, 16)) continue;
      const prefix = lines[format.index].length - format.value.length;
      const levelOffset = prefix + parameters.profileOffset + 4;
      lines[format.index] = lines[format.index].slice(0, levelOffset) + TARGET_LEVEL + lines[format.index].slice(levelOffset + 2);
    }
  }
  return lines.join('');
}
