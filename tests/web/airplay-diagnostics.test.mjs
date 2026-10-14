import test from 'node:test';
import assert from 'node:assert/strict';
import { airplayDiagnostic, createAirPlayDiagnostics, sanitizeErrorText } from '../../site/play/airplay-diagnostics.js';

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
