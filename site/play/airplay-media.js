// SPDX-License-Identifier: GPL-3.0-only
import { createFrameCanvas } from './airplay-canvas.js';
import { createTempoProcessor, downmixStereo } from './airplay-tempo.js';
import { audioTrackLabel, createAudioTrackList, preferredAudioTrack } from './airplay-audio-tracks.js';
import { fetchSdrMediaResource, hasHdrTransfer, requireSdrTrack, sdrError } from './airplay-sdr.js';
import { decodableAudioTracks, selectPlayableTrack } from './airplay-track-selection.js';
import { createSerialMediaFetch } from './airplay-resource-fetch.js';
import { playbackProfile } from './delay-plan.js';
import { clampMediaTime, intersectMediaRanges, mediaRangeEnd, mediaTimeRanges, mergeMediaRanges,
  videoQueueFull } from './airplay-media-state.js';

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const CAST_PROFILE = playbackProfile('airplay-cast');
const VIDEO_BUFFER_LIMITS = Object.freeze({ maxFrames: CAST_PROFILE.maxVideoFrames,
  maxBytes: CAST_PROFILE.maxVideoBytes, maxAhead: CAST_PROFILE.maxVideoAheadMs / 1000 });
const MAX_AUDIO_AHEAD = CAST_PROFILE.maxAudioAheadMs / 1000;
const MAX_AUDIO_SCHEDULE = 0.5;
const FRAME_EPSILON = 0.002;
const abortError = () => new DOMException('Media playback was interrupted.', 'AbortError');

