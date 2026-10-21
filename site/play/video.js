/*! SPDX-License-Identifier: GPL-3.0-only
 * TiPlay WebCodecs video: §3 records → VideoDecoder → frames, and a presenter that draws frames on a canvas
 * (WebGL, 2D as a fallback). Runs in decoder-worker.js on the Tesla path, or on the main thread as a fallback. */
import { FLAG, RECORD, RecordError, RecordStreamError, Samples, abortable, chooseDecoderConfig, createRecordStream, letterbox } from './link.js';
import { createFpsWindow } from './fps-window.js';
import { createVideoFramePacer } from './video-pacing.js';
import { presentationTime, presentationClockState, CLOCK_STALE_AFTER_MS } from './clock-sync.js';
import { videoExpired } from './playback-window.js';
import { hasHdrTransfer } from './airplay-sdr.js';
import { createAudioReferenceTimeline } from './audio-output-clock.js';

const KEY_REQUEST_INTERVAL_MS = 1000;
const MAX_DECODE_QUEUE = 16;
// decodeQueueSize excludes reference pictures already accepted by the decoder.
// Retain enough lookahead for reordered streams while bounding hidden work too.
const MAX_DECODE_IN_FLIGHT = 48;
const MAX_DECODE_BYTES = 32 * 1024 * 1024;
const DECODE_WAIT_TIMEOUT_MS = 1000;
const MAX_FAILURES = 4; // decoder errors without a decoded frame before the page gives up on this config
const utf8 = new TextDecoder();

/**
 * Decodes record streams. `post(message)` gets {type:'alive'|'config'|'keyframe'|'unsupported'|'end'};
 * `present(frame)` takes ownership of every decoded VideoFrame.
 */
