// SPDX-License-Identifier: GPL-3.0-only
const MAX_INSTANCES = 4;
let instances = 0;

/** The bundled decoder implements raw ELD without SBR, MPS or resilience extensions. */
export function softwareEldOptions(config) {
  if (config?.codec !== 'aac-eld' || ![44100, 48000].includes(config.sampleRate)
    || ![1, 2].includes(config.channels) || (config.bitDepth ?? 16) !== 16
    || !Array.isArray(config.asc) || config.asc.length !== 4) return null;
  const frameLength = config.samplesPerFrame ?? (config.asc[2] & 0x10 ? 480 : 512);
  const expected = [0xf8, config.sampleRate === 44100 ? 0xe8 : 0xe6,
    (config.channels << 5) | (frameLength === 480 ? 0x10 : 0), 0];
  if (![480, 512].includes(frameLength) || config.asc.some((value, index) => value !== expected[index])) return null;
  return { sampleRate: config.sampleRate, channels: config.channels, frameLength };
}

/** One worker/heap belongs to one decoder epoch; terminating it cancels initialization and queued work. */
export function createSoftwareEldDecoder(config, { Worker = globalThis.Worker, initTimeout = 5000, packetTimeout = 2000 } = {}) {
  const options = softwareEldOptions(config);
  if (!options) throw new Error('Unsupported software AAC-ELD configuration.');
  if (typeof Worker !== 'function') throw new Error('Software AAC-ELD decoding requires a Worker.');
  if (instances >= MAX_INSTANCES) throw new Error('Software AAC-ELD decoder limit reached.');
  let worker, closed = false, next = 0, readyResolve, readyReject, initTimer;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  instances++;
  function close(cause = new DOMException('AAC-ELD decoder was closed.', 'AbortError')) {
    if (closed) return;
    closed = true; instances--; clearTimeout(initTimer);
    worker?.terminate(); readyReject(cause);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(cause); }
    pending.clear();
  }
  try {
    worker = new Worker(new URL('aac-eld-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => close(new Error('Software AAC-ELD worker failed.'));
    worker.onmessageerror = () => close(new Error('Invalid software AAC-ELD worker response.'));
    worker.onmessage = ({ data }) => {
      if (closed) return;
      if (data?.kind === 'ready') { clearTimeout(initTimer); readyResolve(); return; }
      if (data?.kind === 'error') { close(new Error('Software AAC-ELD decoding failed.')); return; }
      const request = pending.get(data?.id);
      if (data?.kind !== 'pcm' || !request || !(data.pcm instanceof ArrayBuffer)
        || data.pcm.byteLength !== options.frameLength * options.channels * 2) {
        close(new Error('Invalid software AAC-ELD output.')); return;
      }
      pending.delete(data.id); clearTimeout(request.timer); request.resolve(data.pcm);
    };
    initTimer = setTimeout(() => close(new Error('Software AAC-ELD initialization timed out.')), initTimeout);
    worker.postMessage({ kind: 'configure', options });
  } catch (cause) { close(cause); }
  return {
    ready, close,
    async decode(payload) {
      await ready;
      if (closed) throw new DOMException('AAC-ELD decoder was closed.', 'AbortError');
      const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 8192)
        throw new Error('Software AAC-ELD packet must contain 1..8192 bytes.');
      if (pending.size >= 32) throw new Error('Software AAC-ELD decode queue is full.');
      const id = ++next, copy = new Uint8Array(bytes);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => close(new Error('Software AAC-ELD decoding timed out.')), packetTimeout);
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ kind: 'decode', id, packet: copy.buffer }, [copy.buffer]); }
        catch (cause) { close(cause); }
      });
    },
  };
}