/** Canvas/Web Audio playback with one clock and cancellable, bounded decoded queues. */
export function createMediaEngine(surface, options = {}) {
  const media = new EventTarget();
  const now = options.now || (() => performance.now() / 1000);
  const request = options.requestFrame || (callback => requestAnimationFrame(callback));
  const cancel = options.cancelFrame || (id => cancelAnimationFrame(id));
  const fetchResource = options.serialFetchResource || createSerialMediaFetch(options.fetchResource || fetch,
    { signal: options.signal, deadline: options.resourceDeadline || 15000 });
  const canvas = options.presenter || createFrameCanvas(surface, cause => {
    options.onCanvasError?.(cause); fail(cause);
  });
  let libraryPromise, library, source = null, generation = null, serial = 0, disposed = false;
  let context = null, gain = null, animation = null, position = 0, duration = NaN, origin = 0;
  let paused = true, seeking = false, ended = false, readyState = 0, networkState = 0, error = null;
  let rate = 1, defaultRate = 1, muted = false, volume = 1, width = 0, height = 0;
  let running = false, clockTime = 0, clockPosition = 0, lastUpdate = -Infinity;
  let held = null, totalVideoFrames = 0, droppedVideoFrames = 0;
  const playWaiters = new Set();
  const event = type => { if (!disposed) media.dispatchEvent(new Event(type)); };
  const active = item => !disposed && item === generation && !item.closed;
  const audioTracks = createAudioTrackList(selectAudioTrack);

  function publishClock() {
    try { options.onClock?.(readPosition()); } catch (_) { /* Captions must not interrupt decoding or audio. */ }
  }

  function settlePlay(failure) {
    for (const waiter of playWaiters) failure ? waiter.reject(failure) : waiter.resolve();
    playWaiters.clear();
  }
  function currentClock() { return generation?.audioTrack && context ? context.currentTime : now(); }
  function readPosition() {
    if (!running) return position;
    const candidate = clockPosition + Math.max(0, currentClock() - clockTime) * rate;
    const item = generation;
    const audioLimit = item?.audioTrack && !(item.audioDone && position >= item.audioEnd - FRAME_EPSILON)
      ? item.scheduledEnd : Infinity;
    return Math.min(candidate, playableEnd(item), audioLimit, Number.isFinite(duration) ? duration : Infinity);
  }
  function updatePosition() { position = readPosition(); }
  function stopNodes(item) {
    if (!item) return;
    for (const node of item.nodes) { node.onended = null; try { node.stop(); } catch (_) {} node.disconnect(); }
    item.nodes.clear(); item.scheduledEnd = position;
  }
  function freeze() {
    updatePosition(); running = false;
    stopNodes(generation);
  }
  function closeGeneration() {
    if (animation !== null) cancel(animation); animation = null;
    const item = generation;
    if (!item) return;
    generation = null; item.closed = true; item.controller.abort();
    stopNodes(item);
    // Returning the sinks cancels their decoding and closes prefetched samples. The source-level
    // Input stays alive across pause/seek so HLS sliding windows keep their original timeline.
    for (const iterator of item.iterators) void iterator.return?.().catch(() => {});
    for (const frame of item.video) frame.sample.close();
    item.video.length = 0; item.audio.length = 0; item.tempo?.dispose();
    notifyRoom(item); item.readyReject(abortError());
  }
  function closeSource() {
    const previous = source;
    source = null;
    // Disposal aborts every root/segment request, including bodies already streaming.
    previous?.controller.abort(); previous?.input?.dispose();
  }
  function fail(cause) {
    if (disposed || error) return;
    generation?.readyReject(cause);
    freeze(); closeGeneration(); closeSource(); paused = true; seeking = false; readyState = 0; networkState = 3;
    error = { code: cause?.name === 'NotSupportedError' ? 4 : 3, name: cause?.name || 'Error', message: cause?.message || String(cause) };
    settlePlay(cause instanceof Error ? cause : new Error(error.message));
    const failureEvent = new Event('error'); failureEvent.error = cause; media.dispatchEvent(failureEvent);
  }
  function readFailure(item, cause) {
    if (!active(item)) return;
    const session = source;
    const recoverable = cause?.name === 'TimeoutError' || cause?.name === 'TypeError'
      || /HTTP|fetch|network|resource|segment|connection|404|410/i.test(cause?.message || '');
    if (session?.live && session.prepared && recoverable && cause?.name !== 'NotSupportedError') {
      if (now() - (session.lastRecovery ?? -Infinity) > 60) session.recoveries = 0;
      if ((session.recoveries || 0) < 2) {
        session.recoveries = (session.recoveries || 0) + 1; session.lastRecovery = now();
        freeze(); closeGeneration(); session.controller.abort(); session.input?.dispose();
        session.controller = new AbortController(); session.input = null; session.tracksPromise = null;
        // A slid-out live window has no recoverable old seek position. Start its fresh window
        // with a fresh caption origin and preserve the user's play/pause/rate intent.
        session.origin = null; session.prepared = false; position = 0; held = null; readyState = 0;
        try { options.onResync?.(session.src, session.type); } catch (_) {}
        event('resync'); event('waiting'); void begin(0, false); return;
      }
    }
    fail(cause);
  }
  function begin(positionToRead, isSeek) {
    freeze(); closeGeneration();
    position = positionToRead; ended = false; seeking = isSeek; readyState = Math.min(readyState, 1); networkState = 2;
    try { options.onCaptionReset?.(position); } catch (_) {}
    if (isSeek) event('seeking');
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // Seeking through the writable property has no caller to receive cancellation.
    void ready.catch(() => {});
    const item = { serial: ++serial, closed: false, controller: new AbortController(), input: null, iterators: [],
      video: [], audio: [], videoTrack: null, audioTrack: null, videoDone: false, audioDone: false,
      videoReady: false, audioReady: false, metadataReady: false, nodes: new Set(), scheduledEnd: position,
      start: position, audioEnd: position, tempo: null, tempoRate: null, tempoStart: position, tempoOutput: 0,
      ready, readyResolve, readyReject, readySettled: false, hasPlayed: false, waiters: new Set() };
    generation = item;
    void open(item).catch(cause => { if (active(item)) { item.readyReject(cause); fail(cause); } });
    schedule(); return ready;
  }
  async function dependencies() {
    libraryPromise ||= options.library ? Promise.resolve(options.library) : import('./vendor/mediabunny/mediabunny.min.js');
    library = await libraryPromise; return library;
  }
  async function open(item) {
    const lib = await dependencies();
    if (!active(item)) return;
    const session = source;
    const input = session.input || new lib.Input({ source: new lib.UrlSource(session.src, {
      maxCacheSize: 16 * 1024 * 1024, parallelism: 1,
      requestInit: { referrerPolicy: 'no-referrer' },
      fetchFn: async (url, init) => {
        if (disposed || source !== session) return Promise.reject(abortError());
        const response = await fetchSdrMediaResource(fetchResource, url, init, { signal: session.controller.signal,
          deadline: null });
        if (options.onResource && source === session && !disposed) {
          // Observers consume a bounded clone and cannot block the decoding pipeline.
          const copy = response.clone();
          try { void Promise.resolve(options.onResource(response.url || String(url), copy, session.origin ?? null)).catch(() => {}); }
          catch (_) { void copy.body?.cancel().catch(() => {}); }
        }
        return response;
      },
      // A failed range must not leave the UI indefinitely loading.
      getRetryDelay: attempts => attempts < 3 ? Math.min(2 ** (attempts - 1), 4) : null,
      handleUnhandledError: cause => { if (!disposed && source === session && session.input === input && generation) readFailure(generation, cause); },
    }), formats: lib.ALL_FORMATS || [lib.MP4, ...lib.HLS_FORMATS],
    formatOptions: { hls: { offsetTimestampsByDateTime: false } } });
    session.input = input;
    item.input = input;
    session.tracksPromise ||= (async () => {
      const selection = { signal: session.controller.signal };
      const video = await selectPlayableTrack(query => input.getPrimaryVideoTrack(query), { ...selection, video: true });
      // An HLS master can expose mutually exclusive variants; pair the selected video with its audio.
      const audio = await selectPlayableTrack(query => video ? video.getPrimaryPairableAudioTrack(query)
        : input.getPrimaryAudioTrack(query), selection);
      const candidates = video?.getPairableAudioTracks ? await video.getPairableAudioTracks()
        : input.getAudioTracks ? await input.getAudioTracks() : audio ? [audio] : [];
      const alternatives = [];
      for (const candidate of await decodableAudioTracks(candidates, selection)) {
        const language = await candidate.getLanguageCode?.() || 'und';
        alternatives.push({ track: candidate, id: String(alternatives.length), kind: 'main',
          label: audioTrackLabel(await candidate.getName?.(), language, options.languages?.[0] || globalThis.navigator?.language, alternatives.length), language });
      }
      session.audioAlternatives = alternatives;
      const preferred = preferredAudioTrack(alternatives, options.languages || globalThis.navigator?.languages || []);
      session.selectedAudio = (alternatives.find(candidate => candidate.id === session.selectedAudio)
        || preferred || alternatives.find(candidate => candidate.track === audio) || alternatives[0])?.id;
      if (source === session && !disposed) audioTracks.replace(alternatives.map(({ track, ...descriptor }) => descriptor), session.selectedAudio);
      return [video, audio];
    })();
    const tracks = await session.tracksPromise;
    if (!active(item)) return;
    [item.videoTrack, item.audioTrack] = tracks;
    await requireSdrTrack(item.videoTrack);
    if (!active(item)) return;
    if (session.audioAlternatives?.length) item.audioTrack = session.audioAlternatives.find(candidate => candidate.id === session.selectedAudio)?.track;
    const selected = [item.videoTrack, item.audioTrack].filter(Boolean);
    if (!selected.length) throw new DOMException('This resource contains no audio or video.', 'NotSupportedError');
    const decodable = await Promise.all(selected.map(track => track.canDecode()));
    if (!active(item)) return;
    if (decodable.some(value => !value)) throw new DOMException('This browser cannot decode the media codec.', 'NotSupportedError');
    const [first, end, live, nextWidth, nextHeight] = await Promise.all([
      input.getFirstTimestamp(selected), input.getDurationFromMetadata(selected, { skipLiveWait: true }),
      Promise.all(selected.map(track => track.isLive?.() || false)),
      item.videoTrack?.getDisplayWidth() || 0, item.videoTrack?.getDisplayHeight() || 0,
    ]);
    if (!active(item)) return;
    session.origin ??= first;
    origin = session.origin;
    const nextDuration = live.some(Boolean) ? Infinity : end === null ? NaN : Math.max(0, end - origin);
    session.live = nextDuration === Infinity;
    if (!Object.is(duration, nextDuration)) { duration = nextDuration; event('durationchange'); }
    if (width !== nextWidth || height !== nextHeight) { width = nextWidth; height = nextHeight; event('resize'); }
    position = clampMediaTime(position, duration); item.start = position; item.audioEnd = position;
    item.videoReady = !item.videoTrack; item.audioReady = !item.audioTrack; item.metadataReady = true;
    readyState = 1; event('loadedmetadata');
    try { options.onTimeline?.({ origin, live: duration === Infinity, videoTrack: item.videoTrack, input }); } catch (_) {}
    if (item.videoTrack && lib.EncodedPacketSink && options.onCaptionPacket) {
      void pumpCaptions(item, lib).catch(() => {});
    }
    if (item.videoTrack) void pumpVideo(item, lib).catch(cause => readFailure(item, cause));
    else item.videoDone = true;
    if (item.audioTrack) void pumpAudio(item, lib).catch(cause => readFailure(item, cause));
    else item.audioDone = true;
    checkReady(item);
    if (!Number.isFinite(duration) && duration !== Infinity) {
      void input.computeDuration(selected, { skipLiveWait: true }).then(endTime => {
        if (active(item)) { duration = Math.max(0, endTime - origin); event('durationchange'); }
      }).catch(cause => { if (active(item)) fail(cause); });
    }
  }
  function notify(item) { notifyRoom(item); checkReady(item); schedule(); }
  async function pumpCaptions(item, lib) {
    const sink = new lib.EncodedPacketSink(item.videoTrack);
    const first = await sink.getKeyPacket(origin + item.start) || await sink.getFirstPacket();
    if (!first || !active(item)) return;
    const codec = await item.videoTrack.getCodec?.();
    const config = await item.videoTrack.getDecoderConfig?.();
    const iterator = sink.packets(first)[Symbol.asyncIterator]();
    item.iterators.push(iterator);
    while (active(item)) {
      const next = await iterator.next();
      if (!active(item) || next.done) break;
      while (active(item) && next.value.timestamp - origin > readPosition() + MAX_AUDIO_AHEAD) await waitForRoom(item);
      if (!active(item)) break;
      // Caption failures never stop an otherwise playable video.
      try { options.onCaptionPacket(next.value.data, next.value.timestamp - origin, codec, config); } catch (_) {}
    }
  }
  function selectAudioTrack(id) {
    const session = source;
    if (!session || !session.audioAlternatives?.some(candidate => candidate.id === String(id))) return false;
    if (session.selectedAudio === String(id)) return true;
    updatePosition(); freeze(); session.selectedAudio = String(id); audioTracks.select(String(id));
    // Retain the source's timeline/cache and rebuild both queues at one common clock position.
    void begin(position, seeking); event('audiotrackchange'); return true;
  }
  function waitForRoom(item) {
    return new Promise(resolve => { item.waiters.add(resolve); if (!active(item)) notifyRoom(item); });
  }
  async function pumpVideo(item, lib) {
    let acceleration = 'no-preference';
    const Decoder = options.VideoDecoder || globalThis.VideoDecoder;
    if (Decoder?.isConfigSupported && item.videoTrack.getDecoderConfig) {
      const config = await item.videoTrack.getDecoderConfig();
      try { if (config && (await Decoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-hardware' })).supported) acceleration = 'prefer-hardware'; } catch (_) {}
    }
    if (!active(item)) return;
    const iterator = new lib.VideoSampleSink(item.videoTrack, { hardwareAcceleration: acceleration })
      .samples(origin + item.start)[Symbol.asyncIterator]();
    item.iterators.push(iterator);
    while (active(item)) {
      while (active(item) && videoQueueFull(item.video, readPosition(), VIDEO_BUFFER_LIMITS)) await waitForRoom(item);
      if (!active(item)) break;
      const next = await iterator.next();
      if (!active(item)) { next.value?.close(); break; }
      if (next.done) { item.videoDone = true; item.videoReady = true; notify(item); break; }
      const sample = next.value, start = sample.timestamp - origin;
      if (hasHdrTransfer(sample.colorSpace)) { sample.close(); throw sdrError(); }
      const end = start + Math.max(sample.duration, 1 / 120);
      if (end < item.start - FRAME_EPSILON) { sample.close(); continue; }
      const frame = { sample, start, end, bytes: sample.codedWidth * sample.codedHeight * 4
        || sample.displayWidth * sample.displayHeight * 4, unknownDuration: sample.duration <= 0 };
      if (frame.bytes > CAST_PROFILE.maxVideoBytes) { sample.close(); throw new Error('The decoded video frame exceeds the playback memory limit.'); }
      while (active(item) && item.video.reduce((bytes, queued) => bytes + queued.bytes, 0) + frame.bytes > CAST_PROFILE.maxVideoBytes) {
        item.videoBudgetBlocked = true;
        notify(item); await waitForRoom(item);
      }
      item.videoBudgetBlocked = false;
      if (!active(item)) { sample.close(); break; }
      const previous = item.video[item.video.length - 1] || (held?.serial === item.serial ? held : null);
      if (previous?.unknownDuration && frame.start > previous.start) previous.end = frame.start;
      item.video.push(frame); totalVideoFrames++; item.videoReady = true;
      if (held?.serial !== item.serial && frame.start > position) frame.start = position;
      if (held?.serial !== item.serial || seeking || (paused && frame.start <= position + FRAME_EPSILON)) presentDue(item, position);
      notify(item);
    }
  }
  async function audioContext() {
    if (!context) {
      const Context = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new DOMException('Web Audio is unavailable.', 'NotSupportedError');
      context = new Context({ latencyHint: 'interactive' });
      gain = context.createGain(); gain.gain.value = muted ? 0 : volume; gain.connect(context.destination);
    }
    return context;
  }
  function appendAudio(item, channels, sampleRate, start, end) {
    if (!channels[0]?.length) return;
    // Bound even pathological files with giant audio packets by splitting into 250 ms chunks.
    const block = Math.max(1, Math.round(sampleRate * 0.25));
    for (let offset = 0; offset < channels[0].length; offset += block) {
      const length = Math.min(block, channels[0].length - offset);
      const a = start + (end - start) * offset / channels[0].length;
      const b = start + (end - start) * (offset + length) / channels[0].length;
      item.audio.push({ channels: channels.map(channel => channel.slice(offset, offset + length)), sampleRate, start: a, end: b });
    }
    item.audioEnd = end; item.audioReady = true;
  }
  function appendStretched(item, samples, sampleRate) {
    if (!samples) return;
    const frames = samples.length / 2, left = new Float32Array(frames), right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { left[i] = samples[i * 2]; right[i] = samples[i * 2 + 1]; }
    const start = item.tempoStart + item.tempoOutput / sampleRate * rate;
    item.tempoOutput += frames;
    appendAudio(item, [left, right], sampleRate, start, item.tempoStart + item.tempoOutput / sampleRate * rate);
  }
  async function pumpAudio(item, lib) {
    const iterator = new lib.AudioBufferSink(item.audioTrack).buffers(origin + item.start)[Symbol.asyncIterator]();
    item.iterators.push(iterator);
    let sampleRate = null, decodedEnd = item.start;
    while (active(item)) {
      while (active(item) && (item.audioEnd - readPosition() >= MAX_AUDIO_AHEAD
        || item.audio.reduce((bytes, chunk) => bytes + chunk.channels.length * chunk.channels[0].byteLength, 0) >= MAX_AUDIO_BYTES)) {
        await waitForRoom(item);
      }
      if (!active(item)) break;
      const next = await iterator.next();
      if (!active(item)) break;
      if (next.done) {
        if (item.tempo) appendStretched(item, item.tempo.finish(), sampleRate);
        item.audioDone = true; item.audioReady = true; notify(item); break;
      }
      const wrapped = next.value, buffer = wrapped.buffer;
      const start = wrapped.timestamp - origin, end = start + wrapped.duration;
      if (end <= item.start) continue;
      if (buffer.duration > MAX_AUDIO_AHEAD || buffer.numberOfChannels > 8) {
        throw new Error('The decoded audio packet exceeds the playback memory limit.');
      }
      if (sampleRate !== null && sampleRate !== buffer.sampleRate) throw new Error('The audio sample rate changed during playback.');
      sampleRate = buffer.sampleRate;
      const offset = Math.max(0, Math.ceil((Math.max(item.start, decodedEnd) - start) * sampleRate));
      if (offset >= buffer.length) continue;
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).subarray(offset));
      const actualStart = start + offset / sampleRate;
      const gap = actualStart - decodedEnd;
      if (gap > MAX_AUDIO_AHEAD) throw new Error('The audio timeline has a discontinuity.');
      if (gap > 0.002) {
        // Tracks may start at different times. Silence in a timestamp gap is decoded, playable coverage.
        const silence = new Float32Array(Math.round(gap * sampleRate));
        if (rate === 1) appendAudio(item, [silence, silence], sampleRate, decodedEnd, actualStart);
        else {
          if (!item.tempo) { item.tempo = createTempoProcessor(lib.SoundTouchCore, sampleRate, rate); item.tempoStart = decodedEnd; }
          appendStretched(item, item.tempo.push(silence), sampleRate);
        }
      }
      if (rate === 1) appendAudio(item, channels, sampleRate, actualStart, end);
      else {
        if (!item.tempo) { item.tempo = createTempoProcessor(lib.SoundTouchCore, sampleRate, rate); item.tempoStart = actualStart; }
        const stereo = downmixStereo(channels);
        appendStretched(item, item.tempo.push(stereo[0], stereo[1]), sampleRate);
      }
      decodedEnd = end; notify(item);
    }
  }
  function trackRanges(item) {
    if (!item) return { video: [], audio: [] };
    const video = mergeMediaRanges([
      ...(held?.serial === item.serial ? [[held.start, item.videoDone ? Math.max(held.end, Number.isFinite(duration) ? duration : held.end) : held.end]] : []),
      ...item.video.map(frame => [frame.start, frame.end]),
    ]);
    const audio = mergeMediaRanges(item.audio.map(chunk => [chunk.start, chunk.end]));
    return { video, audio };
  }
  function bufferedRanges() {
    const item = generation;
    if (!item) return [];
    const ranges = trackRanges(item);
    if (!item.videoTrack) return ranges.audio;
    if (!item.audioTrack) return ranges.video;
    return intersectMediaRanges(ranges.video, ranges.audio);
  }
  function playableEnd(item) {
    if (!item || !item.metadataReady) return position;
    const ranges = trackRanges(item);
    let end = item.videoTrack ? mediaRangeEnd(ranges.video, position) : Infinity;
    // Once a shorter audio track really ended, the remaining video uses a silent advancing clock.
    if (item.audioTrack && !(item.audioDone && position >= item.audioEnd - FRAME_EPSILON)) {
      end = Math.min(end, mediaRangeEnd(ranges.audio, position));
    }
    if (!Number.isFinite(end)) end = Number.isFinite(duration) ? duration : position;
    return end;
  }
  function bufferedForPlayback(item, end) {
    const target = (item.hasPlayed ? CAST_PROFILE.resumeBufferMs : CAST_PROFILE.startupBufferMs) / 1000 * rate;
    if (end - position >= target - FRAME_EPSILON) return true;
    const ranges = trackRanges(item);
    const videoEnd = mediaRangeEnd(ranges.video, position), audioEnd = mediaRangeEnd(ranges.audio, position);
    // A short file or a limiting decoder/surface budget must not deadlock the
    // startup watermark. Decode no extra surfaces merely to satisfy a target.
    const videoSaturated = item.videoTrack && videoEnd <= end + FRAME_EPSILON
      && (item.videoDone || item.videoBudgetBlocked || videoQueueFull(item.video, position, VIDEO_BUFFER_LIMITS));
    const audioSaturated = item.audioTrack && audioEnd <= end + FRAME_EPSILON
      && (item.audioDone || audioEnd - position >= MAX_AUDIO_AHEAD - FRAME_EPSILON
        || item.audio.reduce((bytes, chunk) => bytes + chunk.channels.reduce((sum, channel) => sum + channel.byteLength, 0), 0) >= MAX_AUDIO_BYTES);
    return Boolean(videoSaturated || audioSaturated);
  }
  function checkReady(item) {
    if (!active(item) || !item.metadataReady || !item.videoReady || !item.audioReady) return;
    if (!item.readySettled) {
      item.readySettled = true; readyState = 2; source.prepared = true; publishClock(); event('loadeddata');
      if (seeking) { seeking = false; event('timeupdate'); event('seeked'); }
      item.readyResolve();
    }
    readyState = playableEnd(item) - position > 0.1 ? 3 : 2;
    event('progress');
  }
  function presentDue(item, at) {
    let selected = null;
    while (item.video.length && item.video[0].start <= at + FRAME_EPSILON) {
      const frame = item.video.shift();
      if (selected) { selected.sample.close(); droppedVideoFrames++; }
      selected = frame;
    }
    if (selected) {
      held = { start: selected.start, end: selected.end, serial: item.serial, unknownDuration: selected.unknownDuration };
      canvas.present(selected.sample);
    }
    notifyRoom(item);
  }
  function notifyRoom(item) { for (const resolve of item.waiters) resolve(); item.waiters.clear(); }
  function scheduleAudio(item, mediaEnd) {
    if (!item.audioTrack || !context || context.state !== 'running') return;
    const target = Math.min(mediaEnd, position + MAX_AUDIO_SCHEDULE * rate);
    let cursor = Math.max(position, item.scheduledEnd);
    for (const chunk of item.audio) {
      if (chunk.end <= cursor + 0.000001) continue;
      if (chunk.start > cursor + 0.025 || cursor >= target) break;
      const start = Math.max(cursor, chunk.start), end = Math.min(chunk.end, target);
      const offset = Math.max(0, Math.round((start - chunk.start) / rate * chunk.sampleRate));
      const length = Math.min(chunk.channels[0].length - offset, Math.round((end - start) / rate * chunk.sampleRate));
      if (length < 1) continue;
      const buffer = context.createBuffer(chunk.channels.length, length, chunk.sampleRate);
      chunk.channels.forEach((channel, index) => buffer.copyToChannel(channel.subarray(offset, offset + length), index));
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(gain);
      item.nodes.add(node);
      node.onended = () => { item.nodes.delete(node); node.disconnect(); };
      // Every node uses the same anchor as currentTime and the video presenter.
      node.start(Math.max(context.currentTime, clockTime + (start - clockPosition) / rate));
      cursor = end; item.scheduledEnd = end;
    }
  }
  function finish() {
    freeze(); ended = true; paused = true; seeking = false;
    if (Number.isFinite(duration)) position = duration;
    closeGeneration(); readyState = 2; networkState = 1;
    publishClock(); event('timeupdate'); event('ended'); settlePlay();
  }
  function tick() {
    animation = null;
    if (disposed) return;
    const item = generation;
    if (!item) return;
    updatePosition(); presentDue(item, position); publishClock();
    if (running && item.audioTrack && item.scheduledEnd > clockPosition + FRAME_EPSILON
      && !(item.audioDone && position >= item.audioEnd - FRAME_EPSILON)
      && currentClock() > clockTime + (item.scheduledEnd - clockPosition) / rate + 0.01) freeze();
    while (item.audio.length && item.audio[0].end <= position - FRAME_EPSILON) item.audio.shift();
    notifyRoom(item);
    if (item.metadataReady && item.videoDone && item.audioDone) {
      const lastEnd = Math.max(held?.end || 0, item.video[item.video.length - 1]?.end || 0, item.audioEnd);
      const finalEnd = Number.isFinite(duration) ? duration : lastEnd;
      if (position >= finalEnd - FRAME_EPSILON) { finish(); return; }
    }
    const end = playableEnd(item);
    const canRun = !paused && !seeking && item.readySettled && end > position + FRAME_EPSILON
      && (running || bufferedForPlayback(item, end))
      && (!item.audioTrack || context?.state === 'running');
    if (canRun) {
      if (!running) {
        clockPosition = position; clockTime = currentClock(); running = true; item.hasPlayed = true;
        scheduleAudio(item, end); item.waiting = false; event('playing'); settlePlay();
      } else scheduleAudio(item, end);
    } else if (running) { freeze(); if (!paused) event('waiting'); }
    else if (!paused && readyState < 3) eventWaiting(item);
    if (now() - lastUpdate >= 0.25) { lastUpdate = now(); event('timeupdate'); }
    schedule();
  }
  function eventWaiting(item) { if (!item.waiting) { item.waiting = true; event('waiting'); } }
  function schedule() {
    if (!disposed && generation && animation === null && (!paused || seeking || !generation.readySettled)) animation = request(tick);
  }
  function seek(value) {
    const target = clampMediaTime(Number(value), duration);
    if (!source || disposed) { position = target; return; }
    void begin(target, true);
  }
  async function play() {
    if (disposed) throw abortError();
    if (error) throw new Error(error.message);
    if (!source) throw new DOMException('No media source is loaded.', 'InvalidStateError');
    if (!paused && running) return;
    if (ended) position = 0;
    const wasPaused = paused;
    paused = false; ended = false; if (wasPaused) event('play');
    const promise = new Promise((resolve, reject) => playWaiters.add({ resolve, reject }));
    // Attach immediately because a source replacement can occur while AudioContext.resume is pending.
    void promise.catch(() => {});
    const intentSource = source;
    try {
      if (!generation) void begin(position, false);
      while (generation && !generation.metadataReady) {
        const item = generation;
        try { await item.ready; }
        catch (cause) {
          if (cause?.name !== 'AbortError' || disposed || paused || source !== intentSource || generation === item) throw cause;
          // A seek/rate edit superseded the pending read while preserving the playing intent.
        }
      }
      if (disposed || paused || source !== intentSource) throw abortError();
      if (generation?.audioTrack) {
        const audio = await audioContext();
        if (audio.state !== 'running') await audio.resume();
      }
      if (disposed || paused || source !== intentSource) throw abortError();
      schedule();
    } catch (cause) {
      if (!disposed && source === intentSource && cause?.name !== 'AbortError') {
        paused = true; freeze(); event('pause'); settlePlay(cause);
      }
      throw cause;
    }
    return promise;
  }
  function pause() {
    if (disposed || paused) return;
    freeze(); paused = true; serial++;
    const pendingSeek = seeking;
    closeGeneration(); settlePlay(abortError()); publishClock(); event('pause');
    // A pause directive following a seek still needs the target picture, never the abandoned picture.
    if (pendingSeek && source) void begin(position, true);
  }
  async function load(src, type) {
    if (disposed) throw abortError();
    freeze(); closeGeneration(); closeSource(); serial++; settlePlay(abortError());
    source = src ? { src: String(src), type, input: null, origin: null, controller: new AbortController() } : null;
    canvas.clear(); held = null; position = 0; duration = NaN; origin = 0; width = height = 0;
    paused = true; ended = seeking = false; error = null; readyState = networkState = 0;
    totalVideoFrames = droppedVideoFrames = 0; event('emptied');
    audioTracks.replace([], null); if (source) event('loadstart');
    if (source) await begin(0, false);
  }
  function dispose() {
    if (disposed) return;
    freeze(); closeGeneration(); closeSource(); serial++; settlePlay(abortError()); disposed = true;
    if (animation !== null) cancel(animation); animation = null;
    canvas.dispose(); options.signal?.removeEventListener('abort', dispose);
    if (!options.serialFetchResource) fetchResource.dispose();
    if (context) void context.close().catch(() => {}); context = gain = null;
  }
  const getter = (name, get, set) => Object.defineProperty(media, name, { enumerable: true, get, ...(set ? { set } : {}) });
  getter('duration', () => duration); getter('currentTime', readPosition, seek);
  getter('timestampOrigin', () => origin);
  getter('audioTracks', () => audioTracks);
  getter('buffered', () => mediaTimeRanges(bufferedRanges()));
  getter('seekable', () => mediaTimeRanges(Number.isFinite(duration) && duration > 0 ? [[0, duration]] : bufferedRanges()));
  getter('paused', () => paused); getter('seeking', () => seeking); getter('ended', () => ended);
  getter('readyState', () => readyState); getter('networkState', () => networkState); getter('error', () => error);
  getter('videoWidth', () => width); getter('videoHeight', () => height);
  getter('playbackRate', () => rate, value => {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0.25 || next > 4) throw new DOMException('The playback rate must be between 0.25 and 4.', 'NotSupportedError');
    if (next === rate) return;
    updatePosition(); freeze(); rate = next; event('ratechange');
    if (source) void begin(position, seeking);
  });
  getter('defaultPlaybackRate', () => defaultRate, value => {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0.25 || next > 4) throw new DOMException('The default playback rate must be between 0.25 and 4.', 'NotSupportedError');
    defaultRate = next;
  });
  getter('muted', () => muted, value => { const next = Boolean(value); if (next === muted) return;
    muted = next; if (gain) gain.gain.value = muted ? 0 : volume; event('volumechange'); });
  getter('volume', () => volume, value => { const next = Number(value); if (!Number.isFinite(next) || next < 0 || next > 1) throw new DOMException('Volume must be between 0 and 1.', 'IndexSizeError');
    if (next === volume) return; volume = next; if (gain) gain.gain.value = muted ? 0 : volume; event('volumechange'); });
  Object.assign(media, { play, pause, load, dispose, selectAudioTrack,
    getVideoPlaybackQuality: () => ({ creationTime: now() * 1000, totalVideoFrames, droppedVideoFrames, corruptedVideoFrames: 0 }) });
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return media;
}
