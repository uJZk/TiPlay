import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { airplayDiagnostic, createAirPlayDiagnostics, playbackDiagnostics, sanitizeErrorText } from '../../site/play/airplay-diagnostics.js';

function fixture() {
  const events = [];
  let active = true;
  const media = Object.assign(new EventTarget(), { currentTime: 20, duration: 100, paused: false,
    ended: false, seeking: false, readyState: 4, networkState: 2, error: null });
  const surface = Object.assign(new EventTarget(), { localName: 'media-time-slider' });
  const diagnostics = createAirPlayDiagnostics(event => events.push(event), {
    state: () => ({ id: 7, revision: 3 }), media: () => media, active: () => active,
  });
  diagnostics.monitor(media, surface);
  return { media, surface, diagnostics, events, retire: () => { active = false; } };
}

test('AirPlay diagnostics isolate an exception message getter and include only known fields', () => {
  const secret = 'https://private.example/video?code=secret&session=secret';
  const failure = { name: 'NotAllowedError', code: 4,
    get message() { throw new Error('Unavailable exception message'); }, url: secret };
  const entry = airplayDiagnostic('play-rejected', { id: 7, revision: 3, directUrl: secret, headers: secret }, {
    media: { currentTime: 20, duration: 100, paused: true, ended: false, seeking: false,
      readyState: 2, networkState: 1, error: failure, src: secret, currentSrc: secret }, dragging: true, error: failure,
  });
  assert.deepEqual(entry, { k: 'ap-diag', id: 7, revision: 3, event: 'play-rejected', dragging: true,
    position: 20, duration: 100, paused: true, ended: false, seeking: false,
    readyState: 2, networkState: 1, errorCode: 4, errorName: 'NotAllowedError' });
  assert.equal(JSON.stringify(entry).includes(secret), false);
  assert.equal(airplayDiagnostic('canvas-error', { id: 1, revision: 0 }, {
    error: { name: `Unexpected\n${secret}`, message: secret, stack: secret },
  }).errorName, 'OTHER');
});

test('AirPlay error text retains playback reasons while redacting resources, credentials and identities', () => {
  const prefix = 'Media request failed: ';
  const cases = [
    ['https://private.example/video?code=url-secret', ['private.example', 'url-secret']],
    ['mlhls://localhost/video?session=custom-secret', ['localhost', 'custom-secret']],
    ['https%3A%2F%2Fprivate.example%2Fvideo%3Ftoken%3Dencoded-secret', ['private.example', 'encoded-secret']],
    ['blob:https://private.example/blob-secret', ['private.example', 'blob-secret']],
    ['data:video/mp4;base64,AAAA-data-secret', ['video/mp4', 'AAAA-data-secret']],
    ['/airplay-resource?code=relative-secret&session=relative-session', ['airplay-resource', 'relative-secret', 'relative-session']],
    ['segments/master.m3u8?token=segment-secret', ['segments/master.m3u8', 'segment-secret']],
    ['Bearer bearer-secret', ['bearer-secret']],
    ['Basic dXNlcjpwYXNzd29yZA==', ['dXNlcjpwYXNzd29yZA==']],
    ['"token": "json secret with spaces"', ['json secret', 'with spaces']],
    ['"password": "escaped \\"quoted\\" secret"', ['escaped', 'quoted', 'secret']],
    ["password='single quoted secret'", ['single quoted secret']],
    ['token="unfinished-secret', ['unfinished-secret']],
    ["pairing record 'unfinished record", ['unfinished record']],
    ['sessionID=session-secret pairing_code=pair-secret code=123456', ['session-secret', 'pair-secret', '123456']],
    ['pairing code "123 456" pairing record \'record with spaces\'', ['123 456', 'record with spaces']],
    ['192.168.100.23:8080 [2001:db8::7]:7000 fe80::ab:1234%wlan0 ::1', ['192.168.100.23', '2001:db8', 'fe80', '1234', 'wlan0', '::1']],
    ['12:34:56:78:9a:bc 00112233-4455-6677-8899-aabbccddeeff', ['12:34:56:78:9a:bc', '00112233-4455-6677-8899-aabbccddeeff']],
    ['0123456789abcdef01234567 qwertyuiopASDFGHJKLzxcvbnm123456789', ['0123456789abcdef01234567', 'qwertyuiopASDFGHJKLzxcvbnm123456789']],
  ];
  for (const [input, secrets] of cases) {
    const text = sanitizeErrorText(prefix + input);
    assert.ok(text.startsWith(prefix), `Useful error context lost for ${input}`);
    for (const secret of secrets) assert.equal(text.includes(secret), false, `Leaked ${secret}`);
  }
  const reason = "play() failed because the user didn't interact with the document first.";
  assert.equal(sanitizeErrorText(reason), reason);
  const diagnostic = airplayDiagnostic('play-rejected', { id: 1, revision: 0 }, {
    error: new DOMException(reason, 'NotAllowedError'),
  });
  assert.equal(diagnostic.errorText, reason);
  assert.equal(diagnostic.errorName, 'NotAllowedError');
});

