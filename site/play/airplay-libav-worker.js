// SPDX-License-Identifier: GPL-3.0-only
import { createLibav, libavAudioParameters } from './vendor/libav/libav.js';
let lib, decoder, graph, source, sink, settings, inputEnd;
let queue = Promise.resolve(), direct = null, sequence = 0;
const split = value => [value >>> 0, Math.floor(value / 4294967296)];
async function execute(data) {
  if (data.kind === 'init') {
    if (lib) throw Error('Decoder already initialized.');
    settings = data.settings;
    const loaded = await createLibav(settings);
    lib = loaded.instance;
    if (settings.codec !== 'pcm') decoder = lib.ff_init_decoder(settings.codec, {
      codecpar: libavAudioParameters(settings.sampleRate, settings.channels, settings.description),
      time_base: [1, settings.sampleRate],
    });
    return { backend: loaded.backend };
  }
  if (!lib) throw Error('Decoder not initialized.');
  const [, context, packet, frame] = decoder || [null, null, null, lib.av_frame_alloc()];
  let packets = [];
  if (data.kind === 'decode') {
    if (!(data.payload instanceof ArrayBuffer) || data.payload.byteLength > 1024 * 1024
      || !Number.isFinite(data.timestamp)) throw Error('Invalid audio packet.');
    const [pts, ptshi] = split(Math.round(data.timestamp * settings.sampleRate));
    packets = [{ data: new Uint8Array(data.payload), pts, ptshi, dts: pts, dtshi: ptshi,
      time_base_num: 1, time_base_den: settings.sampleRate }];
  } else if (data.kind !== 'flush') throw Error('Invalid decoder operation.');
  const fin = data.kind === 'flush';
  let decoded;
  if (settings.codec === 'pcm' || data.silentFrames) {
    if (fin) decoded = [];
    else {
      const count = data.silentFrames || data.payload.byteLength / 2 / settings.channels;
      if (!Number.isInteger(count) || count < 1 || count > settings.sampleRate) throw Error('Invalid PCM frame size.');
      const format = settings.codec === 'pcm' ? 1 : 8;
      const samples = data.silentFrames ? (format === 8 ? Array.from({ length: settings.channels }, () => new Float32Array(count)) : new Int16Array(count * settings.channels)) : new Int16Array(data.payload);
      decoded = [{ data: samples, format, nb_samples: count, sample_rate: settings.sampleRate,
        channels: settings.channels, channel_layout: settings.channels === 1 ? 4 : 3,
        pts: packets[0].pts, ptshi: packets[0].ptshi, time_base_num: 1, time_base_den: settings.sampleRate }];
    }
  } else decoded = lib.ff_decode_multi(context, packet, frame, packets, { fin, copyoutFrame: 'ptr' });
  const frames = [];
  for (const input of decoded) {
    const pointer = typeof input === 'number';
    const pts = pointer ? (lib.AVFrame_pts(input) >>> 0) + lib.AVFrame_ptshi(input) * 4294967296
      : (input.pts >>> 0) + input.ptshi * 4294967296;
    const count = pointer ? lib.AVFrame_nb_samples(input) : input.nb_samples;
    if (pointer && (lib.AVFrame_sample_rate(input) !== settings.sampleRate || lib.AVFrame_channels(input) !== settings.channels))
      throw Error('Decoded audio format does not match its configuration.');
    if (graph && inputEnd !== undefined && Math.abs(pts - inputEnd) > 1) {
      frames.push(...lib.ff_filter_multi(source, sink, frame, [], { fin: true }));
      lib.avfilter_graph_free_js(graph); graph = null;
    }
    if (!graph) {
      [graph, source, sink] = lib.ff_init_filter_graph(`aresample=${settings.outputRate}`, {
        sample_rate: settings.sampleRate, sample_fmt: pointer ? lib.AVFrame_format(input) : input.format,
        channel_layout: settings.channels === 1 ? 4 : 3, time_base: [1, settings.sampleRate],
      }, { sample_rate: settings.outputRate, sample_fmt: settings.outputFormat ?? 8,
        channel_layout: settings.channels === 1 ? 4 : 3 });
    }
    frames.push(...lib.ff_filter_multi(source, sink, frame, [input], { fin: false }));
    inputEnd = pts + count;
  }
  if (graph && fin) frames.push(...lib.ff_filter_multi(source, sink, frame, [], { fin: true }));
  if (!decoder) lib.av_frame_free_js(frame);
  return { frames: frames.map(value => {
    const timestamp = ((value.pts >>> 0) + value.ptshi * 4294967296)
      * value.time_base_num / value.time_base_den;
    if (!Number.isFinite(timestamp)) throw Error('Invalid output timestamp.');
    if (settings.outputFormat === 1) {
      const pcm = value.data;
      if (!(pcm instanceof Int16Array) || pcm.length > settings.outputRate * settings.channels) throw Error('Invalid PCM16 output.');
      return { timestamp, pcm: pcm.buffer, sampleRate: settings.outputRate };
    }
    if (!Array.isArray(value.data)
      || value.data.length !== settings.channels || value.data.some(plane => !(plane instanceof Float32Array)
        || plane.length > 32768)) throw Error('Invalid decoded audio output.');
    return { timestamp, planes: value.data, sampleRate: settings.outputRate };
  }) };
}
/** The render endpoint owns admission; only metadata returns to the main thread. */
function connectOutput(output) {
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Binding can be rejected while the decoder module is still loading.
  ready.catch(() => {});
  output.port.onmessage = ({ data }) => {
    if (data.ready) { readyResolve(); return; }
    if (data.failed) {
      const cause = Error(data.failed); readyReject(cause);
      for (const call of pending.values()) call.reject(cause); pending.clear(); return;
    }
    const call = pending.get(data.deliveryId);
    if (!call) return;
    pending.delete(data.deliveryId);
    if (data.error) call.reject(Object.assign(Error(data.error), { deliveryId: data.deliveryId })); else call.resolve();
  };
  output.port.start?.();
  return { ...output, ready, pending };
}
async function deliver(data, result) {
  if (settings.outputFormat === 1 && (result.frames || []).reduce((bytes, frame) => bytes + (frame.pcm?.byteLength || 0), 0) > 256 * 1024)
    throw Error('Audio decode output batch exceeds its memory limit.');
  if (!direct) return result;
  await direct.ready;
  const owner = direct.record;
  if (data.record) direct.fields = data.record;
  const fields = { ...owner, ...(direct.fields || {}) };
  const at = performance.timeOrigin + performance.now();
  const arrival = at - (Number.isFinite(owner.arrivalTimeOrigin) ? owner.arrivalTimeOrigin : performance.timeOrigin);
  const records = (result.frames || []).map(frame => {
    if (!(frame.pcm instanceof ArrayBuffer)) throw Error('Direct audio output requires PCM16.');
    const timestamp = frame.timestamp * 1e6;
    let pcmStats;
    if (fields.diagnosticPcm) {
      pcmStats = { packets: 1, frames: frame.pcm.byteLength / 2 / fields.channels, nonzero: 0, peak: 0 };
      for (const sample of new Int16Array(frame.pcm)) {
        if (sample) pcmStats.nonzero++; pcmStats.peak = Math.max(pcmStats.peak, Math.abs(sample) / 32768);
      }
    }
    return { ...fields, sequence: sequence++, flags: fields.flags & ~2, rate: 48000, pcm: frame.pcm,
      decodeTimestampUs: timestamp, presentationMs: Number.isFinite(fields.presentationOffsetMs)
        ? timestamp / 1000 + fields.presentationOffsetMs : NaN,
      arrivalLocalTimeMs: arrival, decodedAtMs: at, workletPostedAtMs: at, ...(pcmStats ? { pcmStats } : {}) };
  });
  if (data.kind === 'init') records.push({ ...owner, flags: owner.flags | 2, ended: false, pcm: new ArrayBuffer(0) });
  if (data.endRecord) records.push({ ...owner, ...data.endRecord, generation: owner.generation,
    flags: data.endRecord.flags | 2, ended: true, pcm: new ArrayBuffer(0) });
  // The worklet reports this batch to main before it can return consumption credit.
  const accepted = new Promise((resolve, reject) => direct.pending.set(data.id, { resolve, reject }));
  direct.port.postMessage({ deliveryId: data.id, records }, [...new Set(records.map(record => record.pcm))]);
  await accepted;
  return { ...result, frames: [], deliveryId: data.id };
}
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.kind === 'init' && data.output) direct = connectOutput(data.output);
      const result = await deliver(data, await execute(data));
      const transfers = result.frames?.flatMap(frame => frame.pcm ? [frame.pcm] : frame.planes.map(plane => plane.buffer)) || [];
      self.postMessage({ id: data.id, ...result }, [...new Set(transfers)]);
    } catch (cause) { self.postMessage({ id: data.id, error: String(cause?.message || cause),
      ...(cause?.deliveryId !== undefined ? { deliveryId: cause.deliveryId } : {}) }); }
  });
};
