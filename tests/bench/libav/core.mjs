import { libavAudioParameters } from '../../../site/play/vendor/libav/libav.js';
// Same synchronous decode/resample workload for Node and browser Worker.
export function run(lib, fixture) {
  const f = fixture;
  const layout = f.channels === 1 ? 4 : 3;
  const [, context, packet, frame] = lib.ff_init_decoder(f.codec || 'aac', {
    codecpar: libavAudioParameters(f.rate, f.channels, f.asc),
    time_base: [1, f.rate],
  });
  let graph;
  try {
    const [filter, source, sink] = lib.ff_init_filter_graph('aresample=48000', {
      sample_rate: f.rate, sample_fmt: f.sampleFormat ?? 8, channel_layout: layout,
    }, { sample_rate: 48000, sample_fmt: f.outputFormat ?? 1, channel_layout: layout });
    graph = filter;
    const frameSize = f.frameSize || (f.codec === 'alac' ? 4096
      : f.name.includes('ELD') ? Number(f.name.split(' ').at(-1)) : 1024);
    const packets = Array.from({ length: 20 }, () => f.packets).flat().map((data, i) => ({
      data: new Uint8Array(data), pts: i * frameSize, ptshi: 0, dts: i * frameSize,
      dtshi: 0, time_base_num: 1, time_base_den: f.rate,
    }));
    const output = [], batches = [];
    const start = performance.now();
    for (const input of packets) {
      const before = performance.now();
      output.push(...lib.ff_decode_filter_multi(context, source, sink, packet, frame, [input], false));
      batches.push(performance.now() - before);
    }
    output.push(...lib.ff_decode_filter_multi(context, source, sink, packet, frame, [], true));
    const ms = performance.now() - start;
    const chunks = [];
    let samples = 0;
    for (const out of output) {
      for (const data of Array.isArray(out.data) ? out.data : [out.data]) {
        chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        samples += data.length;
      }
    }
    return { ms, batches, chunks, samples };
  } finally {
    if (graph) lib.avfilter_graph_free_js(graph);
    lib.ff_free_decoder(context, packet, frame);
  }
}