test('AirPlay error text redacts complete multiline secrets before single-line output and length limits', () => {
  const raw = 'Media failed\nAuthorization: Bearer short-header-secret\r\n' +
    'proxy-authorization=Basic proxy-secret\nCookie: cookie-secret\nSet-Cookie: set-cookie-secret\n' +
    '-----BEGIN PRIVATE KEY-----\nsmall pem secret\n-----END PRIVATE KEY-----\n' +
    'Decoder rejected unsupported format\u0000\u0085\u2028';
  const text = sanitizeErrorText(raw);
  for (const secret of ['short-header-secret', 'proxy-secret', 'cookie-secret', 'set-cookie-secret', 'small pem secret'])
    assert.equal(text.includes(secret), false, `Leaked multiline ${secret}`);
  assert.ok(text.includes('Decoder rejected unsupported format'));
  assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  const longQuotedSecret = 'Failed '.repeat(25) + 'password="' + 'secret words '.repeat(50) + '" remains unsupported';
  const limited = sanitizeErrorText(longQuotedSecret);
  assert.equal(limited.includes('secret words'), false);
  assert.ok(limited.includes('remains unsupported'));
  assert.ok(limited.length <= 240);
  assert.equal(sanitizeErrorText('x'.repeat(4097) + ' password=oversized-secret'), '[message omitted: too long]');
  assert.equal(sanitizeErrorText('ordinary '.repeat(100)).length, 240);
  for (const value of [null, undefined, 42, { message: 'unexpected type' }]) assert.equal(sanitizeErrorText(value), '');
});

test('invalid AirPlay IDs, revisions, events and non-finite media fields never cross the wire', () => {
  for (const state of [null, { id: 0, revision: 0 }, { id: 1.5, revision: 0 },
    { id: 1, revision: -1 }, { id: 1, revision: Infinity }, { id: 1, revision: 0.5 }])
    assert.equal(airplayDiagnostic('open', state), null);
  assert.equal(airplayDiagnostic('https://private.example/', { id: 1, revision: 0 }), null);
  assert.deepEqual(airplayDiagnostic('error', { id: 1, revision: 0 }, { media: {
    currentTime: NaN, duration: Infinity, paused: 'true', ended: 1, seeking: null,
    readyState: 5, networkState: -1, error: { code: 999, name: 'unknown' },
  } }), { k: 'ap-diag', id: 1, revision: 0, event: 'error', dragging: false, errorName: 'OTHER' });
});

test('media diagnostics observe seek, playback and failure edges without periodic or move reports', () => {
  const f = fixture();
  const expected = ['loadedmetadata', 'play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ended', 'error'];
  for (const name of expected) {
    f.media.seeking = name === 'seeking';
    f.media.ended = name === 'ended';
    f.media.error = name === 'error' ? { code: 3, name: 'NotSupportedError', message: 'private media URL' } : null;
    f.media.dispatchEvent(new Event(name));
  }
  for (let i = 0; i < 100; i++) {
    f.media.dispatchEvent(new Event('timeupdate'));
    f.surface.dispatchEvent(new Event('pointermove'));
  }
  assert.deepEqual(f.events.map(entry => entry.event), expected);
  assert.equal(f.events.find(entry => entry.event === 'seeking').seeking, true);
  assert.equal(f.events.find(entry => entry.event === 'ended').ended, true);
  assert.equal(f.events.at(-1).errorCode, 3);
  assert.equal(f.events.at(-1).errorName, 'NotSupportedError');
  f.diagnostics.dispose();
});

