// SPDX-License-Identifier: GPL-3.0-only
import { createEmbeddedCaptionParser } from '../captions/parser.js';

// Caption packets retain source timestamps. AVPlayer's own subtitle renderer
// decides when a display-state update becomes visible.
const MAX_PENDING = 128, MAX_EVENTS = 1024, MAX_TEXT = 8192, MAX_TOTAL_TEXT = 262144, MAX_TRIPLES = 16384;
const serviceId = service => /^CC[1-4]$/.test(service) ? `cea608-${service.slice(2)}`
  : /^SERVICE(?:[1-9]|[1-5][0-9]|6[0-3])$/.test(service) ? `cea708-${service.slice(7)}` : null;

export function createEmbeddedCaptionBridge(player, { Channel = globalThis.BroadcastChannel,
  parserFactory = createEmbeddedCaptionParser } = {}) {
  let token = '', loaded = false, disposed = false, enabled = false, selected = null, renderer = null, creating = null;
  let revision = 0, generation = 0, streamKey = null, epoch = -1, requiredEpoch = -1, watermark = -Infinity, failure = null, seeking = false, seekSerial = 0;
  const pending = [], reorder = [], services = new Map();
  const channel = typeof Channel === 'function' ? new Channel(`tiplay-captions-${crypto.randomUUID()}`) : null;
  const parser = parserFactory({ onUpdate(update) {
    const id = serviceId(update.service);
    if (!id || !Number.isFinite(update.time) || typeof update.text !== 'string' || update.text.length > MAX_TEXT) return;
    let service = services.get(id);
    if (!service) {
      service = { id, label: update.service.startsWith('CC') ? update.service : `Service ${update.service.slice(7)}`, events: [] };
      services.set(id, service);
      if (loaded) player.fire('streamUpdate');
    }
    const event = { time: update.time, text: update.text };
    const last = service.events.at(-1);
    if (last?.time === event.time) service.events[service.events.length - 1] = event;
    else service.events.push(event);
    prune(service.events);
    let eventCount = 0, textCount = 0;
    for (const value of services.values()) for (const event of value.events) { eventCount++; textCount += event.text.length; }
    if (eventCount > MAX_EVENTS || textCount > MAX_TOTAL_TEXT) { failure = 'caption-buffer-overflow'; resetEpoch(); return; }
    if (selected === id && renderer && enabled) renderer.__tiplayPushEmbedded(event);
  } });

  function prune(events) {
    const current = Number(player.currentTime) / 1000;
    let keep = 0;
    while (keep + 1 < events.length && events[keep + 1].time <= current) keep++;
    if (keep) events.splice(0, keep);
  }
  function resetEpoch() {
    parser.reset(); reorder.length = 0; watermark = -Infinity;
    for (const service of services.values()) service.events.length = 0;
    renderer?.reset();
  }
  function retireRenderer() { generation++; renderer?.destroy(); renderer = null; creating = null; }
  function selectedStream(message) {
    const stream = player.selectedVideoStream;
    const task = player.subTaskId || player.taskId;
    return stream && message.task === task && message.stream === stream.index;
  }
  function consume(message) {
    if (!selectedStream(message)) return;
    const key = `${message.task}:${message.stream}`;
    if (streamKey !== key) {
      resetEpoch(); services.clear(); selected = null; enabled = false; retireRenderer();
      streamKey = key; epoch = -1;
      if (loaded) player.fire('streamUpdate');
    }
    if (!Number.isSafeInteger(message.epoch) || message.epoch < epoch) return;
    if (message.epoch < requiredEpoch) return;
    if (message.epoch > epoch) { resetEpoch(); epoch = message.epoch; }
    if (message.kind === 'reset') return;
    if (message.kind === 'end') { flush(Infinity); return; }
    if (message.kind !== 'packet' || !Number.isFinite(message.pts) || !Number.isFinite(message.dts)
      || Math.abs(message.pts) > 1e10 || Math.abs(message.dts) > 1e10 || !Array.isArray(message.triples)
      || message.triples.length > 4096) return;
    const triples = message.triples;
    if (triples.some(t => !t || !Number.isInteger(t.type) || t.type < 0 || t.type > 3
      || !Number.isInteger(t.a) || t.a < 0 || t.a > 255 || !Number.isInteger(t.b) || t.b < 0 || t.b > 255)) return;
    if (message.dts < watermark) { resetEpoch(); }
    watermark = message.dts;
    if (triples.length) {
      reorder.push({ pts: message.pts, triples });
      reorder.sort((a, b) => a.pts - b.pts);
      if (reorder.length > MAX_PENDING || reorder.reduce((sum, value) => sum + value.triples.length, 0) > MAX_TRIPLES) {
        failure = 'caption-buffer-overflow'; resetEpoch(); return;
      }
    }
    flush(watermark);
  }
  function flush(before) {
    while (reorder.length && reorder[0].pts <= before) {
      const sample = reorder.shift();
      parser.pushTriples(sample.triples.map(t => ({ ...t, time: sample.pts })));
    }
  }
  function onMessage({ data }) {
    if (disposed || !data || data.token !== token) return;
    if (Number.isSafeInteger(data.sequence) && ['packet', 'reset', 'end'].includes(data.kind))
      channel?.postMessage({ kind: 'ack', token, task: data.task, sequence: data.sequence });
    if (!loaded) {
      if (!Array.isArray(data.triples) && data.kind === 'packet') return;
      if ((data.triples?.length || 0) + pending.reduce((sum, value) => sum + (value.triples?.length || 0), 0) > MAX_TRIPLES) {
        failure = 'caption-buffer-overflow'; pending.length = 0; return;
      }
      if (pending.length === MAX_PENDING) pending.shift();
      pending.push(data); return;
    }
    try { consume(data); } catch (_) { failure = 'caption-parser-failed'; resetEpoch(); }
  }
  if (channel) channel.onmessage = onMessage;

  return {
    options() {
      token = crypto.randomUUID(); loaded = false; revision++; seekSerial++; seeking = false; pending.length = 0;
      resetEpoch(); services.clear(); selected = null; enabled = false; streamKey = null; epoch = requiredEpoch = -1; failure = null; retireRenderer();
      return channel ? { __tiplayCaptionChannel: channel.name, __tiplayCaptionToken: token } : {};
    },
    loaded() { if (disposed) return; loaded = true; for (const message of pending.splice(0)) onMessage({ data: message }); },
    list() { return [...services.values()].map(({ id, label }) => ({ id, label, language: '' })); },
    diagnostics() { return { services: services.size, failure }; },
    async select(id) {
      if (disposed || !services.has(id)) throw new DOMException('Embedded caption service is unavailable.', 'NotFoundError');
      const ownRevision = ++revision;
      selected = id; enabled = true;
      player.__tiplaySetNativeSubtitleEnable(false);
      if (!renderer) {
        if (!creating) {
          const ownGeneration = generation;
          const pending = Promise.resolve().then(() => player.__tiplayCreateEmbeddedSubtitleRender()).then(value => {
            if (disposed || ownGeneration !== generation) { value.destroy(); return null; }
            renderer = value; return value;
          });
          creating = pending;
          void pending.finally(() => { if (creating === pending) creating = null; }).catch(() => {});
        }
        try { await creating; }
        catch (_) { if (ownRevision === revision) { failure = 'caption-renderer-failed'; selected = null; enabled = false; } return false; }
        if (disposed || ownRevision !== revision || !renderer) return false;
      }
      const service = services.get(id); prune(service.events);
      renderer.__tiplaySetEmbedded(service.events);
      if (!seeking) { if (player.getStatus() === 6) renderer.start(); renderer.__tiplayTickEmbedded(); }
      return true;
    },
    enable(value) {
      if (enabled !== Boolean(value)) revision++;
      enabled = Boolean(value);
      if (!selected) return false;
      if (enabled && renderer) {
        const service = services.get(selected);
        if (service) { prune(service.events); renderer.__tiplaySetEmbedded(service.events); }
        if (!seeking) { if (player.getStatus() === 6) renderer.start(); renderer.__tiplayTickEmbedded(); }
      } else renderer?.stop();
      return true;
    },
    native() { revision++; selected = null; enabled = false; renderer?.stop(); },
    pause() { renderer?.pause(); },
    resume() { if (!seeking && enabled && selected && player.getStatus() === 6) renderer?.start(); },
    seek() { const ticket = ++seekSerial; seeking = true; requiredEpoch = Math.max(requiredEpoch, epoch, 0) + 1; renderer?.pause(); resetEpoch(); return ticket; },
    finishSeek(ticket, failed = false) { if (ticket !== seekSerial) return; seeking = false; if (failed) { requiredEpoch = epoch; resetEpoch(); } this.resume(); },
    ended() { resetEpoch(); renderer?.pause(); },
    videoChange() { revision++; seekSerial++; seeking = false; resetEpoch(); services.clear(); selected = null; enabled = false; streamKey = null; epoch = requiredEpoch = -1; retireRenderer(); },
    videoSelected() { const stream = player.selectedVideoStream; if (streamKey && streamKey !== `${player.subTaskId || player.taskId}:${stream?.index}`) this.videoChange(); },
    stop() { token = ''; loaded = false; revision++; seekSerial++; seeking = false; pending.length = 0; resetEpoch(); services.clear(); selected = null; enabled = false; retireRenderer(); },
    destroy() { if (disposed) return; this.stop(); disposed = true; channel?.close(); },
  };
}
