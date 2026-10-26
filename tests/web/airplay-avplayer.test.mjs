import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubtitleTrackList } from '../../site/play/airplay-track-menu.js';
import { createAudioTrackList } from '../../site/play/airplay-audio-tracks.js';
import { createMediaEngine } from '../../site/play/airplay-media.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture({ suspended = false, loadGate, playGate, pauseGate, seekGate, subtitleGate, startupDeadline, resourceDeadline, live = false, ignoreEarlyRate = false, audioSpecs, supportedCodecs } = {}) {
  const players = [], containers = [];
  class Player {
    static stops = 0;
    static async stopPipelines() { this.stops++; }
    constructor(options) { this.options = options; this.listeners = new Map(); this.currentTime = 100000n; this.suspended = suspended; this.rate = 1; this.seeks = []; players.push(this); }
    on(name, callback) { this.listeners.set(name, callback); }
    fire(name, ...args) { this.listeners.get(name)?.(...args); }
    async load(src, options) { this.src = src; this.loadOptions = options; await loadGate?.promise; }
    getDuration() { return 20000n; }
    getMinStartPTS() { return 100000n; }
    getStreams() { return [
      { id: 1, mediaType: 'video', codecpar: 1234, codecparProxy: { codecType: 0, width: 1280, height: 720 } },
      ...(audioSpecs || [{ id: 2, language: 'en' }, { id: 3, language: 'zh' }]).map(track => ({ id: track.id, mediaType: 'audio',
        codecpar: 1234, codecparProxy: { codecType: 1, codecId: track.codecId }, metadata: { language: track.language } })),
      { id: 4, mediaType: 'subtitle', metadata: { language: 'en' } },
    ]; }
    getSelectedAudioStreamId() { return this.selectedAudio ?? 2; }
    async selectAudio(id) { this.selectedAudio = id; }
    async selectSubtitle(id) { await subtitleGate?.promise; this.selectedSubtitle = id; }
    setSubtitleEnable(value) { this.subtitleEnabled = value; }
    isLive() { return live; }
    isSuspended() { return this.suspended; }
    async resume() { this.suspended = false; this.fire('audioContextRunning'); }
    async play(options) { this.playCalls = (this.playCalls || 0) + 1; this.playOptions = options; this.startVolumes ||= []; this.startVolumes.push(this.volume); await playGate?.promise; this.started = true; this.fire('played'); this.fire('firstVideoRendered'); }
    async pause() { this.pauses = (this.pauses || 0) + 1; await pauseGate?.promise; }
    async seek(value) { this.seeks.push(value); await seekGate?.promise; this.currentTime = value; }
    setVolume(value) { this.volume = value; }
    setPlaybackRate(value) { if (!live && (!ignoreEarlyRate || this.started)) this.rate = value; }
    getPlaybackRate() { return this.rate; }
    getStats() { return { videoPacketQueueLength: 12, videoFrameRenderCount: 8n, videoFrameDecodeCount: 10n, videoStutter: 2 }; }
    async destroy() { this.destroyed = (this.destroyed || 0) + 1; }
  }
  const media = createMediaEngine({ prepend() {} }, { library: { default: Player, AVPlayerSupportedCodecs: supportedCodecs }, languages: ['zh'],
    containerFactory() { const container = { style: {}, remove() { this.removed = true; } }; containers.push(container); return container; },
    startupDeadline, resourceDeadline, proxyOnly: true, proxyOrigin: 'http://192.168.1.2:8080',
  });
  return { media, players, Player, containers };
}

test('AVPlayer owns URL loading, Canvas pipeline and original control time units', async () => {
  const h = fixture(); await h.media.load('http://192.168.1.2:8080/airplay-resource?r=1', 'application/x-mpegurl');
  const player = h.players[0];
  assert.equal(player.loadOptions.ext, 'm3u8');
  assert.equal(player.loadOptions.http.headers['X-TiPlay-Proxy-Origin'], 'http://192.168.1.2:8080');
  assert.equal(player.options.checkUseMSE(), false);
  assert.equal(player.options.enableWebGPU, false); assert.equal(player.options.enableHardware, true);
  assert.equal(player.options.preLoadTime, 4); assert.equal(h.media.duration, 20); assert.equal(h.media.timestampOrigin, 100);
  assert.equal(h.media.currentTime, 0); assert.equal(h.media.videoWidth, 1280);
  assert.equal(h.media.buffered.length, 0, 'no invented exact buffered range from packet counts');
  h.media.dispose(); await flush();
});