test('time-slider drag edges and cancellation are distinct from volume-slider gestures', () => {
  const f = fixture();
  f.surface.localName = 'media-volume-slider';
  for (const name of ['drag-start', 'drag-end', 'pointercancel']) f.surface.dispatchEvent(new Event(name));
  assert.equal(f.events.length, 0);
  f.surface.localName = 'media-time-slider';
  for (const name of ['drag-start', 'drag-end', 'drag-start', 'pointercancel']) f.surface.dispatchEvent(new Event(name));
  assert.deepEqual(f.events.map(entry => [entry.event, entry.dragging]), [
    ['drag-start', true], ['drag-end', false], ['drag-start', true], ['drag-cancel', false],
  ]);
  f.diagnostics.dispose();
});

test('retired players suppress late media edges, play promises and explicit diagnostics', () => {
  const f = fixture();
  f.retire();
  f.media.dispatchEvent(new Event('ended'));
  f.diagnostics.event('play-rejected', new DOMException('private URL', 'AbortError'));
  f.diagnostics.event('canvas-error', new Error('private URL'));
  assert.equal(f.events.length, 0);
  f.diagnostics.dispose();
  f.media.dispatchEvent(new Event('error'));
  f.surface.dispatchEvent(new Event('drag-start'));
  f.diagnostics.event('explicit-stop');
  assert.equal(f.events.length, 0);
});

test('play completion carries its command revision and diagnostic failures leave playback untouched', () => {
  const f = fixture();
  f.diagnostics.event('directive-play');
  f.diagnostics.event('play-resolved', undefined, { id: 7, revision: 2 });
  assert.deepEqual(f.events.map(entry => [entry.event, entry.revision]), [['directive-play', 3], ['play-resolved', 2]]);
  const diagnostics = createAirPlayDiagnostics(() => { throw new Error('control queue unavailable'); }, {
    state: () => ({ id: 1, revision: 0 }), media: () => f.media,
  });
  assert.doesNotThrow(() => diagnostics.event('explicit-stop'));
  assert.equal(f.media.paused, false);
  diagnostics.dispose(); f.diagnostics.dispose();
});

test('the cross-language engine fixture is actual bounded browser output', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/AirPlay-playback-diagnostics-v1.json', import.meta.url)));
  assert.deepEqual(airplayDiagnostic('engine-state', fixture.input.state, {
    media: { ...fixture.input.media, getPlaybackDiagnostics: () => fixture.input.engine },
  }), fixture.event);
  assert.deepEqual(airplayDiagnostic('engine-state', fixture.maximumInput.state, {
    media: { ...fixture.maximumInput.media, getPlaybackDiagnostics: () => fixture.maximumInput.engine },
  }), fixture.maximumEvent);
  assert.equal(Buffer.byteLength(JSON.stringify(fixture.event)), fixture.normalBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(fixture.maximumEvent)), fixture.maximumBytes);
  assert.equal(Object.keys(fixture.event.engine).length, 90);
  assert.ok(fixture.normalBytes <= 2700);
  assert.ok(fixture.maximumBytes <= 3700);
  assert.deepEqual(airplayDiagnostic('engine-state', fixture.continuityInput.state, {
    media: { ...fixture.continuityInput.media, getPlaybackDiagnostics: () => fixture.continuityInput.engine },
  }), fixture.continuityEvent);
  const failure = fixture.failureInput;
  assert.deepEqual(airplayDiagnostic('error', failure.state, {
    media: failure.media, error: failure.media.error, engineSnapshot: failure.before,
  }), fixture.failureEvent);
  assert.deepEqual(airplayDiagnostic('engine-state', failure.state, {
    media: failure.media, engineSnapshot: failure.after,
  }), fixture.cleanupEvent);
});

