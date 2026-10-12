/*! SPDX-License-Identifier: GPL-3.0-only
 * TiPlay decoder worker. Native streams keep their backpressure; fallback feeds use a pull-credit MessagePort.
 * Transferred frames require a main-thread acknowledgement before the next one is sent. */
import { createDecoderPipeline, createFramePresenter } from './video.js';
import { createChunkStream, createFrameDelivery } from './transport.js';

let presenter = null, timer = null, activeId = null;
const delivery = createFrameDelivery(message => self.postMessage({ type: 'frame', ...message }, [message.frame]));
const pipeline = typeof VideoDecoder === 'function' ? createDecoderPipeline({
  post: message => {
    if (message.type === 'end') stop();
    if (message.type === 'idle') {
      presenter?.close();
      delivery.stop();
    }
    self.postMessage(message);
  },
  present: (frame, config, id, timing) => {
    if (id !== activeId) frame.close();
    else if (presenter) presenter.present(frame, config, timing);
    else delivery.present(frame, config, id, timing);
  },
}) : null;

function stop() {
  activeId = null;
  pipeline?.stop();
  presenter?.close();
  delivery.stop();
  clearInterval(timer);
  timer = null;
}

self.onmessage = ({ data }) => {
  if (data.type === 'clock') pipeline?.clock(data.clock);
  else if (data.type === 'canvas') presenter = createFramePresenter(data.canvas);
  else if (data.type === 'resize') presenter?.resize(data.width, data.height);
  else if (data.type === 'stream' || data.type === 'feed') {
    stop();
    activeId = data.id;
    pipeline?.read(data.id, data.type === 'stream' ? data.stream : createChunkStream(data.port));
    timer = setInterval(() => {
      if (pipeline) self.postMessage({ type: 'stats', id: activeId, stats: { ...pipeline.stats(), ...presenter?.stats() } });
    }, 1000);
  } else if (data.type === 'frame-ack') delivery.acknowledge(data.frameId);
  else if (data.type === 'stop') stop();
  else if (data.type === 'dispose') {
    stop();
    presenter?.dispose();
    self.close();
  }
};
self.postMessage({ type: 'ready', videoDecoder: Boolean(pipeline) });
