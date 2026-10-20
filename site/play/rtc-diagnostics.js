/*! SPDX-License-Identifier: GPL-3.0-only */
const STAGES = new Set(['local-ice', 'pairing', 'remote-ice', 'dc-auth', 'connected']);
const STATES = new Set(['new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed', 'gathering', 'complete', 'connecting']);

/** Counts only: addresses, SDP credentials and certificate material never enter diagnostic snapshots. */
export function candidateCounts(sdp) {
  const counts = { total: 0, linkLocal: 0, udp: 0, tcp: 0, privateIpv4: 0, cgnatIpv4: 0, ipv6: 0, mdns: 0 };
  for (const line of String(sdp ?? '').split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    counts.total++;
    const fields = line.trim().split(/\s+/), protocol = fields[2]?.toLowerCase(), address = fields[4] ?? '';
    if (protocol === 'udp' || protocol === 'tcp') counts[protocol]++;
    if (/\.local\.?$/i.test(address)) counts.mdns++;
    else if (address.includes(':')) counts.ipv6++;
    else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
      const octets = address.split('.').map(Number), [a, b] = octets;
      if (octets.some(value => value > 255)) continue;
      if (a === 169 && b === 254) counts.linkLocal++;
      else if (a === 100 && b >= 64 && b <= 127) counts.cgnatIpv4++;
      else if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) counts.privateIpv4++;
    }
  }
  return counts;
}

const CANDIDATE_DIMENSIONS = { Candidates: 'total', LinkLocalCandidates: 'linkLocal', UdpCandidates: 'udp', TcpCandidates: 'tcp',
  PrivateIpv4Candidates: 'privateIpv4', CgnatIpv4Candidates: 'cgnatIpv4', Ipv6Candidates: 'ipv6', MdnsCandidates: 'mdns' };

export function candidateDiagnosticFields(prefix, counts) {
  return Object.fromEntries(Object.entries(CANDIDATE_DIMENSIONS).map(([name, key]) => [prefix + name, counts[key]]));
}

export function rtcFailureReason(error) {
  if (error?.status === 404) return 'missing-interface';
  if (error?.status === 503) return 'android-signaling';
  if (error?.status === 429) return 'throttled';
  if (error?.status === 401) return 'bad-code';
  if (error?.status === 409) return 'replaced';
  if (['fetch', 'pairing', 'bad-response', 'timeout', 'ice', 'unsupported'].includes(error?.rtcReason)) return error.rtcReason;
  const message = String(error?.message ?? '');
  if (/timed? out|timeout/i.test(message)) return 'timeout';
  if (/WebRTC DataChannel is unavailable/.test(message)) return 'unsupported';
  if (/RTC (failed|disconnected)|channel (closed|error)/.test(message)) return 'ice';
  return 'connection';
}

/** Safe to display or capture even when a native exception's message contains SDP. */
export function rtcFailureSummary(error) {
  const source = error?.rtcDiagnostic ?? {};
  const result = { reason: rtcFailureReason(error), stage: STAGES.has(source.stage) ? source.stage : null };
  for (const key of ['local', 'remote'].flatMap(prefix => Object.keys(candidateDiagnosticFields(prefix, {})))) {
    result[key] = Number.isInteger(source[key]) && source[key] >= 0 ? source[key] : null;
  }
  for (const key of ['iceState', 'gatheringState', 'connectionState']) {
    result[key] = STATES.has(source[key]) ? source[key] : null;
  }
  for (const key of ['videoChannelState', 'audioChannelState', 'controlChannelState']) {
    result[key] = ['connecting', 'open', 'closing', 'closed', 'unavailable'].includes(source[key]) ? source[key] : null;
  }
  return result;
}
