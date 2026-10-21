import test from 'node:test';
import assert from 'node:assert/strict';
import { directiveSeekTarget } from '../../site/play/airplay-controls.js';
import { createMediaEngine } from '../../site/play/airplay-media.js';

const flush = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

function fixture({ metadataGate = null } = {}) {
  let wall = 0, callback, decoderStarts = 0;
  const stages = [];
  const video = { canDecode: async () => true, getDecoderConfig: async () => ({ codec: 'avc1.42001e' }),
    getPrimaryPairableAudioTrack: async () => null, getDisplayWidth: async () => 16,
    getDisplayHeight: async () => 9 };
  class Input {
    constructor({ source }) { this.src = source.src; }
    async getPrimaryVideoTrack() { return video; }
    async getFirstTimestamp() { if (this.src === 'first' && metadataGate) await metadataGate; return 0; }
    async getDurationFromMetadata() { return 20; }
    dispose() {}
  }
  class VideoSampleSink {
    constructor() { decoderStarts++; }
    async *samples(start) {
      for (let at = start; at < 20; at += 0.1)
        yield { timestamp: at, duration: 0.1, codedWidth: 16, codedHeight: 9, close() {} };
    }
  }
  const media = createMediaEngine(null, { library: { Input, VideoSampleSink,
    UrlSource: class { constructor(src) { this.src = src; } }, ALL_FORMATS: [] },
  now: () => wall, requestFrame: next => { callback = next; return 1; }, cancelFrame: () => {},
  presenter: { present() {}, clear() {}, dispose() {} } });
  media.addEventListener('progress', () => stages.push(media.getPlaybackDiagnostics().startupPhase));
  return { media, stages, decoderStarts: () => decoderStarts, advance: time => { wall += time; },
    async tick(time = 0) { wall += time; callback(); await flush(); } };
}

test('initial zero directive reuses prepared frames while initial and subsequent explicit seeks still work', async () => {
  const h = fixture();
  await h.media.load('first'); await flush();
  const initialGeneration = h.media.getPlaybackDiagnostics().generation;
  const apply = (directive, initial) => {
    const target = directiveSeekTarget(h.media, directive, initial);
    if (target !== null) h.media.currentTime = target;
  };
  apply({ target: 0 }, true); await flush();
  assert.equal(h.decoderStarts(), 1);
  assert.equal(h.media.getPlaybackDiagnostics().generation, initialGeneration);
  // The newest command received during preparation can target a nonzero position.
  apply({ target: 5 }, true); await flush();
  assert.equal(h.media.currentTime, 5); assert.equal(h.decoderStarts(), 2);
  apply({ target: 0 }, false); await flush();
  assert.equal(h.media.currentTime, 0); assert.equal(h.decoderStarts(), 3);
  apply({ target: 0 }, false); await flush();
  assert.equal(h.decoderStarts(), 4, 'a later explicit same-position seek retains its semantics');
  h.media.dispose();
});

test('startup phase measures source preparation and freezes at actual playing across later seeks', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = fixture({ metadataGate: gate });
  assert.equal(h.media.getPlaybackDiagnostics().startupPhase, 'none');
  assert.equal(h.media.getPlaybackDiagnostics().openElapsedMs, undefined);
  const loading = h.media.load('first'); await flush(); h.advance(3);
  assert.equal(h.media.getPlaybackDiagnostics().startupPhase, 'metadata');
  assert.equal(h.media.getPlaybackDiagnostics().phaseElapsedMs, 3000);
  release(); await loading; await flush();
  assert.equal(h.media.getPlaybackDiagnostics().startupPhase, 'ready');
  const playing = h.media.play(); await flush(); await h.tick(0.5); await playing;
  const started = h.media.getPlaybackDiagnostics();
  assert.equal(started.startupPhase, 'playing'); assert.equal(started.openElapsedMs, 3500);
  assert.equal(started.phaseElapsedMs, 0);
  h.advance(10); h.media.currentTime = 5; await flush();
  assert.equal(h.media.getPlaybackDiagnostics().startupPhase, 'playing');
  assert.equal(h.media.getPlaybackDiagnostics().openElapsedMs, 3500);
  for (const stage of ['dependencies', 'video-selection', 'audio-selection', 'audio-menu', 'metadata', 'first-samples', 'ready', 'playing'])
    assert.ok(h.stages.includes(stage), `${stage} emits existing progress`);
  h.media.dispose();
});

test('retired source preparation cannot change the new source startup clock or phase', async () => {
  let release;
  const h = fixture({ metadataGate: new Promise(resolve => { release = resolve; }) });
  const oldLoad = h.media.load('first').catch(error => error); await flush();
  h.advance(2); await h.media.load('second'); await flush();
  const replacement = h.media.getPlaybackDiagnostics();
  release(); assert.equal((await oldLoad).name, 'AbortError'); await flush();
  assert.equal(h.media.getPlaybackDiagnostics().startupPhase, replacement.startupPhase);
  assert.equal(h.media.getPlaybackDiagnostics().openElapsedMs, replacement.openElapsedMs);
  h.media.dispose();
});