test('play, manual tempo, volume, preferred audio and pause delegate without a second scheduler', async () => {
  const h = fixture(); await h.media.load('http://media.test/a.mp4', 'video/mp4');
  h.media.playbackRate = 1.5; h.media.volume = .7; await h.media.play();
  const p = h.players[0]; assert.equal(p.rate, 1.5); assert.equal(p.volume, .7); assert.equal(p.selectedAudio, 3);
  assert.deepEqual(p.playOptions, { audio: true, video: true, subtitle: true });
  assert.equal(h.media.paused, false); assert.equal(h.media.buffering, false);
  h.media.pause(); await flush(); assert.equal(h.media.paused, true); assert.equal(p.pauses, 1);
  assert.throws(() => { h.media.playbackRate = .25; }, { name: 'NotSupportedError' });
  assert.throws(() => { h.media.volume = 2; }, { name: 'IndexSizeError' });
  h.media.dispose();
});

test('zero initial seek keeps prepared source; seek converts seconds to original PTS milliseconds', async () => {
  const gate = deferred(), h = fixture({ seekGate: gate }); await h.media.load('http://media.test/a.mp4');
  h.media.currentTime = 0; assert.deepEqual(h.players[0].seeks, []);
  h.media.currentTime = 2; h.media.currentTime = 6;
  assert.equal(h.media.seeking, true); assert.equal(h.media.currentTime, 6);
  const completed = new Promise(resolve => h.media.addEventListener('seeked', resolve, { once: true }));
  gate.resolve(); await completed;
  assert.deepEqual(h.players[0].seeks, [102000n, 106000n]); assert.equal(h.media.currentTime, 6); assert.equal(h.media.seeking, false);
  h.media.dispose();
});

test('pause rejects an in-flight play and late played event cannot resume intent', async () => {
  const gate = deferred(), h = fixture({ playGate: gate }); await h.media.load('http://media.test/a.mp4');
  const playing = h.media.play(); h.media.pause(); gate.resolve();
  await assert.rejects(playing, { name: 'AbortError' }); assert.equal(h.media.paused, true);
  h.media.dispose();
});

test('a synchronous permission revocation on play never starts the upstream media graph', async () => {
  const h = fixture(); await h.media.load('http://media.test/a.mp4');
  h.media.addEventListener('play', () => h.media.pause());
  await assert.rejects(h.media.play(), { name: 'AbortError' });
  assert.equal(h.players[0].playOptions, undefined); assert.equal(h.media.paused, true);
  h.media.dispose();
});

test('suspended AVPlayer audio retains pending play and trusted resume calls upstream immediately', async () => {
  const h = fixture({ suspended: true }); await h.media.load('http://media.test/a.mp4');
  const playing = h.media.play(); await flush(); assert.equal(h.media.gestureRequired, true);
  const resumed = h.media.resumeFromGesture(); assert.equal(h.players[0].suspended, false);
  await Promise.all([playing, resumed]); assert.equal(h.media.gestureRequired, false); assert.equal(h.media.buffering, false);
  h.media.dispose();
});

test('replacement cancels old pending load and isolates all stale events', async () => {
  const gate = deferred(), h = fixture({ loadGate: gate });
  const old = h.media.load('http://media.test/old.mp4'); const rejection = assert.rejects(old, { name: 'AbortError' });
  await flush(); const first = h.players[0];
  const fresh = h.media.load('http://media.test/new.mp4'); gate.resolve(); await fresh; await rejection;
  assert.equal(first.destroyed, 1); assert.equal(h.containers[0].removed, true);
  first.fire('error', new Error('stale')); first.fire('ended');
  assert.equal(h.media.error, null); assert.equal(h.media.ended, false);
  h.media.dispose(); await flush(); assert.equal(h.Player.stops, 2);
});

test('dispose aborts a hung load immediately and releases source, Canvas and final pipeline pool', async () => {
  const gate = deferred(), h = fixture({ loadGate: gate });
  const pending = h.media.load('http://media.test/hung.mp4'); const rejection = assert.rejects(pending, { name: 'AbortError' });
  await flush(); h.media.dispose(); await rejection; await flush();
  assert.equal(h.players[0].destroyed, 1); assert.equal(h.containers[0].removed, true); assert.equal(h.Player.stops, 1);
  gate.resolve(); await flush(); assert.equal(h.players[0].destroyed, 1);
});

