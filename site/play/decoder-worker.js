/*! SPDX-License-Identifier: GPL-3.0-only
 * Native WebRTC video -> MediaStreamTrackProcessor -> Canvas. The reliable
 * video DataChannel carries lifecycle metadata only, never compressed frames. */
import { createFramePresenter } from './video.js';
import { createChunkStream, createFrameDelivery } from './transport.js';
import { createRtcTrackReader, createRtcVideoPipeline } from './rtc-video.js';

let presenter = null, timer = null, activeId = null, generation = 1;
const delivery = createFrameDelivery(message => self.postMessage({ type: 'frame', ...message }, [message.frame]));
const pipeline = createRtcVideoPipeline({
  post: message => {
    if (message.type === 'video-error' || message.type === 'idle' || message.type === 'config') {
      presenter?.close(); delivery.stop();
    }
    if (message.type === 'video-error') trackReader.stop();
    self.postMessage(message);
  },
  present: (frame, config, id) => {
    if (id !== activeId || config.videoGeneration !== generation) frame.close();
    else if (presenter) presenter.present(frame, config, null);
    else delivery.present(frame, config, id, null);
  },
});
const trackReader = createRtcTrackReader({
  present: frame => pipeline.trackFrame(frame, generation),
  onError: () => pipeline.fail('rtc-video-track-ended'),
});
function stop() {
  activeId = null; generation = 1; trackReader.stop(); pipeline.stop();
  clearInterval(timer); timer = null; presenter?.close(); delivery.stop();
}
self.onmessage = ({ data }) => {
  if (data.type === 'canvas') presenter = createFramePresenter(data.canvas, {
    onFirstPresent: config => {
      pipeline.presented(config);
      self.postMessage({ type: 'decoded', id: config.streamId, epoch: config.epoch, videoGeneration: config.videoGeneration });
    },
  });
  else if (data.type === 'resize') presenter?.resize(data.width, data.height);
  else if (data.type === 'stream' || data.type === 'feed') {
    stop(); activeId = data.id;
    pipeline.read(data.id, data.type === 'stream' ? data.stream : createChunkStream(data.port));
    timer = setInterval(() => self.postMessage({ type: 'stats', id: activeId,
      stats: { ...pipeline.stats(), ...(!presenter ? delivery.stats() : {}), ...presenter?.stats() } }), 1000);
  } else if (data.type === 'video-generation' && data.id === activeId) {
    trackReader.stop(); delivery.stop(); presenter?.close();
    pipeline.resetGeneration(data.generation); generation = data.generation;
    self.postMessage({ type: 'video-generation-ready', id: activeId, generation });
  } else if (data.type === 'video-error' && data.id === activeId) pipeline.fail(data.reason);
  else if (data.type === 'video-presented' && data.id === activeId && data.generation === generation)
    pipeline.presented({ streamId: data.id, epoch: data.epoch, videoGeneration: data.generation });
  else if (data.type === 'frame-ack') delivery.acknowledge(data.frameId);
  else if (data.type === 'rtc-track') {
    if (data.id === activeId && data.generation === generation)
      trackReader.read(data.track).catch(() => pipeline.fail('rtc-video-processor-unavailable'));
    else data.track.stop();
  } else if (data.type === 'rtc-frame') {
    try { if (data.id === activeId) pipeline.trackFrame(data.frame, data.generation); else data.frame.close(); }
    finally { self.postMessage({ type: 'rtc-frame-ack', frameId: data.frameId }); }
  } else if (data.type === 'stop') stop();
  else if (data.type === 'dispose') { stop(); presenter?.dispose(); self.close(); }
};
self.postMessage({ type: 'ready', trackProcessor: typeof MediaStreamTrackProcessor === 'function' });
