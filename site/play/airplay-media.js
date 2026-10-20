// SPDX-License-Identifier: GPL-3.0-only
import { createFrameCanvas } from './airplay-canvas.js';
import { createTempoProcessor, downmixStereo } from './airplay-tempo.js';
import { audioTrackLabel, createAudioTrackList, preferredAudioTrack } from './airplay-audio-tracks.js';
import { fetchSdrMediaResource, hasHdrTransfer, requireSdrTrack, sdrError } from './airplay-sdr.js';
import { decodableAudioTracks, selectPlayableTrack } from './airplay-track-selection.js';
import { createSerialMediaFetch } from './airplay-resource-fetch.js';
import { playbackProfile } from './delay-plan.js';
import { sanitizePlaybackDiagnostics } from './airplay-diagnostics.js';
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
const frameEpsilon = (time, other, sampleRate) =>
  Math.min(0.25, 8 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(other)) * sampleRate);
const frameCeil = (time, origin, sampleRate) =>
  Math.ceil((time - origin) * sampleRate - frameEpsilon(time, origin, sampleRate));

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
  }, observeSampleClosed);
  let libraryPromise, library, source = null, generation = null, serial = 0, disposed = false;
  let context = null, gain = null, contextPreparation = null, contextEpoch = 0, audioRequestedContextRate = null;
  let animation = null, position = 0, duration = NaN, origin = 0;
  let paused = true, seeking = false, ended = false, readyState = 0, networkState = 0, error = null;
  let rate = 1, defaultRate = 1, muted = false, volume = 1, width = 0, height = 0;
  let running = false, clockTime = 0, clockPosition = 0, lastUpdate = -Infinity;
  let held = null, totalVideoFrames = 0, droppedVideoFrames = 0;
  let resumeRequests = 0;
  let audioResumeRequests = 0, audioResumeCompleted = 0, audioResumeFailed = 0, audioResumePromise = null;
  let samplesReceived = 0, samplesClosed = 0;
  const sampleOwners = new WeakMap(), closedSamples = new WeakSet(), pendingSamples = new Map();
  options.presenter?.setSampleCloseObserver?.(observeSampleClosed);
  const playWaiters = new Set();
  const event = type => { if (!disposed) media.dispatchEvent(new Event(type)); };
  const active = item => !disposed && item === generation && !item.closed;
  const audioTracks = createAudioTrackList(selectAudioTrack);

  function observeSampleClosed(sample) {
    if (sampleOwners.has(sample) && !closedSamples.has(sample)) {
      closedSamples.add(sample); samplesClosed++;
      if (held?.sampleId === sampleOwners.get(sample).id) held = null;
    }
  }
  function closeSample(sample) {
    if (!sample || closedSamples.has(sample)) return;
    sample.close(); observeSampleClosed(sample);
  }
  function observeSample(item, sample) {
    samplesReceived++; sampleOwners.set(sample, { generation: item.serial, id: samplesReceived });
    item.lastSampleAt = now();
    const timestamp = sample.timestamp;
    if (Number.isFinite(item.lastSampleTimestamp) && timestamp > item.lastSampleTimestamp)
      item.observedSampleCadenceMs = (timestamp - item.lastSampleTimestamp) * 1000;
    item.lastSampleTimestamp = timestamp;
    item.observedSampleDurationMs = sample.duration > 0 ? sample.duration * 1000 : null;
    for (const key of ['codedWidth', 'codedHeight', 'displayWidth', 'displayHeight'])
      if (Number.isFinite(sample[key])) item[key] = sample[key];
  }
  function resumeAudio(force = false) {
    if (!context || context.state === 'running') return Promise.resolve();
    if (audioResumePromise && !force) return audioResumePromise;
    const owner = context, epoch = contextEpoch;
    audioResumeRequests++; resumeRequests++;
    let request;
    try { request = owner.resume(); }
    catch (cause) { request = Promise.reject(cause); }
    const pending = Promise.resolve(request).then(() => {
      if (context !== owner || epoch !== contextEpoch) throw abortError();
      audioResumeCompleted++; schedule(); event('progress');
    }, cause => {
      if (context === owner && epoch === contextEpoch) { audioResumeFailed++; event('progress'); }
      throw cause;
    }).finally(() => {
      if (epoch === contextEpoch) resumeRequests--;
      if (audioResumePromise === pending) audioResumePromise = null;
    });
    audioResumePromise = pending;
    event('progress');
    return pending;
  }
  function resumeFromGesture() {
    // Invoke resume synchronously inside the existing Play control's trusted activation.
    const resumed = resumeAudio(true);
    void resumed.catch(() => {});
    return play();
  }

  function videoFull(item, at) {
    const retainedBytes = held?.bytes || 0;
    const nextBytes = item.video[item.video.length - 1]?.bytes || retainedBytes;
    return videoQueueFull(item.video, at, { ...VIDEO_BUFFER_LIMITS, retainedBytes, nextBytes });
  }

  function publishClock() {
    try { options.onClock?.(readPosition()); } catch (_) { /* Captions must not interrupt decoding or audio. */ }
  }

  function settlePlay(failure) {
    for (const waiter of playWaiters) failure ? waiter.reject(failure) : waiter.resolve();
    playWaiters.clear();
  }
  // A seek beyond the audio track, or an empty track, can still have playable video.
  // Keep a running audio clock through an ordinary tail, but do not require one
  // when this generation never produced any remaining PCM.
  function audioClockNeeded(item) { return item?.audioTrack && !(item.audioDone && item.audioEnd <= item.start); }
  function currentClock() { return audioClockNeeded(generation) && context ? context.currentTime : now(); }
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
    item.lastAudioNodeEnd = null;
    for (const chunk of item.audio) chunk.scheduledFrames = Math.max(0, Math.min(chunk.channels[0].length,
      frameCeil(position, chunk.start, chunk.sampleRate / rate)));
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
    for (const frame of item.video) closeSample(frame.sample);
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
    // Keep the failed pipeline's known state before cleanup retires its generation.
    // The same scalar whitelist is used by diagnostics, and observations cannot
    // interrupt failure handling even if a provider's getter throws.
    const beforeCleanup = failureSnapshot();
    generation?.readyReject(cause);
    freeze(); closeGeneration(); closeSource(); paused = true; seeking = false; readyState = 0; networkState = 3;
    error = { code: cause?.name === 'NotSupportedError' ? 4 : 3, name: cause?.name || 'Error', message: cause?.message || String(cause) };
    settlePlay(cause instanceof Error ? cause : new Error(error.message));
    const failureEvent = new Event('error');
    try {
      failureEvent.error = cause;
      failureEvent.playbackDiagnostics = beforeCleanup;
      failureEvent.cleanupDiagnostics = failureSnapshot();
    } catch (_) { /* Cleanup and error delivery must not depend on diagnostic properties. */ }
    media.dispatchEvent(failureEvent);
  }
  function failureSnapshot() {
    try {
      const snapshot = sanitizePlaybackDiagnostics({ ...playbackDiagnostics(), waitReason: 'error' });
      return snapshot ? Object.freeze(snapshot) : null;
    } catch (_) { return null; }
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
        session.origin = null; session.prepared = false; position = 0; readyState = 0;
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
      videoReadPending: false, audioReadPending: false, videoReadStarted: null, audioReadStarted: null,
      audioSourceRate: null, audioSourceChannels: null, audioDecodedFrames: 0, audioSeekTrimmedFrames: 0,
      audioOverlapTrimmedFrames: 0, audioAlignedPackets: 0, audioAlignmentMaxUs: 0, audioSilenceFrames: 0,
      audioScheduledFrames: 0, audioScheduleGapUs: 0, audioScheduleOverlapUs: 0,
      audioLateStarts: 0, audioLateStartMaxMs: 0, audioPcmPeak: 0, audioPcmOverFullScaleSamples: 0,
      audioNonFiniteSamples: 0, lastAudioNodeEnd: null,
      openStartedAt: now(), stallStarted: null, stallCount: 0, startReason: 'none', readProgressFallbacks: 0,
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
    if (Number.isFinite(nextWidth)) item.displayWidth = nextWidth;
    if (Number.isFinite(nextHeight)) item.displayHeight = nextHeight;
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
  function notify(item) { notifyRoom(item); prepareAudio(item); checkReady(item); schedule(); }
  function prepareAudio(item, explicitResume = false) {
    if (!active(item) || paused || !audioClockNeeded(item) || item.audioSourceRate === null || item.audioPreparation) return;
    // Decoding progress prepares a new format, never resumes an interrupted or
    // suspended existing graph. Its state change or an explicit Play owns that.
    if (!explicitResume && context?.sampleRate === item.audioSourceRate) return;
    const preparation = (async () => {
      const audio = await audioContext(item);
      if (!active(item) || paused) return;
      if (audio && audio.state !== 'running') await resumeAudio();
      if (active(item)) schedule();
    })().catch(cause => {
      if (active(item) && !paused && cause?.name !== 'AbortError') {
        paused = true; freeze(); event('pause'); settlePlay(cause);
      }
    }).finally(() => { if (item.audioPreparation === preparation) item.audioPreparation = null; });
    item.audioPreparation = preparation;
  }
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
    const config = await item.videoTrack.getDecoderConfig?.();
    item.codec = config?.codec;
    try {
      for (const key of ['codedWidth', 'codedHeight']) if (Number.isFinite(config?.[key])) item[key] = config[key];
    } catch (_) { /* Optional diagnostic dimensions never change codec admission. */ }
    item.hardwareSupportProbe = Decoder?.isConfigSupported && config ? 'unknown' : 'unavailable';
    if (Decoder?.isConfigSupported && item.videoTrack.getDecoderConfig) {
      try {
        const supported = config && (await Decoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-hardware' })).supported;
        item.hardwareSupportProbe = supported ? 'supported' : 'unsupported';
        if (supported) acceleration = 'prefer-hardware';
      } catch (_) { item.hardwareSupportProbe = 'error'; }
    }
    item.requestedHardwareAcceleration = acceleration;
    if (!active(item)) return;
    const iterator = new lib.VideoSampleSink(item.videoTrack, { hardwareAcceleration: acceleration })
      .samples(origin + item.start)[Symbol.asyncIterator]();
    item.iterators.push(iterator);
    while (active(item)) {
      while (active(item) && videoFull(item, readPosition())) {
        item.videoBudgetBlocked = true; notify(item); await waitForRoom(item);
      }
      item.videoBudgetBlocked = false;
      if (!active(item)) break;
      let next;
      item.videoReadPending = true; item.videoReadStarted = now();
      try { next = await iterator.next(); }
      finally { item.videoReadPending = false; item.videoReadStarted = null; }
      if (next.value) observeSample(item, next.value);
      if (!active(item)) { closeSample(next.value); break; }
      if (next.done) { item.videoDone = true; item.videoReady = true; notify(item); break; }
      const sample = next.value, start = sample.timestamp - origin;
      if (hasHdrTransfer(sample.colorSpace)) { closeSample(sample); throw sdrError(); }
      const end = start + Math.max(sample.duration, 1 / 120);
      if (end < item.start - FRAME_EPSILON) { closeSample(sample); continue; }
      const frame = { sample, start, end, bytes: sample.codedWidth * sample.codedHeight * 4
        || sample.displayWidth * sample.displayHeight * 4, unknownDuration: sample.duration <= 0 };
      if (frame.bytes > CAST_PROFILE.maxVideoBytes) { closeSample(sample); throw new Error('The decoded video frame exceeds the playback memory limit.'); }
      // Continuous presentation needs the retained picture and its replacement at once.
      if (frame.bytes * 2 > CAST_PROFILE.maxVideoBytes) {
        closeSample(sample); throw new DOMException('The video requires more than the bounded two-frame playback surface budget.', 'NotSupportedError');
      }
      pendingSamples.set(item.serial, frame.bytes);
      while (active(item) && (held?.bytes || 0) + item.video.reduce((bytes, queued) => bytes + queued.bytes, 0) + frame.bytes > CAST_PROFILE.maxVideoBytes) {
        item.videoBudgetBlocked = true;
        notify(item); await waitForRoom(item);
      }
      item.videoBudgetBlocked = false;
      if (!active(item)) { pendingSamples.delete(item.serial); closeSample(sample); break; }
      const previous = item.video[item.video.length - 1] || (held?.serial === item.serial ? held : null);
      // Canvas retains the last picture until the next presentation timestamp. A video's
      // sample duration need not span a legitimate still-image or variable-frame-rate gap.
      // This extends picture coverage only; audio keeps its own continuous sample timeline.
      if (previous && frame.start > previous.start) previous.end = frame.start;
      item.video.push(frame); totalVideoFrames++; item.videoReady = true;
      pendingSamples.delete(item.serial);
      if (held?.serial !== item.serial && frame.start > position) frame.start = position;
      if (held?.serial !== item.serial || seeking || (paused && frame.start <= position + FRAME_EPSILON)) presentDue(item, position);
      notify(item);
    }
  }
  async function audioContext(item) {
    // Metadata can precede the first decoded PCM. Do not guess the format: short
    // source nodes must not restart a browser resampler for every packet/slice.
    while (active(item) && item.audioSourceRate === null && !item.audioDone) await waitForRoom(item);
    if (!active(item)) throw abortError();
    if (!audioClockNeeded(item)) return null;
    const sampleRate = item.audioSourceRate;
    if (!(sampleRate > 0)) throw new DOMException('The decoded audio sample rate is unavailable.', 'NotSupportedError');
    if (context?.sampleRate === sampleRate) return context;
    if (contextPreparation) {
      // A retired generation's preparation result cannot reject a new owner.
      try { await contextPreparation; } catch (_) {}
      return audioContext(item);
    }
    const prepare = (async () => {
      const previous = context;
      context = null; gain?.disconnect(); gain = null;
      contextEpoch++; audioResumePromise = null; resumeRequests = 0;
      if (previous) { try { await previous.close(); } catch (_) {} }
      if (!active(item)) throw abortError();
      const Context = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new DOMException('Web Audio is unavailable.', 'NotSupportedError');
      audioRequestedContextRate = sampleRate;
      const candidate = new Context({ latencyHint: 'interactive', sampleRate });
      if (candidate.sampleRate !== sampleRate) {
        void candidate.close().catch(() => {});
        throw new DOMException('The browser did not honor the requested audio sample rate.', 'NotSupportedError');
      }
      context = candidate;
      context.addEventListener?.('statechange', () => { if (context === candidate) { schedule(); event('progress'); } });
      gain = context.createGain(); gain.gain.value = muted ? 0 : volume; gain.connect(context.destination);
      return context;
    })();
    contextPreparation = prepare;
    try { return await prepare; }
    finally { if (contextPreparation === prepare) contextPreparation = null; }
  }
  function appendAudio(item, channels, sampleRate, start) {
    if (!channels[0]?.length) return;
    // Bound even pathological files with giant audio packets by splitting into 250 ms chunks.
    const block = Math.max(1, Math.round(sampleRate * 0.25));
    for (let offset = 0; offset < channels[0].length; offset += block) {
      const length = Math.min(block, channels[0].length - offset);
      const a = start + offset / sampleRate * rate;
      const b = start + (offset + length) / sampleRate * rate;
      item.audio.push({ channels: channels.map(channel => channel.slice(offset, offset + length)), sampleRate,
        start: a, end: b, scheduledFrames: 0 });
    }
    item.audioEnd = start + channels[0].length / sampleRate * rate; item.audioReady = true;
  }
  function appendStretched(item, samples, sampleRate) {
    if (!samples) return;
    const frames = samples.length / 2, left = new Float32Array(frames), right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { left[i] = samples[i * 2]; right[i] = samples[i * 2 + 1]; }
    const start = item.tempoStart + item.tempoOutput / sampleRate * rate;
    item.tempoOutput += frames;
    appendAudio(item, [left, right], sampleRate, start);
  }
  async function pumpAudio(item, lib) {
    const iterator = new lib.AudioBufferSink(item.audioTrack).buffers(origin + item.start)[Symbol.asyncIterator]();
    item.iterators.push(iterator);
    let sampleRate = null, decodedEnd = item.start, hasDecoded = false;
    while (active(item)) {
      while (active(item) && (item.audioEnd - readPosition() >= MAX_AUDIO_AHEAD
        || item.audio.reduce((bytes, chunk) => bytes + chunk.channels.length * chunk.channels[0].byteLength, 0) >= MAX_AUDIO_BYTES)) {
        await waitForRoom(item);
      }
      if (!active(item)) break;
      let next;
      item.audioReadPending = true; item.audioReadStarted = now();
      try { next = await iterator.next(); }
      finally { item.audioReadPending = false; item.audioReadStarted = null; }
      if (!active(item)) break;
      if (next.done) {
        if (item.tempo) appendStretched(item, item.tempo.finish(), sampleRate);
        item.audioDone = true; item.audioReady = true; notify(item); break;
      }
      const wrapped = next.value, buffer = wrapped.buffer;
      let start = wrapped.timestamp - origin;
      if (buffer.duration > MAX_AUDIO_AHEAD || buffer.numberOfChannels > 8) {
        throw new Error('The decoded audio packet exceeds the playback memory limit.');
      }
      if (sampleRate !== null && sampleRate !== buffer.sampleRate) throw new Error('The audio sample rate changed during playback.');
      sampleRate = buffer.sampleRate;
      item.audioSourceRate = sampleRate; item.audioSourceChannels = buffer.numberOfChannels;
      item.audioDecodedFrames += buffer.length;
      const planes = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      for (const plane of planes) for (const sample of plane) {
        if (!Number.isFinite(sample)) { item.audioNonFiniteSamples++; throw new Error('The decoded audio contains non-finite PCM.'); }
        const peak = Math.abs(sample); item.audioPcmPeak = Math.max(item.audioPcmPeak, peak);
        if (peak > 1) item.audioPcmOverFullScaleSamples++;
      }
      if (start + buffer.length / sampleRate <= item.start) { item.audioSeekTrimmedFrames += buffer.length; continue; }
      // Packet PTS can be quantized to microseconds or a segment's 90 kHz clock.
      // Place continuous PCM on its nearest sample grid, with at most half a frame
      // of correction. A whole missing/overlapping sample is never swallowed.
      // Initial seek clipping is independent and always excludes pre-seek samples.
      if (hasDecoded) {
        const aligned = decodedEnd + Math.round((start - decodedEnd) * sampleRate) / sampleRate;
        if (start !== aligned) {
          item.audioAlignedPackets++;
          item.audioAlignmentMaxUs = Math.max(item.audioAlignmentMaxUs, Math.abs(start - aligned) * 1e6);
        }
        start = aligned;
      }
      const offset = Math.max(0, frameCeil(Math.max(item.start, decodedEnd), start, sampleRate));
      if (hasDecoded) item.audioOverlapTrimmedFrames += Math.min(offset, buffer.length);
      else item.audioSeekTrimmedFrames += Math.min(offset, buffer.length);
      if (offset >= buffer.length) continue;
      const channels = planes.map(plane => plane.subarray(offset));
      const actualStart = start + offset / sampleRate;
      const gap = actualStart - decodedEnd;
      if (!Number.isFinite(gap)) throw new Error('The audio timeline has an invalid timestamp.');
      // A fractional initial seek offset is not a missing source frame. All
      // subsequent packet boundaries have already been mapped to the PCM grid.
      const missingFrames = hasDecoded ? Math.max(0, Math.round(gap * sampleRate))
        : Math.max(0, Math.floor(gap * sampleRate + frameEpsilon(actualStart, decodedEnd, sampleRate)));
      if (missingFrames > 0) {
        // Track offsets are legitimate. Fill only bounded blocks as the clock makes
        // room, so a long silent introduction neither allocates its duration nor fails.
        for (let filled = 0; active(item) && filled < missingFrames;) {
          while (active(item) && (item.audioEnd - readPosition() >= MAX_AUDIO_AHEAD
            || item.audio.reduce((bytes, chunk) => bytes + chunk.channels.length * chunk.channels[0].byteLength, 0) >= MAX_AUDIO_BYTES)) await waitForRoom(item);
          if (!active(item)) return;
          const length = Math.min(Math.round(sampleRate * 0.25), missingFrames - filled);
          const cursor = decodedEnd + filled / sampleRate;
          const silence = new Float32Array(length);
          item.audioSilenceFrames += length;
          if (rate === 1) appendAudio(item, [silence, silence], sampleRate, cursor);
          else {
            if (!item.tempo) { item.tempo = createTempoProcessor(lib.SoundTouchCore, sampleRate, rate); item.tempoStart = cursor; }
            appendStretched(item, item.tempo.push(silence), sampleRate);
          }
          filled += length; notify(item);
        }
      }
      if (rate === 1) appendAudio(item, channels, sampleRate, actualStart);
      else {
        if (!item.tempo) { item.tempo = createTempoProcessor(lib.SoundTouchCore, sampleRate, rate); item.tempoStart = actualStart; }
        const stereo = downmixStereo(channels);
        appendStretched(item, item.tempo.push(stereo[0], stereo[1]), sampleRate);
      }
      decodedEnd = actualStart + channels[0].length / sampleRate; hasDecoded = true; notify(item);
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
  function bufferDecision(item, end) {
    const target = (item.hasPlayed ? CAST_PROFILE.resumeBufferMs : CAST_PROFILE.startupBufferMs) / 1000 * rate;
    if (end - position >= target - FRAME_EPSILON) return { ready: true, reason: 'watermark' };
    const ranges = trackRanges(item);
    const videoEnd = mediaRangeEnd(ranges.video, position), audioEnd = mediaRangeEnd(ranges.audio, position);
    // A short file or a limiting decoder/surface budget must not deadlock the
    // startup watermark. Decode no extra surfaces merely to satisfy a target.
    const videoSaturated = item.videoTrack && videoEnd <= end + FRAME_EPSILON
      && (item.videoDone || item.videoBudgetBlocked || videoFull(item, position));
    const audioSaturated = item.audioTrack && audioEnd <= end + FRAME_EPSILON
      && (item.audioDone || audioEnd - position >= MAX_AUDIO_AHEAD - FRAME_EPSILON
        || item.audio.reduce((bytes, chunk) => bytes + chunk.channels.reduce((sum, channel) => sum + channel.byteLength, 0), 0) >= MAX_AUDIO_BYTES);
    if (videoSaturated) return { ready: true, reason: item.videoDone ? 'end-of-stream' : 'video-budget' };
    if (audioSaturated) return { ready: true, reason: item.audioDone ? 'end-of-stream' : 'audio-budget' };
    // A decoder may require its already delivered surfaces to be returned before next()
    // can finish. Its actual pool is private. After the normal startup/recovery wait,
    // use only real playable coverage; do not label this unknown read as hardware full.
    const budget = (item.hasPlayed ? CAST_PROFILE.resumeBufferMs : CAST_PROFILE.startupBufferMs) / 1000;
    const waitingVideo = item.videoTrack && videoEnd <= end + FRAME_EPSILON && item.videoReadPending
      && now() - item.videoReadStarted >= budget;
    const waitingAudio = item.audioTrack && audioEnd <= end + FRAME_EPSILON && item.audioReadPending
      && now() - item.audioReadStarted >= budget;
    if (end > position + FRAME_EPSILON && (waitingVideo || waitingAudio)) return { ready: true, reason: 'read-progress-fallback' };
    return { ready: false, reason: item.hasPlayed ? 'resume-watermark' : 'startup-watermark' };
  }
  function bufferedForPlayback(item, end) { return bufferDecision(item, end).ready; }
  function playbackDiagnostics() {
    const item = generation, at = readPosition(), ranges = trackRanges(item);
    const videoEnd = item?.videoTrack ? mediaRangeEnd(ranges.video, at) : at;
    const audioEnd = item?.audioTrack ? mediaRangeEnd(ranges.audio, at) : at;
    const end = playableEnd(item);
    const videoFrames = item?.video.length || 0;
    const videoBytes = item?.video.reduce((bytes, frame) => bytes + frame.bytes, 0) || 0;
    const audioChunks = item?.audio.length || 0;
    const audioBytes = item?.audio.reduce((bytes, chunk) => bytes + chunk.channels.reduce((sum, channel) => sum + channel.byteLength, 0), 0) || 0;
    const audioActive = item?.audioTrack && !(item.audioDone && at >= item.audioEnd - FRAME_EPSILON);
    let limitingTrack = item?.videoTrack ? 'video' : audioActive ? 'audio' : 'none';
    if (item?.videoTrack && audioActive) limitingTrack = Math.abs(videoEnd - audioEnd) <= FRAME_EPSILON ? 'both'
      : videoEnd < audioEnd ? 'video' : 'audio';
    let waitReason = 'none';
    if (error) waitReason = 'error';
    else if (ended) waitReason = 'ended';
    else if (!source || disposed) waitReason = 'no-source';
    else if (paused && !seeking) waitReason = 'paused';
    else if (!item?.metadataReady) waitReason = 'preparing';
    else if (seeking) waitReason = 'seeking';
    else if (!item.videoReady) waitReason = 'video-starved';
    else if (!item.audioReady) waitReason = 'audio-starved';
    else if (audioClockNeeded(item) && context?.state !== 'running') {
      waitReason = resumeRequests ? 'audio-context-resume'
        : context?.state === 'closed' ? 'audio-context-closed' : 'audio-context-suspended';
    } else if (end <= at + FRAME_EPSILON) {
      const videoGap = item.videoTrack && item.video.some(frame => frame.start > at + 0.025);
      const audioGap = audioActive && item.audio.some(chunk => chunk.start > at + 0.025);
      waitReason = videoGap || audioGap ? 'timeline-gap' : limitingTrack === 'audio' ? 'audio-starved' : 'video-starved';
    } else if (!running) {
      waitReason = bufferedForPlayback(item, end) ? 'clock-stalled'
        : item.hasPlayed ? 'resume-watermark' : 'startup-watermark';
    }
    return {
      generation: item?.serial ?? serial, running, intentPlaying: !paused,
      waitReason, contextState: context?.state || 'unavailable', resumePending: resumeRequests > 0,
      clockSource: audioClockNeeded(item) ? 'audio' : 'performance', clockTime: currentClock(), clockPosition,
      scheduledEnd: item?.scheduledEnd ?? at, position: at, playableEnd: end, videoEnd, audioEnd,
      targetMs: (item?.hasPlayed ? CAST_PROFILE.resumeBufferMs : CAST_PROFILE.startupBufferMs) * rate,
      hasPlayed: item?.hasPlayed === true, limitingTrack,
      videoFrames, videoBytes, videoBudgetBlocked: item?.videoBudgetBlocked === true, videoDone: item?.videoDone === true,
      audioChunks, audioBytes, audioDone: item?.audioDone === true,
      videoReadPending: item?.videoReadPending === true, audioReadPending: item?.audioReadPending === true,
      startReason: item?.startReason || 'none', readProgressFallbacks: item?.readProgressFallbacks || 0,
      codec: item?.codec, codedWidth: item?.codedWidth, codedHeight: item?.codedHeight,
      displayWidth: item?.displayWidth, displayHeight: item?.displayHeight,
      observedSampleCadenceMs: item?.observedSampleCadenceMs, observedSampleDurationMs: item?.observedSampleDurationMs,
      requestedHardwareAcceleration: item?.requestedHardwareAcceleration || 'no-preference',
      hardwareSupportProbe: item?.hardwareSupportProbe || 'unknown', requestedVideoLatencyHint: 'not-requested', requestedAudioLatencyHint: 'interactive',
      videoHeldFrames: held ? 1 : 0, videoHeldBytes: held?.bytes || 0,
      videoPendingFrames: pendingSamples.size, videoPendingBytes: [...pendingSamples.values()].reduce((bytes, value) => bytes + value, 0),
      videoOwnedFrames: videoFrames + (held ? 1 : 0) + pendingSamples.size,
      videoOwnedBytes: videoBytes + (held?.bytes || 0) + [...pendingSamples.values()].reduce((bytes, value) => bytes + value, 0),
      samplesReceived, samplesClosed,
      videoSinkReadPendingMs: item?.videoReadPending ? Math.max(0, (now() - item.videoReadStarted) * 1000) : 0,
      lastSampleAgeMs: Number.isFinite(item?.lastSampleAt) ? Math.max(0, (now() - item.lastSampleAt) * 1000) : undefined,
      audioResumeRequests, audioResumeCompleted, audioResumeFailed,
      audioSourceRate: item?.audioSourceRate, audioSourceChannels: item?.audioSourceChannels,
      audioRequestedContextRate, audioContextRate: context?.sampleRate,
      audioDecodedFrames: item?.audioDecodedFrames, audioSeekTrimmedFrames: item?.audioSeekTrimmedFrames,
      audioOverlapTrimmedFrames: item?.audioOverlapTrimmedFrames, audioAlignedPackets: item?.audioAlignedPackets,
      audioAlignmentMaxUs: item?.audioAlignmentMaxUs, audioSilenceFrames: item?.audioSilenceFrames,
      audioScheduledFrames: item?.audioScheduledFrames, audioScheduleGapUs: item?.audioScheduleGapUs,
      audioScheduleOverlapUs: item?.audioScheduleOverlapUs, audioLateStarts: item?.audioLateStarts,
      audioLateStartMaxMs: item?.audioLateStartMaxMs, audioPcmPeak: item?.audioPcmPeak,
      audioPcmOverFullScaleSamples: item?.audioPcmOverFullScaleSamples, audioNonFiniteSamples: item?.audioNonFiniteSamples,
      userActivationHasBeenActive: globalThis.navigator?.userActivation?.hasBeenActive,
      gestureRequired: !paused && Boolean(audioClockNeeded(item)) && context?.state === 'suspended',
      videoHeldGeneration: held?.serial,
      videoCapacityFrames: VIDEO_BUFFER_LIMITS.maxFrames, videoCapacityBytes: VIDEO_BUFFER_LIMITS.maxBytes,
      videoCapacityAheadMs: VIDEO_BUFFER_LIMITS.maxAhead * 1000,
      audioCapacityBytes: MAX_AUDIO_BYTES, audioCapacityAheadMs: MAX_AUDIO_AHEAD * 1000,
      stallElapsedMs: item?.stallStarted !== null && item?.stallStarted !== undefined && !paused && !running
        ? Math.max(0, (now() - item.stallStarted) * 1000) : 0,
      stallCount: item?.stallCount || 0,
      ...fetchResource.getDiagnostics?.(),
    };
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
      if (selected) { closeSample(selected.sample); droppedVideoFrames++; }
      selected = frame;
    }
    if (selected) {
      held = { start: selected.start, end: selected.end, bytes: selected.bytes, serial: item.serial,
        sampleId: sampleOwners.get(selected.sample)?.id, unknownDuration: selected.unknownDuration };
      canvas.present(selected.sample);
    }
    notifyRoom(item);
  }
  function notifyRoom(item) { for (const resolve of item.waiters) resolve(); item.waiters.clear(); }
  function scheduleAudio(item, mediaEnd) {
    if (!item.audioTrack || !context || context.state !== 'running' || context.sampleRate !== item.audioSourceRate) return;
    const target = Math.min(mediaEnd, position + MAX_AUDIO_SCHEDULE * rate);
    let cursor = Math.max(position, item.scheduledEnd);
    for (const chunk of item.audio) {
      if (chunk.end <= cursor + 0.000001) continue;
      if (chunk.start > cursor + 0.025 || cursor >= target) break;
      // A just-decoded chunk can arrive behind the playback cursor. Clip that
      // first submission once, then advance only by samples actually submitted.
      const offset = Math.max(chunk.scheduledFrames,
        Math.min(chunk.channels[0].length, Math.max(0, frameCeil(cursor, chunk.start, chunk.sampleRate / rate))));
      const limit = Math.floor((target - chunk.start) / rate * chunk.sampleRate
        + frameEpsilon(target, chunk.start, chunk.sampleRate / rate));
      const length = Math.min(chunk.channels[0].length - offset, limit - offset);
      if (length < 1) continue;
      const start = chunk.start + offset / chunk.sampleRate * rate;
      const end = chunk.start + (offset + length) / chunk.sampleRate * rate;
      const buffer = context.createBuffer(chunk.channels.length, length, chunk.sampleRate);
      chunk.channels.forEach((channel, index) => buffer.copyToChannel(channel.subarray(offset, offset + length), index));
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(gain);
      item.nodes.add(node);
      node.onended = () => { item.nodes.delete(node); node.disconnect(); };
      // Every node uses the same anchor as currentTime and the video presenter.
      const expected = clockTime + (start - clockPosition) / rate;
      const when = Math.max(context.currentTime, expected);
      if (when > expected + 0.5 / chunk.sampleRate) {
        item.audioLateStarts++; item.audioLateStartMaxMs = Math.max(item.audioLateStartMaxMs, (when - expected) * 1000);
      }
      if (item.lastAudioNodeEnd !== null) {
        const delta = when - item.lastAudioNodeEnd;
        if (delta > 0.5 / chunk.sampleRate) item.audioScheduleGapUs += delta * 1e6;
        if (delta < -0.5 / chunk.sampleRate) item.audioScheduleOverlapUs -= delta * 1e6;
      }
      node.start(when);
      item.lastAudioNodeEnd = when + length / chunk.sampleRate;
      chunk.scheduledFrames = offset + length; item.audioScheduledFrames += length;
      cursor = end; item.scheduledEnd = end;
    }
  }
  function finish() {
    freeze(); ended = true; paused = true; seeking = false;
    if (Number.isFinite(duration)) position = duration;
    closeGeneration(); readyState = 2; networkState = 1;
    publishClock(); event('timeupdate'); event('ended'); settlePlay();
  }
  function checkReadProgress(item) {
    if (running || paused && !seeking && item.readySettled) return true;
    // A blocked AudioContext needs activation, not a decoder/network timeout.
    if (audioClockNeeded(item) && context && context.state !== 'running') return true;
    const waitingSince = item.stallStarted ?? (!item.readySettled || seeking ? item.openStartedAt : now());
    const deadline = (options.resourceDeadline || 15000) / 1000;
    if (now() - waitingSince < deadline) return true;
    const videoPending = item.videoReadPending && now() - Math.max(item.videoReadStarted, waitingSince) >= deadline;
    const audioPending = item.audioReadPending && now() - Math.max(item.audioReadStarted, waitingSince) >= deadline;
    if (!videoPending && !audioPending) return true;
    const resources = fetchResource.getDiagnostics?.();
    const networkPending = resources?.resourceActive > 0 || resources?.resourceQueued > 0;
    if (networkPending && resources.resourceLastProgressAgeMs < deadline * 1000) return true;
    readFailure(item, new DOMException(networkPending ? 'Media resource reading made no progress.'
      : 'Media sample reading made no progress without an active resource request.', 'TimeoutError'));
    return false;
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
      && (!audioClockNeeded(item) || context?.state === 'running' && context.sampleRate === item.audioSourceRate);
    if (canRun) {
      if (!running) {
        item.startReason = bufferDecision(item, end).reason;
        if (item.startReason === 'read-progress-fallback') item.readProgressFallbacks = Math.min(0xffffffff, item.readProgressFallbacks + 1);
        clockPosition = position; clockTime = currentClock(); running = true; item.hasPlayed = true;
        scheduleAudio(item, end); item.waiting = false; event('playing'); settlePlay();
      } else scheduleAudio(item, end);
    } else {
      if (running) freeze();
      if (!paused) eventWaiting(item);
    }
    if (item.readySettled) readyState = playableEnd(item) - position > 0.1 ? 3 : 2;
    if (!paused && !running) {
      if (item.stallStarted === null) { item.stallStarted = now(); item.stallCount = Math.min(0xffffffff, item.stallCount + 1); }
    } else item.stallStarted = null;
    if (!checkReadProgress(item)) return;
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
      // Every begin path (seek, track/rate edits and recovery) prepares its own
      // format through notify; an obsolete play continuation cannot own it.
      if (generation) prepareAudio(generation, true);
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
    contextEpoch++; audioResumePromise = null; resumeRequests = 0;
    if (context) void context.close().catch(() => {}); context = gain = null;
  }
  const getter = (name, get, set) => Object.defineProperty(media, name, { enumerable: true, get, ...(set ? { set } : {}) });
  getter('duration', () => duration); getter('currentTime', readPosition, seek);
  getter('timestampOrigin', () => origin);
  getter('audioTracks', () => audioTracks);
  getter('buffered', () => mediaTimeRanges(bufferedRanges()));
  getter('seekable', () => mediaTimeRanges(Number.isFinite(duration) && duration > 0 ? [[0, duration]] : bufferedRanges()));
  getter('paused', () => paused); getter('seeking', () => seeking); getter('ended', () => ended);
  getter('buffering', () => !ended && (!paused || seeking)
    && (!running || Boolean(audioClockNeeded(generation) && context?.state !== 'running')));
  getter('gestureRequired', () => !paused && Boolean(audioClockNeeded(generation)) && context?.state === 'suspended');
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
  Object.assign(media, { play, pause, load, dispose, selectAudioTrack, resumeFromGesture, getPlaybackDiagnostics: playbackDiagnostics,
    getVideoPlaybackQuality: () => ({ creationTime: now() * 1000, totalVideoFrames, droppedVideoFrames, corruptedVideoFrames: 0 }) });
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return media;
}