test('source retirement silences immediately and a synchronous destroy failure cannot retain the old Canvas', async () => {
  const h = fixture(); await h.media.load('http://media.test/a.mp4'); await h.media.play();
  const first = h.players[0]; first.destroy = () => { throw new Error('Worker already stopped'); };
  const replacement = h.media.load('http://media.test/b.mp4');
  assert.equal(first.volume, 0); assert.equal(h.containers[0].removed, true);
  await replacement; assert.equal(h.players.length, 2); assert.equal(h.media.error, null);
  h.media.dispose(); await flush();
});

test('a cancelled replacement cannot bypass an older pending pipeline retirement', async () => {
  const h = fixture(); await h.media.load('http://media.test/a.mp4'); await h.media.play();
  const destruction = deferred(), pipeline = deferred();
  h.players[0].destroy = () => destruction.promise;
  h.Player.stopPipelines = async () => { h.Player.stops++; await pipeline.promise; };
  const cancelled = h.media.load('http://media.test/b.mp4');
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  await flush();
  const current = h.media.load('http://media.test/c.mp4');
  await rejected; await flush();
  assert.equal(h.players.length, 1, 'unfinished old destruction keeps replacement constructors out');
  destruction.resolve(); await flush();
  assert.equal(h.Player.stops, 1); assert.equal(h.players.length, 1, 'global pipeline shutdown also completes before reuse');
  pipeline.resolve(); await current;
  assert.equal(h.players.length, 2); assert.match(h.players[1].src, /c\.mp4$/);
  h.media.dispose(); await flush();
});

test('a hung outgoing Worker shutdown fails replacement preparation within the existing resource deadline', async () => {
  const h = fixture({ resourceDeadline: 20 }); await h.media.load('http://media.test/a.mp4');
  const destruction = deferred(); h.players[0].destroy = () => destruction.promise;
  await assert.rejects(h.media.load('http://media.test/b.mp4'), { name: 'TimeoutError' });
  assert.equal(h.media.error.name, 'TimeoutError'); assert.equal(h.players.length, 1);
  destruction.resolve(); h.media.dispose(); await flush();
});

test('source-specific proxy fallback remains strict when a paused live source is reopened', async () => {
  const h = fixture({ live: true });
  await h.media.load('http://media.test/live.m3u8', 'application/x-mpegurl', { proxyOnly: true });
  await h.media.play(); h.media.pause(); await h.media.play();
  for (const player of h.players) assert.equal(player.loadOptions.http.headers['X-TiPlay-Proxy-Origin'], 'http://192.168.1.2:8080');
  h.media.dispose();
});

test('AVPlayer owns subtitle selection, parsing and rendering; bridge contains no cues', async () => {
  const h = fixture(); await h.media.load('http://media.test/movie.mp4');
  assert.equal(h.media.textTracks.length, 1); const track = h.media.textTracks[0];
  assert.equal(track.mode, 'disabled'); track.mode = 'showing'; await flush();
  assert.equal(h.players[0].selectedSubtitle, 4); assert.equal(h.players[0].subtitleEnabled, true);
  assert.equal(track.cues, undefined); track.mode = 'disabled'; assert.equal(h.players[0].subtitleEnabled, false);
  assert.equal(h.media.selectAudioTrack('missing'), false); assert.equal(h.media.selectAudioTrack('3'), true);
  h.media.dispose();
});

test('upstream error captures state then releases resources and propagates through media error', async () => {
  const h = fixture(); await h.media.load('http://media.test/movie.mp4');
  let failure; h.media.addEventListener('error', event => { failure = event; });
  h.players[0].fire('error', new DOMException('Unsupported codec', 'NotSupportedError'));
  assert.equal(h.media.error.code, 4); assert.equal(h.media.paused, true); assert.equal(h.media.readyState, 0);
  assert.equal(failure.error.name, 'NotSupportedError'); assert.equal(h.containers[0].removed, true);
  h.media.dispose();
});