export function createDecoderPipeline({ post: send, present, decodeWaitMs = DECODE_WAIT_TIMEOUT_MS, decoderProbeWaitMs = 3000 }) {
  const decoderSupports = config => VideoDecoder.isConfigSupported(config);
  const decodeStarts = new Map();
  const presentationTimes = new Map();
  let clock = null;
  const readFrameIntervals = new Samples(), sourceForwardPtsIntervals = new Samples();
  const decodeMs = new Samples(), decodeAdmissionMs = new Samples(), androidQueueMs = new Samples(), transportSubmitToRecordReadMs = new Samples();
  let lastReadAt = null, lastSource = null, presentationTimingState = 'unobserved';
  const totals = { decoded: 0, dropped: 0, decodeErrors: 0, backlogResets: 0, keyRequests: 0, timingRecords: 0, timingRejected: 0,
    decodeBackpressureWaits: 0, decodeBackpressureMs: 0, decodeStalls: 0, decoderAbortedFrames: 0, decodeOnlyFrames: 0, readFrames: 0, readFrameBytes: 0, sourceForwardPtsSamples: 0, sourceReorderedPts: 0 };
  const decodeWaiters = new Set();
  let decodeBytes = 0, decoderErrorName = null, decoderErrorMessage = null;
  let decodeDroppedFrames = 0;
  const dropped = () => { totals.dropped++; decodeDroppedFrames++; };
  let decoder = null, decoderConfig = null, config = null, codecSupported = null;
  let streamId = null, timer = null;
  let needKey = true, lastKeyRequest = -Infinity, failures = 0;
  const post = message => send({ ...message, id: streamId });
  const records = createRecordStream({
    onRecord: (record, signal) => {
      if (record.kind === RECORD.CONFIG) return configure(record, signal);
      if (record.kind === RECORD.IDLE) {
        closeDecoder();
        config = decoderConfig = null;
        codecSupported = null;
        needKey = true;
        rates.decodedFps = 0;
        post({ type: 'idle' });
        return null;
      }
      if (record.kind === RECORD.TIMING && [8, 24].includes(record.payload.byteLength)) {
        const values = new DataView(record.payload.buffer, record.payload.byteOffset, record.payload.byteLength);
        const presentation = values.getFloat64(0, true);
        const queuedAtMs = values.byteLength === 24 ? values.getFloat64(8, true) : null;
        const transportSubmitAtMs = values.byteLength === 24 ? values.getFloat64(16, true) : null;
        if ([queuedAtMs, transportSubmitAtMs].every(Number.isFinite) && transportSubmitAtMs >= queuedAtMs) androidQueueMs.add(transportSubmitAtMs - queuedAtMs);
        const mapped = presentationTime(presentation, clock);
        totals.timingRecords++;
        if (mapped === null) totals.timingRejected++;
        presentationTimes.set(`${record.epoch}:${record.timestampUs}`, { mapped, sourceTimeMs: presentation,
          clockGeneration: clock?.generation, transportSubmitAtMs });
        if (presentationTimes.size > 120) presentationTimes.delete(presentationTimes.keys().next().value);
      }
      if (record.kind === RECORD.FRAME) {
        const at = performance.now(), recordReadAtMs = performance.timeOrigin + at;
        if (lastReadAt !== null && at >= lastReadAt) readFrameIntervals.add(at - lastReadAt);
        lastReadAt = at; totals.readFrames++; totals.readFrameBytes += record.payload.byteLength;
        const source = presentationTimes.get(`${record.epoch}:${record.timestampUs}`);
        if (Number.isFinite(source?.mapped) && Number.isFinite(source?.sourceTimeMs)) {
          if (lastSource && lastSource.epoch === record.epoch && lastSource.generation === source.clockGeneration) {
            const interval = source.sourceTimeMs - lastSource.at;
            if (interval >= 0) { sourceForwardPtsIntervals.add(interval); totals.sourceForwardPtsSamples++; }
            else totals.sourceReorderedPts++;
          }
          lastSource = { epoch: record.epoch, generation: source.clockGeneration, at: source.sourceTimeMs };
        } else lastSource = null;
        const mappedSubmit = Number.isFinite(source?.transportSubmitAtMs) ? presentationTime(source.transportSubmitAtMs, clock) : null;
        if (Number.isFinite(mappedSubmit)) transportSubmitToRecordReadMs.add(recordReadAtMs - mappedSubmit);
        return decodeFrame(record, signal, recordReadAtMs);
      }
      return null;
    },
    onAlive: id => post({ type: 'alive', id }),
    onEnd: (id, reason) => {
      // Cleanup retires the codec/epoch and in-flight work. Preserve their last
      // scalar evidence for the owner before it closes the shared peer.
      let stats;
      try { stats = api.stats(); } catch (_) {} // Fault evidence must never prevent retirement.
      stop();
      send({ type: 'end', id, reason, stats });
    },
  });
  let rates = { decodedFps: 0, bytesPerSec: 0 }, lastTick = { at: performance.now(), decoded: 0, bytes: 0 };
  function tick() {
    records.watchdog();
    const now = performance.now(), seconds = (now - lastTick.at) / 1000, bytes = records.stats().bytes;
    rates = { decodedFps: Math.round((totals.decoded - lastTick.decoded) / seconds * 10) / 10, bytesPerSec: Math.round((bytes - lastTick.bytes) / seconds) };
    lastTick = { at: now, decoded: totals.decoded, bytes };
  }

  async function configure(record, signal) {
    let info;
    try {
      info = JSON.parse(utf8.decode(record.payload));
    } catch (_) {
      throw new RecordError('config is not JSON');
    }
    const next = { streamId, epoch: record.epoch, mode: info.mode ?? null, codec: String(info.codec), width: info.width | 0, height: info.height | 0, fps: info.fps | 0 };
    post({ type: 'config', config: next });
    // The phone repeats a byte-identical config at every stream start; keep the decoder then.
    const same = config && decoder?.state === 'configured' && ['epoch', 'mode', 'codec', 'width', 'height'].every(key => config[key] === next[key]);
    config = next;
    if (same) return;
    decodeDroppedFrames = 0; presentationTimingState = 'unobserved';
    // Late output of the old decoder would otherwise be drawn and reported as the first frame of the new epoch.
    closeDecoder();
    let chosen, probeTimer;
    try {
      chosen = await abortable(Promise.race([
        chooseDecoderConfig(decoderSupports, next),
        new Promise((_, reject) => { probeTimer = setTimeout(() => reject(new RecordStreamError('decoder-probe-timeout', 'VideoDecoder capability query did not complete')), decoderProbeWaitMs); }),
      ]), signal);
    } catch (error) {
      if (signal.aborted) return;
      recordDecoderError(error);
      throw error;
    } finally { clearTimeout(probeTimer); }
    if (signal.aborted || config !== next) return; // a newer config arrived meanwhile
    decoderConfig = chosen;
    codecSupported = Boolean(chosen);
    failures = 0;
    if (!decoderConfig) {
      closeDecoder();
      post({ type: 'unsupported', codec: next.codec });
      return;
    }
    openDecoder();
  }

  function openDecoder() {
    closeDecoder();
    const created = new VideoDecoder({
      output: frame => onFrame(created, frame),
      error: error => {
        if (created === decoder) failed(error);
      },
    });
    decoder = created;
    try { decoder.configure(decoderConfig); }
    catch (error) {
      recordDecoderError(error);
      closeDecoder(); codecSupported = false;
      post({ type: 'unsupported', codec: config?.codec, reason: 'decoder-configuration', detail: decoderErrorMessage });
      return false;
    }
    needKey = true;
    return true;
  }

  function closeDecoder() {
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = null;
    totals.decoderAbortedFrames += decodeStarts.size;
    decodeStarts.clear();
    decodeBytes = 0;
    presentationTimes.clear();
    lastReadAt = lastSource = null;
    for (const wake of decodeWaiters) wake();
  }

  /**
   * A decoder that reported an error is closed, so build a new one; the picture resumes at the next key frame.
   * Repeated errors without a decoded frame end this configuration; never opt into software decoding.
   */
  function recordDecoderError(error) {
    totals.decodeErrors++;
    decoderErrorName = String(error?.name ?? 'Error');
    decoderErrorMessage = String(error?.message ?? 'VideoDecoder reported an error').slice(0, 512);
  }

  function failed(error) {
    recordDecoderError(error);
    failures++;
    if (failures > MAX_FAILURES) {
      closeDecoder();
      codecSupported = false;
      post({ type: 'unsupported', codec: decoderConfig.codec });
      return;
    }
    if (openDecoder()) requestKeyFrame();
  }

  function requestKeyFrame() {
    const now = performance.now();
    if (now - lastKeyRequest < KEY_REQUEST_INTERVAL_MS) return;
    lastKeyRequest = now;
    totals.keyRequests++;
    post({ type: 'keyframe' });
  }

  function decodeRoom(bytes) {
    return decoder?.state === 'configured' && decoder.decodeQueueSize < MAX_DECODE_QUEUE
      && decodeStarts.size < MAX_DECODE_IN_FLIGHT && decodeBytes + bytes <= MAX_DECODE_BYTES;
  }

  /** Stop pulling encoded records until decoder capacity returns; never drop a dependency to catch up. */
  function waitForDecodeRoom(bytes, signal) {
    if (decodeRoom(bytes)) return null;
    const source = decoder, started = performance.now();
    totals.decodeBackpressureWaits++;
    return new Promise((resolve, reject) => {
      let timer = null, done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        source?.removeEventListener?.('dequeue', wake);
        decodeWaiters.delete(wake);
        totals.decodeBackpressureMs += performance.now() - started;
        if (error) reject(error); else resolve();
      };
      const aborted = () => finish(new Error('stream stopped'));
      const wake = () => {
        if (source !== decoder || source?.state !== 'configured') finish(new RecordStreamError('decode-reset', 'Decoder changed while waiting for complete input'));
        else if (decodeRoom(bytes)) finish();
      };
      decodeWaiters.add(wake);
      source?.addEventListener?.('dequeue', wake);
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => {
        totals.decodeStalls++;
        decoderErrorName = 'DecodeBackpressureError';
        decoderErrorMessage = 'Decoder capacity did not return before the bounded wait expired';
        finish(new RecordStreamError('decode-stalled', decoderErrorMessage));
      }, decodeWaitMs);
      if (signal.aborted) aborted(); else wake();
    });
  }

  async function decodeFrame(record, signal, recordReadAtMs) {
    const key = (record.flags & FLAG.KEY) !== 0;
    if (config && record.epoch !== config.epoch) throw new RecordStreamError('video-epoch', 'Encoded frame does not belong to the configured video epoch');
    if (decoder?.state !== 'configured' || (needKey && !key)) {
      dropped();
      if (decoder) requestKeyFrame();
      return;
    }
    const pending = waitForDecodeRoom(record.payload.byteLength, signal);
    if (pending) await pending;
    if (signal.aborted) return;
    if (decodeStarts.has(record.timestampUs)) throw new RecordStreamError('video-timestamp', 'Duplicate timestamp in outstanding encoded video');
    needKey = false;
    const decodeSubmitAtMs = performance.timeOrigin + performance.now();
    decodeAdmissionMs.add(decodeSubmitAtMs - recordReadAtMs);
    decodeStarts.set(record.timestampUs, { recordReadAtMs, decodeSubmitAtMs, bytes: record.payload.byteLength,
      decodeOnly: (record.flags & FLAG.DECODE_ONLY) !== 0 });
    decodeBytes += record.payload.byteLength;
    try {
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: record.timestampUs, data: record.payload }));
    } catch (error) {
      dropped(); // This input was rejected; decoder-internal reset losses are not observable.
      failed(error);
    }
  }

  function onFrame(source, frame) {
    if (source !== decoder) {
      frame.close();
      return;
    }
    if (config?.mode === 'airplay-mirror' && hasHdrTransfer(frame.colorSpace)) {
      frame.close(); dropped(); closeDecoder(); codecSupported = false;
      post({ type: 'unsupported', codec: config.codec, reason: 'hdr', detail: 'AirPlay mirroring requires SDR video.' });
      return;
    }
    const decodedAtMs = performance.timeOrigin + performance.now();
    const started = decodeStarts.get(frame.timestamp);
    if (started !== undefined) {
      decodeStarts.delete(frame.timestamp);
      decodeBytes -= started.bytes;
      decodeMs.add(decodedAtMs - started.decodeSubmitAtMs);
      for (const wake of decodeWaiters) wake();
    }
    totals.decoded++;
    failures = 0;
    const key = `${config?.epoch}:${frame.timestamp}`;
    const timing = presentationTimes.get(key);
    presentationTimes.delete(key);
    presentationTimingState = Number.isFinite(timing?.mapped) ? 'mapped-presentation' : 'unavailable';
    if (started?.decodeOnly) { totals.decodeOnlyFrames++; frame.close(); return; }
    present(frame, { ...config, stageTiming: { recordReadAtMs: started?.recordReadAtMs, decodeSubmitAtMs: started?.decodeSubmitAtMs, decodedAtMs } }, streamId, timing?.mapped, timing && { sourceTimeMs: timing.sourceTimeMs, clockGeneration: timing.clockGeneration });
  }

  function stop() {
    records.stop();
    clearInterval(timer);
    timer = null;
    closeDecoder();
    config = decoderConfig = null;
    streamId = null;
    codecSupported = null;
  }

  const api = {
    /** Every stream starts with a config record and a key frame; outputs still in the decoder are harmless. */
    clock(value) { clock = value; },
    read(id, stream) {
      stop();
      decodeDroppedFrames = 0;
      streamId = id;
      lastTick = { at: performance.now(), decoded: totals.decoded, bytes: records.stats().bytes };
      timer = setInterval(tick, 1000);
      needKey = true;
      return records.read(id, stream);
    },
    stop,
    stats: () => {
      const at = performance.timeOrigin + performance.now(), sourceClockState = presentationClockState(clock, at);
      return {
      decoderStatsSampledAtMs: at,
      codec: config?.codec ?? null, epoch: config?.epoch ?? null, mode: config?.mode ?? null, streamGeneration: streamId,
      codecSupported,
      clockRttMs: sourceClockState === 'fresh' ? clock.rtt : null,
      sourceClockState,
      sourceClockAgeMs: Number.isFinite(clock?.at) && at >= clock.at ? at - clock.at : null,
      sourceClockGeneration: clock?.generation,
      sourceClockMaxAgeMs: CLOCK_STALE_AFTER_MS,
      width: config?.width ?? null,
      height: config?.height ?? null,
      // This is the requested hint; the actual decoder implementation is not exposed by WebCodecs.
      acceleration: decoderConfig?.hardwareAcceleration ?? null,
      decoderImplementation: 'unknown',
      presentationTimingState,
      senderRelativePolicyCeilingMs: config?.mode === 'carplay' && presentationTimingState === 'mapped-presentation' ? 300 : null,
      decodeQueueSize: decoder?.decodeQueueSize ?? 0,
      decodeInFlightFrames: decodeStarts.size,
      decodeInFlightBytes: decodeBytes,
      decodeOldestInFlightMs: decoder?.state === 'configured' && decodeStarts.size
        ? Math.max(0, at - Math.min(...[...decodeStarts.values()].map(item => item.decodeSubmitAtMs))) : null,
      decoderErrorName, decoderErrorMessage,
      ...rates,
      readFrameIntervalMsP95: readFrameIntervals.percentile(95), readFrameIntervalMsMax: readFrameIntervals.percentile(100),
      sourceForwardPtsIntervalMsP95: sourceForwardPtsIntervals.percentile(95),
      recordReadToDecodeSubmitMsP95: decodeAdmissionMs.percentile(95),
      androidHubQueueMsP95: androidQueueMs.percentile(95),
      androidTransportSubmitToRecordReadMsP95: transportSubmitToRecordReadMs.percentile(95),
      stageClockUncertaintyMs: clock?.uncertaintyMs ?? null,
      decodeMsP50: decodeMs.percentile(50),
      decodeMsP95: decodeMs.percentile(95),
      ...records.stats(),
      ...totals,
      decodeDroppedFrames,
      };
    },
  };
  return api;
}

