// SPDX-License-Identifier: GPL-3.0-only
import { Input, UrlSource, ALL_FORMATS, EncodedPacketSink } from '/play/vendor/mediabunny/mediabunny.min.js';
import { encodeRecord, RECORD, FLAG } from '/play/link.js';
import { constantDelay } from '/play/delay-plan.js';
import { createFramePresenter } from '/play/video.js';

// This fixture is an original 16x16 black H.264 sample, not captured media.
const input = new Input({ source: new UrlSource(new URL('/fixtures/embedded-tx3g.mp4', location.href)), formats: ALL_FORMATS });
const track = await input.getPrimaryVideoTrack(), decoderConfig = await track.getDecoderConfig();
const packet = await new EncodedPacketSink(track).getFirstPacket();
const description = new Uint8Array(decoderConfig.description);
const lengthSize = (description[4] & 3) + 1, nals = [];
let position = 6;
for (let set = 0, count = description[5] & 31; set < 2; set++, count = description[position++]) {
  for (let index = 0; index < count; index++) {
    const size = description[position++] * 256 + description[position++];
    nals.push(description.slice(position, position + size)); position += size;
  }
}
for (let position = 0; position < packet.data.length;) {
  let size = 0;
  for (let index = 0; index < lengthSize; index++) size = size * 256 + packet.data[position++];
  if (!size || position + size > packet.data.length) throw new Error('Invalid synthetic H.264 NAL');
  nals.push(packet.data.slice(position, position + size)); position += size;
}
const keyframe = new Uint8Array(nals.reduce((total, nal) => total + 4 + nal.length, 0));
for (let index = 0, position = 0; index < nals.length; index++) {
  keyframe.set([0, 0, 0, 1], position); position += 4;
  keyframe.set(nals[index], position); position += nals[index].length;
}
input.dispose();

export async function createWorkerProbe(offscreen, clock) {
  const mode = offscreen ? 'offscreen' : 'transfer';
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90; document.body.append(canvas);
  const worker = new Worker('/play/decoder-worker.js', { type: 'module' });
  const presenter = offscreen ? null : createFramePresenter(canvas, { applyTimingPolicy: true });
  let controller, sequence = 0, lastStats = null, draws = 0, minSkew = Infinity, maxSkew = -Infinity;
  const errors = [], references = new Map();
  await new Promise((resolve, reject) => {
    worker.onerror = event => reject(new Error('Actual decoder worker startup: ' + event.message));
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') data.videoDecoder ? resolve() : reject(new Error('Actual worker has no VideoDecoder'));
    };
    setTimeout(() => reject(new Error('Actual decoder worker startup timed out')), 5000);
  });
  worker.onerror = event => errors.push(event.message);
  worker.onmessage = ({ data }) => {
    if (data.type === 'media-ready') worker.postMessage({ type: 'media-ready-ack', id: 1, token: data.token, plan: constantDelay(0) });
    else if (data.type === 'stats') lastStats = data.stats;
    else if (data.type === 'unsupported') errors.push(JSON.stringify(data));
    else if (data.type === 'frame') {
      try {
        const before = presenter.stats().renderDroppedFrames;
        presenter.present(data.frame, data.config, data.timing, data.outputWindow);
        if (presenter.stats().renderDroppedFrames === before && data.outputWindow) {
          const skew = data.outputWindow.audioAt - performance.timeOrigin - performance.now();
          minSkew = Math.min(minSkew, skew); maxSkew = Math.max(maxSkew, skew); draws++;
        }
      } finally { worker.postMessage({ type: 'frame-ack', frameId: data.frameId }); }
    }
  };
  if (offscreen) {
    const surface = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'canvas', canvas: surface }, [surface]);
  }
  worker.postMessage({ type: 'clock', clock });
  worker.postMessage({ type: 'delay', plan: constantDelay(0) });
  const stream = new ReadableStream({ start(value) { controller = value; } });
  worker.postMessage({ type: 'stream', id: 1, stream }, [stream]);
  controller.enqueue(encodeRecord({ kind: RECORD.CONFIG, epoch: 1, payload: new TextEncoder().encode(JSON.stringify({
    mode: 'carplay', codec: decoderConfig.codec, width: decoderConfig.codedWidth, height: decoderConfig.codedHeight, fps: 30,
  })) }));
  return {
    mode,
    audio(reference) {
      presenter?.audio(reference);
      worker.postMessage({ type: 'audio-output', reference });
      if (reference) references.set(`${reference.mode}:${reference.type}`, reference);
      else references.clear();
    },
    clock(value) { worker.postMessage({ type: 'clock', clock: value }); },
    frame(localTimeMs, rawSourceTimeMs) {
      const timestampUs = Math.round(localTimeMs * 1000), timing = new Uint8Array(8);
      new DataView(timing.buffer).setFloat64(0, rawSourceTimeMs, true);
      controller.enqueue(encodeRecord({ kind: RECORD.TIMING, epoch: 1, sequence, timestampUs, payload: timing }));
      controller.enqueue(encodeRecord({ kind: RECORD.FRAME, flags: FLAG.KEY, epoch: 1, sequence: sequence++, timestampUs, payload: keyframe }));
    },
    result() { return { mode, draws, minSkew, maxSkew, errors, stats: lastStats, presenter: presenter?.stats() }; },
    dispose() { try { controller.close(); } catch (_) {} worker.postMessage({ type: 'dispose' }); presenter?.dispose(); },
  };
}