test('engine snapshots keep clock, watermark and decoder evidence without arbitrary fields', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../shared/src/test/resources/AirPlay-playback-diagnostics-v1.json', import.meta.url)));
  const secret = 'https://private.test/video?token=do-not-copy';
  const source = { ...fixture.input.engine, url: secret, trackLabel: secret, decoderConfig: { description: secret },
    position: Infinity, videoBytes: NaN, videoFrames: 1.5, waitReason: secret, contextState: secret };
  const snapshot = playbackDiagnostics({ getPlaybackDiagnostics: () => source });
  assert.equal(snapshot.resumePending, true);
  assert.equal(snapshot.audioReadPending, true);
  assert.equal(snapshot.targetMs, 1000);
  assert.equal(snapshot.videoCapacityFrames, 32);
  assert.equal(snapshot.audioCapacityBytes, 12582912);
  for (const key of ['url', 'trackLabel', 'decoderConfig', 'position', 'videoBytes', 'videoFrames', 'waitReason', 'contextState'])
    assert.equal(Object.hasOwn(snapshot, key), false);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(playbackDiagnostics({ getPlaybackDiagnostics() { throw new Error(secret); } }), null);
});

test('engine samples retain pending play and changing reasons with bounded stall and healthy frequency', () => {
  const events = []; let now = 0, active = true;
  const engine = { generation: 1, intentPlaying: true, running: false, contextState: 'suspended',
    resumePending: true, waitReason: 'audio-context-resume', position: 0 };
  const media = Object.assign(new EventTarget(), { getPlaybackDiagnostics: () => engine });
  const diagnostics = createAirPlayDiagnostics(entry => events.push(entry), {
    state: () => ({ id: 1, revision: 0 }), media: () => media, now: () => now, active: () => active,
  });
  diagnostics.monitor(media, new EventTarget());
  for (let i = 0; i < 100; i++) media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 1);
  now = 4750; media.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, 1);
  now = 5000; media.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, 2);
  engine.contextState = 'running'; engine.resumePending = false; engine.waitReason = 'startup-watermark';
  now = 5001; media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 2);
  now = 5250; media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 3);
  assert.equal(events.at(-1).engine.waitReason, 'startup-watermark');
  engine.running = true; engine.waitReason = 'none';
  now = 5500; media.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, 4);
  now = 15250; media.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, 4);
  now = 15500; media.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, 5);
  active = false; now += 10000; media.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, 5);
  diagnostics.dispose();
});

test('proxy fallback and live resync are observable bounded transitions', () => {
  const f = fixture();
  f.diagnostics.event('proxy-fallback');
  f.media.dispatchEvent(new Event('resync'));
  assert.deepEqual(f.events.map(entry => entry.event), ['proxy-fallback', 'resync']);
  f.diagnostics.dispose();
});

test('a settled old command cannot relabel the active generation snapshot with its retired revision', () => {
  const f = fixture();
  f.media.getPlaybackDiagnostics = () => ({ generation: 2, running: true, intentPlaying: true });
  f.diagnostics.event('play-resolved', undefined, { id: 7, revision: 2 });
  assert.equal(f.events[0].revision, 2);
  assert.equal(Object.hasOwn(f.events[0], 'engine'), false);
  f.diagnostics.event('playing');
  assert.equal(f.events[1].engine.generation, 2);
  f.diagnostics.dispose();
});

