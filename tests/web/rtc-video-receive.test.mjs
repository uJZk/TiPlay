// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeRtcVideoReceiveLevels, applyRtcVideoReceiveLevels } from '../../site/play/rtc-video-receive.js';

const codec = (profile = '42e01f', fields = {}) => ({ mimeType: 'video/H264', clockRate: 90000,
  sdpFmtpLine: `level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${profile}`, ...fields });
const supported = async () => ({ supported: true, smooth: true, powerEfficient: false });
const settle = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const header = ['v=0', 'o=- 123 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE video audio', 'a=ice-ufrag:unchanged', 'a=ice-pwd:unchanged-password',
  'a=fingerprint:sha-256 AA:BB:CC', 'a=setup:actpass'].join('\r\n') + '\r\n';
const section = (lines = [], { kind = 'video', direction = 'recvonly', payloads = '96', mid = kind } = {}) =>
  [`m=${kind} 9 UDP/TLS/RTP/SAVPF ${payloads}`, `a=mid:${mid}`, ...(direction ? [`a=${direction}`] : []), ...lines].join('\r\n') + '\r\n';
const mapping = (profile = '42e01f', pt = 96, extra = '') => [
  `a=rtpmap:${pt} H264/90000`,
  `a=fmtp:${pt} level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${profile}${extra}`,
];
const offer = (...sections) => header + sections.join('');

test('receive level probes query the original H264 profile at product dimensions and require smooth decoding', async () => {
  const codecs = Object.freeze(['42e01f', '42001f', '4d001f', '640c1f', '64001f'].map(value => Object.freeze(codec(value))));
  const calls = [];
  const levels = await probeRtcVideoReceiveLevels(codecs, { decodingInfo: async value => { calls.push(value); return supported(); } });
  assert.deepEqual(levels, { '42e0': '2a', '4200': '2a', '4d00': '2a', '640c': '2a', '6400': '2a' });
  assert.equal(Object.getPrototypeOf(levels), Object.prototype);
  assert.equal(Object.isFrozen(levels), true);
  assert.throws(() => { levels['42e0'] = 'ff'; }, TypeError);
  assert.equal(calls.length, 5);
  for (let index = 0; index < calls.length; index++) assert.deepEqual(calls[index], {
    type: 'webrtc', video: { contentType: `video/H264;profile-level-id=${codecs[index].sdpFmtpLine.slice(-6, -2)}2a`,
      width: 1920, height: 1080, framerate: 60, bitrate: 20_000_000 },
  });
  assert.equal(codecs[0].sdpFmtpLine.endsWith('42e01f'), true, 'capabilities are never rewritten');
});

test('unsupported, nonsmooth, missing and throwing decodingInfo never grant a receive level', async () => {
  for (const result of [undefined, null, {}, { supported: true }, { supported: true, smooth: false },
    { supported: false, smooth: true }, { supported: 1, smooth: true }, { supported: true, smooth: 1 }]) {
    const levels = await probeRtcVideoReceiveLevels([codec()], { decodingInfo: async () => result });
    assert.deepEqual(levels, {}); assert.equal(Object.isFrozen(levels), true);
  }
  for (const decodingInfo of [null, 1, () => { throw Error('unsupported API configuration'); },
    async () => { throw Error('rejected codec'); }])
    assert.deepEqual(await probeRtcVideoReceiveLevels([codec()], { decodingInfo }), {});
});

test('the default decodingInfo keeps its native receiver binding and tolerates absent media capabilities', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
  let calls = 0;
  const capabilities = { async decodingInfo() { assert.equal(this, capabilities); calls++; return { supported: true, smooth: true }; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaCapabilities: capabilities } });
  assert.deepEqual(await probeRtcVideoReceiveLevels([codec()]), { '42e0': '2a' }); assert.equal(calls, 1);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  assert.deepEqual(await probeRtcVideoReceiveLevels([codec()]), {});
});