test('first-frame startup deadline rejects a hung upstream play and tears down the source', async () => {
  const gate = deferred(), h = fixture({ playGate: gate, startupDeadline: 20 });
  await h.media.load('http://media.test/no-decoder.mp4');
  await assert.rejects(h.media.play(), { name: 'TimeoutError' });
  assert.equal(h.media.error.name, 'TimeoutError'); assert.equal(h.containers[0].removed, true);
  gate.resolve(); h.media.dispose();
});


test('live pause silences and retires the source; resume opens the URL again at the live edge', async () => {
  const h = fixture({ live: true }); await h.media.load('http://media.test/live.m3u8'); await h.media.play();
  const old = h.players[0]; h.media.pause(); await flush();
  assert.equal(old.volume, 0); assert.equal(old.destroyed, 1); assert.equal(old.pauses, undefined);
  assert.equal(h.media.paused, true); assert.equal(h.media.seekable.length, 0); assert.equal(h.media.currentTime, 0);
  await h.media.play(); assert.equal(h.players.length, 2); assert.equal(h.players[1].src, old.src);
  assert.equal(h.media.paused, false); assert.equal(h.media.duration, Infinity);
  h.media.dispose();
});

test('changing mute or volume cannot unmute a retired live source before its asynchronous destruction', async () => {
  const h = fixture({ live: true }); await h.media.load('http://media.test/live.m3u8'); await h.media.play();
  const destruction = deferred(), old = h.players[0]; old.destroy = () => destruction.promise;
  h.media.pause(); assert.equal(old.volume, 0);
  h.media.volume = .8; h.media.muted = true; h.media.muted = false;
  assert.equal(old.volume, 0, 'retired graph keeps silence while desired volume changes');
  destruction.resolve(); await h.media.play();
  assert.equal(h.players[1].volume, .8); h.media.dispose();
});


test('rapid play-pause-play shares unfinished upstream initialization without cancelling the new intent', async () => {
  const gate = deferred(), h = fixture({ playGate: gate }); await h.media.load('http://media.test/a.mp4');
  const old = h.media.play(); const rejected = assert.rejects(old, { name: 'AbortError' });
  h.media.pause(); const current = h.media.play(); gate.resolve();
  await rejected; await current; assert.equal(h.media.paused, false); assert.equal(h.media.buffering, false);
  h.media.dispose();
});

test('resuming waits for the actual upstream pause before restarting the retained graph', async () => {
  const pause = deferred(), h = fixture({ pauseGate: pause });
  await h.media.load('http://media.test/movie.mp4'); await h.media.play();
  const player = h.players[0]; h.media.pause(); const resumed = h.media.play(); await flush();
  assert.equal(player.playCalls, 1, 'a pending pause cannot finish on top of a newer upstream play');
  pause.resolve(); await resumed;
  assert.equal(player.playCalls, 2); assert.equal(h.media.paused, false);
  h.media.dispose();
});

test('same-turn subtitle change and seek do not replace AVPlayer demux state concurrently', async () => {
  const subtitle = deferred(), h = fixture({ subtitleGate: subtitle });
  await h.media.load('http://media.test/movie.mp4'); await h.media.play();
  h.media.textTracks[0].mode = 'showing'; h.media.currentTime = 3;
  await flush(); assert.deepEqual(h.players[0].seeks, [], 'seek waits for the active track transition');
  const completed = new Promise(resolve => h.media.addEventListener('seeked', resolve, { once: true }));
  subtitle.resolve(); await completed;
  assert.equal(h.players[0].selectedSubtitle, 4);
  assert.deepEqual(h.players[0].seeks, [103000n]); assert.equal(h.media.seeking, false);
  h.media.dispose();
});

test('subtitle enable cannot clear the first cue delivered by selection', async () => {
  const h = fixture(); await h.media.load('http://media.test/movie.mp4'); await h.media.play();
  const player = h.players[0]; let cue;
  player.setSubtitleEnable = enabled => { if (enabled) cue = undefined; };
  player.selectSubtitle = async () => { cue = 'first cue from the selected track'; };
  h.media.textTracks[0].mode = 'showing'; await flush();
  assert.equal(cue, 'first cue from the selected track');
  h.media.dispose();
});