test('codec hints, application ownership, activation and resource progress use fixed bounded fields', () => {
  const source = { codec: 'av01.0.08M.08', codedWidth: 3840, codedHeight: 2160, displayWidth: 3840, displayHeight: 2160,
    observedSampleCadenceMs: 41.666666, observedSampleDurationMs: 41.666666,
    requestedHardwareAcceleration: 'prefer-hardware', hardwareSupportProbe: 'supported',
    requestedVideoLatencyHint: 'not-requested', requestedAudioLatencyHint: 'interactive',
    videoHeldFrames: 1, videoHeldBytes: 33177600, videoPendingFrames: 0, videoPendingBytes: 0,
    videoOwnedFrames: 3, videoOwnedBytes: 99532800, samplesReceived: 57, samplesClosed: 54,
    videoSinkReadPendingMs: 5300, lastSampleAgeMs: 5300, audioResumeRequests: 1, audioResumeCompleted: 0,
    audioResumeFailed: 0, userActivationHasBeenActive: false,
    resourceActive: 0, resourceQueued: 0, resourceBytes: 262144, resourceLastProgressAgeMs: 5400,
    resourceLastResult: 'eof', resourceLastStatus: 206, resourceTimeouts: 0, resourceCancellations: 1, resourceBackwardRestarts: 0, resourceRangeIgnored: 1,
    actualHardware: 'private hardware identifier', poolCapacity: 3, vendorBuffers: 8 };
  const output = playbackDiagnostics({ getPlaybackDiagnostics: () => source });
  assert.equal(output.codec, source.codec);
  assert.equal(output.observedSampleCadenceMs, 41.667);
  assert.equal(output.samplesClosed, 54);
  assert.equal(output.userActivationHasBeenActive, false);
  assert.equal(output.resourceRangeIgnored, 1);
  for (const key of ['actualHardware', 'poolCapacity', 'vendorBuffers']) assert.equal(Object.hasOwn(output, key), false);
  for (const codec of ['https://private.test/a', 'token=hidden', 'avc1.' + 'f'.repeat(44), 'avc1.secret/token'])
    assert.equal(Object.hasOwn(playbackDiagnostics({ getPlaybackDiagnostics: () => ({ codec }) }) ?? {}, 'codec'), false);
  const invalid = playbackDiagnostics({ getPlaybackDiagnostics: () => ({ ...source,
    codedWidth: 32769, displayHeight: -1, observedSampleCadenceMs: NaN, samplesClosed: 1.5,
    hardwareSupportProbe: 'actually-hardware', resourceLastResult: 'https://private.test', resourceLastStatus: 600, userActivationHasBeenActive: 'false' }) });
  for (const key of ['codedWidth', 'displayHeight', 'observedSampleCadenceMs', 'samplesClosed', 'hardwareSupportProbe', 'resourceLastResult', 'resourceLastStatus', 'userActivationHasBeenActive'])
    assert.equal(Object.hasOwn(invalid, key), false);
});

test('progress bursts are gated before expensive snapshots while playback edges remain immediate', () => {
  let time = 0, reads = 0;
  const events = [], engine = { generation: 1, running: false, intentPlaying: true, waitReason: 'preparing' };
  const media = Object.assign(new EventTarget(), { getPlaybackDiagnostics() { reads++; return engine; } });
  const diagnostics = createAirPlayDiagnostics(entry => events.push(entry), {
    state: () => ({ id: 1, revision: 0 }), media: () => media, now: () => time,
  });
  diagnostics.monitor(media, new EventTarget());
  for (let i = 0; i < 1000; i++) media.dispatchEvent(new Event('progress'));
  assert.equal(reads, 2); // One probe and the first emitted snapshot; all later probes are skipped.
  assert.equal(events.length, 1);
  time = 100; engine.waitReason = 'audio-context-resume';
  media.dispatchEvent(new Event('waiting'));
  assert.equal(reads, 3);
  assert.equal(events.at(-1).event, 'waiting');
  assert.equal(events.at(-1).engine.waitReason, 'audio-context-resume');
  time = 249; media.dispatchEvent(new Event('progress'));
  assert.equal(reads, 3);
  time = 250; media.dispatchEvent(new Event('progress'));
  assert.equal(reads, 5);
  assert.equal(events.at(-1).event, 'engine-state');
  assert.equal(events.at(-1).engine.waitReason, 'audio-context-resume');
  diagnostics.dispose();
});

test('the complete nine-component AV1 codec token survives while additional components remain invalid', () => {
  const codec = 'av01.0.08M.08.0.110.01.01.01.0';
  assert.equal(codec.split('.').length - 1, 9);
  assert.equal(playbackDiagnostics({ getPlaybackDiagnostics: () => ({ codec }) }).codec, codec);
  assert.equal(playbackDiagnostics({ getPlaybackDiagnostics: () => ({ codec: codec + '.0' }) }), null);
});