/**
 * Draws frames letterboxed with the aspect of the negotiated CarPlay canvas, which is what touch mapping assumes.
 * It keeps the last frame (closing the one before) so a resize can redraw a still CarPlay screen.
 */
export function createFramePresenter(canvas, { now = () => performance.timeOrigin + performance.now(),
  applyTimingPolicy = false, pace = false, onPresent, onFirstPresent } = {}) {
  const drawMs = new Samples(), decodedToDrawMs = new Samples();
  const fpsWindow = createFpsWindow();
  let renderer = createRenderer(canvas), lastFrame = null, lastConfig = null, expiredFrames = 0, untimedFrames = 0, renderDroppedFrames = 0;
  let audioReferenceState = 'video-only', audioVideoSkewMs = null, drawnFrames = 0;
  const audioReferences = createAudioReferenceTimeline();
  let audioTracking = false, provenId = null, provenEpoch = null;

  function draw(frame, allowed, flush = true) {
    const width = lastConfig?.width || frame.displayWidth, height = lastConfig?.height || frame.displayHeight;
    return renderer.draw(frame, letterbox(canvas.width, canvas.height, width, height), allowed, flush);
  }

  const lost = event => event.preventDefault();
  const restored = () => {
    renderer.dispose?.();
    renderer = createRenderer(canvas);
    if (lastFrame) draw(lastFrame);
  };
  if (renderer.kind !== '2d') {
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
  }

  function presentNow(frame, config, timing, outputWindow, reason = 'immediate') {
    if (lastConfig?.epoch !== config?.epoch) {
      fpsWindow.reset();
      expiredFrames = untimedFrames = renderDroppedFrames = drawnFrames = 0;
      audioReferenceState = 'video-only'; audioVideoSkewMs = null;
    }
    lastConfig = config;
    const late = () => applyTimingPolicy && videoExpired(timing, config?.mode, now());
    let checkedAt = null, checkedAudioAt = outputWindow?.audioAt;
    const observeAudio = at => {
      if (audioTracking) {
        const resolved = audioReferences.resolve(config?.mode, outputWindow?.sourceTimeMs, outputWindow?.clockGeneration, at);
        audioReferenceState = resolved.state;
        checkedAudioAt = Number.isFinite(resolved.audioAt) ? resolved.audioAt : null;
      } else {
        audioReferenceState = outputWindow?.state ?? (Number.isFinite(checkedAudioAt) ? 'audio-output' : 'video-only');
      }
      audioVideoSkewMs = Number.isFinite(checkedAudioAt) ? checkedAudioAt - at : null;
    };
    if (late()) { expiredFrames++; renderDroppedFrames++; frame.close(); return; }
    const started = performance.now();
    let drawn;
    let expired = false;
    try { drawn = draw(frame, () => {
      checkedAt = now();
      expired = applyTimingPolicy && videoExpired(timing, config?.mode, checkedAt);
      observeAudio(checkedAt);
      return !expired;
    }, reason !== 'refresh') !== false; }
    catch (error) { renderDroppedFrames++; frame.close(); throw error; }
    if (expired) { expiredFrames++; renderDroppedFrames++; frame.close(); return; }
    if (!drawn) { renderDroppedFrames++; frame.close(); return; }
    if (!Number.isFinite(timing)) untimedFrames++;
    drawMs.add(performance.now() - started);
    if (Number.isFinite(config?.stageTiming?.decodedAtMs) && Number.isFinite(checkedAt)) decodedToDrawMs.add(checkedAt - config.stageTiming.decodedAtMs);
    const at = performance.now();
    const offset = Number.isFinite(timing) ? checkedAt - timing : null;
    if (drawn) {
      drawnFrames++; fpsWindow.frame(at, 1, offset);
    }
    lastFrame?.close();
    lastFrame = frame;
    onPresent?.({ at: checkedAt, timing, audioAt: checkedAudioAt });
    // Decode, scheduling and even texture upload may all succeed without a canvas submission.
    // Only the final draw can prove a connection usable, including the worker-transfer fallback.
    if (config && (provenId !== config.streamId || provenEpoch !== config.epoch)) {
      provenId = config.streamId; provenEpoch = config.epoch;
      onFirstPresent?.(config);
    }
  }
  const pacer = pace ? createVideoFramePacer(presentNow, { now,
    budget: () => Math.max(4, (drawMs.percentile(95) ?? 3) + 1),
  }) : null;
  return {
    present(frame, config, timing, outputWindow) {
      if (pacer) pacer.present(frame, config, timing, outputWindow);
      else presentNow(frame, config, timing, outputWindow);
    },
    resize(width, height) {
      if (width < 1 || height < 1 || (canvas.width === width && canvas.height === height)) return;
      canvas.width = width;
      canvas.height = height;
      if (lastFrame) draw(lastFrame);
    },
    audio(reference) { audioTracking = true; audioReferences.update(reference); },
    close() {
      pacer?.reset(); fpsWindow.reset();
      lastFrame?.close();
      lastFrame = null;
      lastConfig = null;
      provenId = provenEpoch = null;
      expiredFrames = untimedFrames = renderDroppedFrames = drawnFrames = 0;
      audioReferenceState = 'video-only'; audioVideoSkewMs = null;
    },
    dispose() {
      pacer?.reset(); fpsWindow.reset();
      lastFrame?.close();
      lastFrame = null;
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      renderer.dispose?.();
    },
    stats: () => ({ drawnFrames, decodedToDrawMsP95: decodedToDrawMs.percentile(95), renderer: renderer.kind, canvas: `${canvas.width}x${canvas.height}`, drawMsP95: drawMs.percentile(95), expiredFrames, untimedFrames, renderDroppedFrames,
      audioRenderSyncDroppedFrames: 0, audioReferenceState, audioVideoSkewMs, ...pacer?.stats(), ...fpsWindow.stats() }),
  };
}

export function createRenderer(canvas) {
  const options = { alpha: false, antialias: false, depth: false, desynchronized: true, powerPreference: 'high-performance' };
  const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
  if (gl) return glRenderer(gl);
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  return {
    kind: '2d',
    draw(frame, box, allowed = () => true) {
      if (!allowed()) return false;
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frame, box.x, box.y, box.width, box.height);
    },
  };
}

function glRenderer(gl) {
  const vertex = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x+1.,1.-p.y)*.5;gl_Position=vec4(p,0.,1.);}';
  const fragment = 'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,uv);}';
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.clearColor(0, 0, 0, 1);
  return {
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
    kind: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
    draw(frame, box, allowed = () => true, flush = false) {
      if (gl.isContextLost()) return false;
      const { height } = gl.canvas;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.viewport(box.x, height - box.y - box.height, box.width, box.height);
      if (!allowed()) return false;
      // Clearing and submitting the picture form one operation after the final
      // deadline check; an expired upload must leave the retained picture intact.
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // RAF flushes at its frame boundary. Timer/immediate submissions need an
      // explicit nonblocking dispatch; never wait for GPU completion with finish().
      if (flush) gl.flush();
    },
  };
}