test('probe only considers original H264 mode 1 codecs with a legal profile and lower current level', async () => {
  const calls = [];
  const invalid = [
    codec('42e01f', { mimeType: 'video/H265' }), codec('42e01f', { mimeType: 'video/VP8' }),
    codec('42e01f', { sdpFmtpLine: 'packetization-mode=0;profile-level-id=42e01f' }),
    codec('42e01f', { sdpFmtpLine: 'profile-level-id=42e01f' }),
    codec('42e01f', { sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f;PROFILE-LEVEL-ID=42e01f' }),
    codec('42e01f', { sdpFmtpLine: 'packetization-mode=1;packetization-mode=1;profile-level-id=42e01f' }),
    ...['f4001f', '12341f', '42e11f', '64011f', '42e000', '42e0ff', '42e02a', '42e033', '42e01', 'nothex'].map(value => codec(value)),
    null, {},
  ];
  assert.deepEqual(await probeRtcVideoReceiveLevels(invalid, { decodingInfo: async value => { calls.push(value); return supported(); } }), {});
  assert.deepEqual(calls, [], 'invalid and already sufficient capabilities do not trigger speculative queries');
});

test('probe normalizes hex and deduplicates the same H264 profile without changing input records', async () => {
  const original = [codec('42E01F'), codec('42e015')], before = structuredClone(original), calls = [];
  const levels = await probeRtcVideoReceiveLevels(original, { decodingInfo: async value => { calls.push(value); return supported(); } });
  assert.deepEqual(levels, { '42e0': '2a' }); assert.equal(calls.length, 1);
  assert.deepEqual(original, before);
  assert.equal(calls[0].video.contentType, 'video/H264;profile-level-id=42e02a');
});

test('probe rejects oversized capability lists and formats outside product limits before querying', async () => {
  const calls = [], decodingInfo = async value => { calls.push(value); return supported(); };
  assert.deepEqual(await probeRtcVideoReceiveLevels(Array.from({ length: 129 }, () => codec()), { decodingInfo }), {});
  assert.deepEqual(await probeRtcVideoReceiveLevels({}, { decodingInfo }), {});
  for (const bounds of [{ width: 1921 }, { width: 0 }, { width: 1.5 }, { width: Number.NaN },
    { height: 1081 }, { height: -1 }, { height: Number.POSITIVE_INFINITY }, { framerate: 61 },
    { framerate: 0 }, { framerate: Number.NaN }, { bitrate: 20_000_001 }, { bitrate: 0 }, { bitrate: Number.POSITIVE_INFINITY }])
    assert.deepEqual(await probeRtcVideoReceiveLevels([codec()], { decodingInfo, ...bounds }), {});
  assert.deepEqual(calls, []);
  const levels = await probeRtcVideoReceiveLevels([codec()], { decodingInfo, width: 1280, height: 720, framerate: 30, bitrate: 5_000_000 });
  assert.deepEqual(levels, { '42e0': '2a' });
  assert.deepEqual(calls[0], { type: 'webrtc', video: { contentType: 'video/H264;profile-level-id=42e02a',
    width: 1280, height: 720, framerate: 30, bitrate: 5_000_000 } });
});

test('one overall deadline returns no partial grants and late query replies cannot mutate the result', async t => {
  let timeout, resolveLate;
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.push(delay); timeout = callback; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const pending = probeRtcVideoReceiveLevels([codec('42e01f'), codec('64001f')], {
    decodingInfo: async value => value.video.contentType.includes('42e0')
      ? { supported: true, smooth: true } : new Promise(resolve => { resolveLate = resolve; }),
  });
  await settle();
  assert.deepEqual(timers, [1200], 'all capability work shares a bounded startup budget');
  assert.equal(typeof resolveLate, 'function');
  timeout(); const levels = await pending;
  assert.deepEqual(levels, {}); assert.equal(Object.isFrozen(levels), true);
  resolveLate({ supported: true, smooth: true }); await settle();
  assert.deepEqual(levels, {}, 'timed-out results cannot be populated by late completions');
});

test('a slow synchronous capability call cannot beat the elapsed startup budget through microtask ordering', async t => {
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  for (const elapsed of [1199, 1200, 1300]) {
    now = 100;
    const levels = await probeRtcVideoReceiveLevels([codec()], { decodingInfo: () => {
      now += elapsed; return { supported: true, smooth: true };
    } });
    assert.deepEqual(levels, elapsed < 1200 ? { '42e0': '2a' } : {}, `elapsed ${elapsed} ms`);
  }
});

test('receive-only SDP changes only the final level byte of a successfully probed existing H264 payload', () => {
  const lines = mapping('42E01F');
  lines.push('a=rtcp-fb:96 nack pli', 'a=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid',
    'a=candidate:1 1 UDP 2122260223 192.0.2.10 50000 typ host', 'a=end-of-candidates');
  const sdp = offer(section(lines));
  const levels = Object.freeze({ '42e0': '2a' });
  assert.equal(applyRtcVideoReceiveLevels(sdp, levels), sdp.replace('profile-level-id=42E01F', 'profile-level-id=42E02a'));
  assert.equal(sdp.includes('profile-level-id=42E01F'), true);
  assert.deepEqual(levels, { '42e0': '2a' });
});

test('only matching probed profiles and lower levels change; PTs and original profile bytes stay intact', () => {
  const sdp = offer(section([...mapping('42e01f', 96), ...mapping('42001f', 97), ...mapping('64002a', 98),
    ...mapping('640033', 99)], { payloads: '96 97 98 99' }));
  const result = applyRtcVideoReceiveLevels(sdp, { '42e0': '2a', '6400': '2a' });
  assert.equal(result, sdp.replace('profile-level-id=42e01f', 'profile-level-id=42e02a'));
  assert.equal(applyRtcVideoReceiveLevels(sdp, { '42e0': '33', '4200': '29', '6400': 'ff' }), sdp,
    'caller-supplied arbitrary receive levels cannot expand the policy');
});

test('other media sections, inherited direction and non-receive-only video stay byte-identical', () => {
  const untouched = [section(mapping(), { kind: 'audio' }), section(mapping(), { direction: 'sendonly', mid: 'send' }),
    section(mapping(), { direction: 'sendrecv', mid: 'both' }), section(mapping(), { direction: 'inactive', mid: 'off' }),
    section(mapping(), { direction: '', mid: 'implicit' })].join('');
  const receiving = section(mapping(), { mid: 'receive' });
  const sdp = header + 'a=recvonly\r\n' + untouched + receiving;
  assert.equal(applyRtcVideoReceiveLevels(sdp, { '42e0': '2a' }),
    header + 'a=recvonly\r\n' + untouched + receiving.replace('42e01f', '42e02a'));
});

test('ambiguous directions, duplicate payloads or duplicate mappings never rewrite the affected section', () => {
  const cases = [
    section([...mapping(), 'a=recvonly']), section([...mapping(), 'a=sendrecv']),
    section(mapping(), { payloads: '96 96' }), section([...mapping(), 'a=rtpmap:96 H264/90000']),
    section([...mapping(), 'a=rtpmap:96 H265/90000']), section([...mapping(), mapping()[1]]),
    section([...mapping(), 'a=fmtp:96 packetization-mode=1;profile-level-id=42e015']),
    section([...mapping(), 'a=rtpmap:096 H264/90000']),
    section([...mapping(), 'a=fmtp:096 packetization-mode=1;profile-level-id=42e015']),
  ];
  for (const value of cases) assert.equal(applyRtcVideoReceiveLevels(offer(value), { '42e0': '2a' }), offer(value));
});

test('duplicate or malformed fmtp, unsupported packetization and invalid profile or level remain untouched', () => {
  const fmtp = [
    'packetization-mode=1;profile-level-id=42e01f;profile-level-id=42e01f',
    'packetization-mode=1;profile-level-id=42e01f;PROFILE-LEVEL-ID=42e01f',
    'packetization-mode=1;packetization-mode=1;profile-level-id=42e01f',
    'packetization-mode=0;profile-level-id=42e01f', 'profile-level-id=42e01f',
    'packetization-mode=1;profile-level-id=42e01f;level-asymmetry-allowed=1;level-asymmetry-allowed=1',
    'packetization-mode=1;profile-level-id=42e01f;broken',
    ...['42e11f', '64011f', 'f4001f', 'unknown', '42e000', '42e0ff'].map(value => `packetization-mode=1;profile-level-id=${value}`),
  ];
  for (const value of fmtp) {
    const sdp = offer(section(['a=rtpmap:96 H264/90000', `a=fmtp:96 ${value}`]));
    assert.equal(applyRtcVideoReceiveLevels(sdp, { '42e0': '2a', '42e1': '2a', '6401': '2a', 'f400': '2a' }), sdp);
  }
});

test('absent or mismatched RTP attributes do not create codec mappings or payload IDs', () => {
  for (const lines of [[], [mapping()[0]], [mapping()[1]],
    ['a=rtpmap:96 H265/90000', mapping()[1]], ['a=rtpmap:96 H264/48000', mapping()[1]],
    ['a=rtpmap:96 H264/90000/2', mapping()[1]], ['a=rtpmap:97 H264/90000', mapping()[1]],
    ['a=rtpmap:96 H264/90000', mapping('42e01f', 97)[1]]]) {
    const sdp = offer(section(lines));
    assert.equal(applyRtcVideoReceiveLevels(sdp, { '42e0': '2a' }), sdp);
  }
});

test('SDP line endings and all unrelated bytes survive a valid receive-level update', () => {
  for (const ending of ['\r\n', '\n']) {
    const sdp = offer(section(mapping('640c1f'))).replaceAll('\r\n', ending);
    assert.equal(applyRtcVideoReceiveLevels(sdp, { '640c': '2a' }), sdp.replace('640c1f', '640c2a'));
  }
});

test('malformed media ports, transports or payload numbers cannot acquire receive-level changes', () => {
  const sdp = offer(section(mapping()));
  for (const replacement of ['m=video 0 UDP/TLS/RTP/SAVPF 96', 'm=video 65536 UDP/TLS/RTP/SAVPF 96',
    'm=video 9 RTP/AVP 96', 'm=video 9 UDP/TLS/RTP/SAVPF 128', 'm=video 9 UDP/TLS/RTP/SAVPF 096']) {
    const malformed = sdp.replace('m=video 9 UDP/TLS/RTP/SAVPF 96', replacement);
    assert.equal(applyRtcVideoReceiveLevels(malformed, { '42e0': '2a' }), malformed);
  }
  const tcp = sdp.replace('UDP/TLS/RTP/SAVPF', 'TCP/TLS/RTP/SAVPF');
  assert.equal(applyRtcVideoReceiveLevels(tcp, { '42e0': '2a' }), tcp.replace('42e01f', '42e02a'));
  for (const attribute of ['a=rtpmap:broken', 'a=fmtp:broken', 'a=rtpmap:128 H264/90000', 'a=fmtp:128 packetization-mode=1;profile-level-id=42e01f']) {
    const malformed = offer(section([...mapping(), attribute]));
    assert.equal(applyRtcVideoReceiveLevels(malformed, { '42e0': '2a' }), malformed);
  }
});

test('SDP size bounds count UTF-8 bytes, and malformed receive policies never expand SDP', () => {
  const sdp = offer(section(mapping()));
  for (const padding of ['x'.repeat(48 * 1024), '界'.repeat(17_000)]) {
    const oversized = header + `a=custom:${padding}\r\n` + section(mapping());
    assert.ok(new TextEncoder().encode(oversized).byteLength > 48 * 1024);
    assert.equal(applyRtcVideoReceiveLevels(oversized, { '42e0': '2a' }), oversized);
  }
  for (const levels of [null, [], '2a', { '42e0': 42 }, { '42e0': '2A' }, { '42e0': '33' },
    Object.create({ '42e0': '2a' }), Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`invalid${index}`, '2a']))])
    assert.equal(applyRtcVideoReceiveLevels(sdp, levels), sdp);
  const malformedEnding = sdp.replace('a=mid:video\r\n', 'a=mid:video\ra=custom:bad\r\n');
  assert.equal(applyRtcVideoReceiveLevels(malformedEnding, { '42e0': '2a' }), malformedEnding);
});