test('failure edges preserve sanitized pre-cleanup evidence and terminal ownership before player retirement', () => {
  const f = fixture();
  const before = { generation: 4, running: true, intentPlaying: true, waitReason: 'error', codec: 'av01.0.08M.08',
    hardwareSupportProbe: 'unavailable', videoOwnedFrames: 2, samplesReceived: 6, samplesClosed: 4,
    url: 'https://private.test/?token=secret', decoderConfig: { description: 'private media' } };
  const after = { generation: 4, running: false, intentPlaying: false, waitReason: 'error',
    videoOwnedFrames: 1, samplesReceived: 6, samplesClosed: 5 };
  f.media.getPlaybackDiagnostics = () => after;
  f.media.error = { code: 3, name: 'EncodingError', message: 'Decode failed for https://private.test/?token=secret' };
  const failure = Object.assign(new Event('error'), { error: f.media.error,
    playbackDiagnostics: before, cleanupDiagnostics: after });
  // This is the same listener ordering as controls' proxy fallback, which disposes the player.
  f.media.addEventListener('error', () => f.diagnostics.dispose());
  f.media.dispatchEvent(failure);
  assert.deepEqual(f.events.map(entry => entry.event), ['error', 'engine-state']);
  assert.equal(f.events[0].engine.codec, 'av01.0.08M.08');
  assert.equal(f.events[0].engine.running, true);
  assert.equal(f.events[0].engine.hardwareSupportProbe, 'unavailable');
  assert.equal(f.events[1].engine.videoOwnedFrames, 1);
  assert.equal(f.events[1].engine.samplesClosed, 5);
  assert.equal(f.events[1].engine.intentPlaying, false);
  assert.equal(JSON.stringify(f.events).includes('private'), false);
  assert.equal(JSON.stringify(f.events).includes('secret'), false);
  before.samplesClosed = 6;
  assert.equal(f.events[0].engine.samplesClosed, 4);
});

test('identical terminal snapshots do not duplicate a fault edge', () => {
  const f = fixture();
  const snapshot = { generation: 1, running: false, intentPlaying: false, waitReason: 'error', samplesClosed: 0 };
  f.media.dispatchEvent(Object.assign(new Event('error'), { playbackDiagnostics: snapshot, cleanupDiagnostics: snapshot }));
  assert.deepEqual(f.events.map(entry => entry.event), ['error']);
  f.diagnostics.dispose();
});

test('PCM continuity uses bounded scalar evidence and changed anomalies use the existing five-second cadence', () => {
  const events = []; let time = 0;
  const engine = { generation: 1, running: true, intentPlaying: true, waitReason: 'none',
    audioSourceRate: 44100, audioRequestedContextRate: 44100, audioContextRate: 44100, audioSourceChannels: 2,
    audioDecodedFrames: 1024, audioSeekTrimmedFrames: 0, audioOverlapTrimmedFrames: 0, audioAlignedPackets: 1,
    audioAlignmentMaxUs: 11.111, audioSilenceFrames: 0, audioScheduledFrames: 1024,
    audioScheduleGapUs: 0, audioScheduleOverlapUs: 0, audioLateStarts: 0, audioLateStartMaxMs: 0,
    audioPcmPeak: 0.73, audioPcmOverFullScaleSamples: 0, audioNonFiniteSamples: 0 };
  const media = Object.assign(new EventTarget(), { getPlaybackDiagnostics: () => engine });
  const diagnostics = createAirPlayDiagnostics(entry => events.push(entry), {
    state: () => ({ id: 1, revision: 0 }), media: () => media, now: () => time,
  });
  diagnostics.monitor(media, new EventTarget());
  media.dispatchEvent(new Event('progress'));
  time = 5000; engine.audioDecodedFrames++; engine.audioSeekTrimmedFrames++; engine.audioAlignedPackets++;
  media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 1, 'normal PCM growth and initial seek clipping do not cause fault cadence');
  engine.audioSilenceFrames = 1; time = 5250; media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 2);
  assert.equal(events.at(-1).engine.audioSilenceFrames, 1);
  engine.audioScheduleGapUs = 22.676; time = 5500; media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 2);
  time = 10250; media.dispatchEvent(new Event('progress'));
  assert.equal(events.length, 3);
  assert.equal(events.at(-1).engine.audioScheduleGapUs, 22.676);
  diagnostics.dispose();
  const invalid = playbackDiagnostics({ getPlaybackDiagnostics: () => ({ ...engine,
    audioSourceRate: 0, audioContextRate: 384001, audioSourceChannels: 9, audioDecodedFrames: 1.5,
    audioPcmPeak: Infinity, audioScheduleGapUs: -1, samples: new Float32Array([0.5]), url: 'private' }) });
  for (const key of ['audioSourceRate', 'audioContextRate', 'audioSourceChannels', 'audioDecodedFrames',
    'audioPcmPeak', 'audioScheduleGapUs', 'samples', 'url']) assert.equal(Object.hasOwn(invalid, key), false);
});
