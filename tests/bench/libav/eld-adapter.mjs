// SPDX-License-Identifier: GPL-3.0-only
import { createLibav, libavAudioParameters } from '../../../site/play/vendor/libav/libav.js';

import { eldSimdPreferred } from '../../../site/play/vendor/libav/libav.js';
/** Raw AAC-ELD, one runtime per epoch. Other profiles use portable WASM. */
export async function createEldDecoder({ sampleRate = 44100, channels = 2, frameLength = 480, sbr = false, simd = eldSimdPreferred(sampleRate, channels, frameLength) } = {}) {
  if (sbr || ![44100, 48000].includes(sampleRate) || ![1, 2].includes(channels) || ![480, 512].includes(frameLength))
    throw new RangeError('Unsupported AAC-ELD profile.');
  const description = Uint8Array.of(0xf8, sampleRate === 44100 ? 0xe8 : 0xe6,
    (channels << 5) | (frameLength === 480 ? 0x10 : 0), 0);
  let { instance: lib, backend } = await createLibav({ simd });
  let decoder, graph, source, sink, sequence = 0, closed = false;
  try {
    decoder = lib.ff_init_decoder('aac', { codecpar: libavAudioParameters(sampleRate, channels, description),
      time_base: [1, sampleRate] });
    [graph, source, sink] = lib.ff_init_filter_graph('aformat=sample_fmts=s16', {
      sample_rate: sampleRate, sample_fmt: 8, channel_layout: channels === 1 ? 4 : 3,
    }, { sample_rate: sampleRate, sample_fmt: 1, channel_layout: channels === 1 ? 4 : 3 });
  } catch (cause) {
    if (decoder) lib.ff_free_decoder(...decoder.slice(1));
    if (graph) lib.avfilter_graph_free_js(graph);
    throw cause;
  }
  return {
    sampleRate, channels, frameLength, backend,
    decode(packet) {
      if (closed) throw Error('ELD decoder is closed.');
      const data = packet instanceof ArrayBuffer ? new Uint8Array(packet) : packet;
      if (!(data instanceof Uint8Array)) throw new TypeError('Expected one raw ELD access unit.');
      if (data.byteLength < 1 || data.byteLength > 8192) throw new RangeError('ELD packet must contain 1..8192 bytes.');
      const pts = sequence++ * frameLength;
      const [, context, input, frame] = decoder;
      const outputs = lib.ff_decode_filter_multi(context, source, sink, input, frame,
        [{ data, pts: pts >>> 0, ptshi: Math.floor(pts / 4294967296),
          dts: pts >>> 0, dtshi: Math.floor(pts / 4294967296) }], false);
      if (outputs.length !== 1 || !(outputs[0].data instanceof Int16Array)
        || outputs[0].data.length !== frameLength * channels) throw Error('Invalid AAC-ELD PCM output.');
      const pcm = outputs[0].data;
      return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length); // Owned libav copy-out, without transfer metadata.
    },
    close() {
      if (closed) return;
      closed = true;
      lib.ff_free_decoder(...decoder.slice(1)); lib.avfilter_graph_free_js(graph);
      lib = null; decoder = null;
    },
  };
}