test('VOD tempo is reapplied after graph initialization and pre-muted volume is zero at start', async () => {
  const h = fixture({ ignoreEarlyRate: true }); await h.media.load('http://media.test/vod.mp4');
  h.media.playbackRate = 1.5; h.media.muted = true; await h.media.play();
  assert.deepEqual(h.players[0].startVolumes, [0]);
  assert.equal(h.players[0].volume, 0); assert.equal(h.players[0].getPlaybackRate(), 1.5);
  h.media.dispose();
});

test('live playback exposes native rate1 and rejects unsupported manual tempo', async () => {
  const h = fixture({ live: true }); h.media.playbackRate = 1.5;
  await h.media.load('http://media.test/live.m3u8');
  assert.equal(h.media.isLive, true); assert.equal(h.media.playbackRate, 1);
  assert.throws(() => { h.media.playbackRate = 1.5; }, { name: 'NotSupportedError' });
  await h.media.play(); assert.equal(h.players[0].getPlaybackRate(), 1);
  h.media.dispose();
});


test('H264 video with unsupported ALAC audio fails clearly instead of silently playing without sound', async () => {
  const h = fixture({ audioSpecs: [{ id: 2, codecId: 86032, language: 'en' }], supportedCodecs: [27, 86018] });
  await assert.rejects(h.media.load('http://media.test/h264-alac.mp4'), { name: 'NotSupportedError' });
  assert.equal(h.media.error.code, 4); assert.equal(h.media.audioTracks.length, 0);
  assert.equal(h.players[0].playOptions, undefined); assert.equal(h.containers[0].removed, true);
  h.media.dispose();
});

test('true video-only media remains playable under the same audio-support policy', async () => {
  const h = fixture({ audioSpecs: [], supportedCodecs: [27, 86018] });
  await h.media.load('http://media.test/video-only.mp4'); await h.media.play();
  assert.equal(h.media.audioTracks.length, 0); assert.equal(h.media.error, null); assert.equal(h.media.paused, false);
  h.media.dispose();
});

test('mixed ALAC and AAC keeps the supported AAC track in the menu and selects it for playback', async () => {
  const h = fixture({ audioSpecs: [{ id: 2, codecId: 86032, language: 'zh' }, { id: 3, codecId: 86018, language: 'en' }],
    supportedCodecs: [27, 86018] });
  await h.media.load('http://media.test/mixed-audio.mp4');
  assert.equal(h.media.audioTracks.length, 1); assert.equal(h.media.audioTracks[0].id, '3');
  assert.equal(h.media.selectAudioTrack('2'), false);
  await h.media.play(); assert.equal(h.players[0].selectedAudio, 3); assert.equal(h.media.audioTracks[0].enabled, true);
  h.media.dispose();
});


test('stream metadata refresh preserves the selected subtitle instead of silently disabling it', async () => {
  const h = fixture(); await h.media.load('http://media.test/movie.mp4'); await h.media.play();
  h.media.textTracks[0].mode = 'showing'; await flush();
  const player = h.players[0], selected = h.media.textTracks[0];
  player.fire('streamUpdate'); await flush();
  assert.equal(h.media.textTracks[0], selected); assert.equal(selected.mode, 'showing');
  assert.equal(player.subtitleEnabled, true);
  const streams = player.getStreams.bind(player);
  player.getStreams = () => streams().map(stream => stream.mediaType === 'subtitle'
    ? { ...stream, metadata: { ...stream.metadata, title: 'English updated' } } : stream);
  player.fire('streamUpdate'); await flush();
  assert.equal(h.media.textTracks[0].label, 'English updated'); assert.equal(h.media.textTracks[0].mode, 'showing');
  assert.equal(player.subtitleEnabled, true); h.media.dispose();
});


test('track-list events expose complete indexed snapshots to Video.js observers', () => {
  for (const list of [createSubtitleTrackList(() => {}), createAudioTrackList(() => {})]) {
    let observed = 0;
    for (const name of ['addtrack', 'removetrack', 'change']) list.addEventListener(name, event => {
      observed++; if (name !== 'change') assert.ok(event.track);
      assert.deepEqual(Array.from({ length: list.length }, (_, index) => list[index]?.id), [...list].map(track => track.id));
      for (let index = 0; index < list.length; index++) assert.ok(list[index]?.kind);
    });
    list.replace([{ id: 'a', kind: 'main' }, { id: 'b', kind: 'main' }], 'a');
    list.replace([{ id: 'c', kind: 'main' }], 'c'); list.replace([], null);
    assert.ok(observed >= 9);
  }
});
