/*! SPDX-License-Identifier: GPL-3.0-only */
import { readAudioRecords } from './audio-protocol.js';

/** Owns speaker/capture resources; capture exists only during an iPhone microphone demand. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {} }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, microphone = null, source = null, micDemand = null;
  let queuedBytes = 0, capacity = null, captureGeneration = 0, uploading = false, error = null;
  let microphoneAllowed = false, capturePending = false, microphoneQueue = [], droppedMicrophonePackets = 0;
  let retryTimer = null;
  let microphoneAbort = null;
  const snapshot = () => ({ supported: support, enabled, sound: context?.state === 'running', microphone: Boolean(microphone), micRequested: Boolean(micDemand?.active), droppedMicrophonePackets, error });
  const notify = () => onState(snapshot());
  const auth = () => { const { code, session } = credentials(); return `c=${encodeURIComponent(code)}&s=${encodeURIComponent(session)}`; };
  function stopMicrophone() {
    captureGeneration++;
    microphoneAbort?.abort(); microphoneAbort = null;
    microphoneQueue = []; capturePending = false;
    microphone?.getTracks().forEach(track => track.stop());
    microphone = null; source?.disconnect(); source = null;
    node?.port.postMessage({ captureRate: 0 });
  }
  function uploadMicrophone() {
    if (uploading || microphoneQueue.length < 2 || !microphone || !connection || connection.aborted) return;
    uploading = true;
    const packets = microphoneQueue.splice(0, 4);
    const bytes = new Uint8Array(packets.reduce((sum, packet) => sum + packet.byteLength, 0));
    let offset = 0;
    for (const packet of packets) { bytes.set(new Uint8Array(packet), offset); offset += packet.byteLength; }
    const generation = captureGeneration, currentConnection = connection;
    const abort = microphoneAbort = new AbortController(), stop = () => abort.abort();
    currentConnection.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, 1000);
    fetchPhone(`/microphone?${auth()}`, { method: 'POST', body: bytes, signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error(`Microphone HTTP ${response.status}`); })
      .catch(failure => { if (generation === captureGeneration && !abort.signal.aborted) { error = failure.message; stopMicrophone(); notify(); } })
      .finally(() => { if (microphoneAbort === abort) microphoneAbort = null; uploading = false; clearTimeout(timer); currentConnection.removeEventListener('abort', stop); uploadMicrophone(); });
  }
  function stopStream() {
    clearTimeout(retryTimer); retryTimer = null;
    request?.abort(); request = null;
    node?.port.postMessage({ reset: true });
    queuedBytes = 0; capacity?.(); capacity = null;
  }
  async function stream(signal) {
    stopStream();
    if (!support || !enabled || !node || context.state !== 'running' || !signal || signal.aborted) return;
    const abort = request = new AbortController();
    const stop = () => abort.abort();
    signal.addEventListener('abort', stop, { once: true });
    try {
      const response = await fetchPhone(`/audio?${auth()}`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
      error = null;
      for await (const record of readAudioRecords(response.body)) {
        if (abort.signal.aborted) break;
        // At most roughly one second of stereo PCM ahead; TCP reads inherit this credit.
        while (queuedBytes >= record.rate * record.channels * 2 && !abort.signal.aborted) {
          await new Promise(resolve => { capacity = resolve; });
        }
        if (abort.signal.aborted) break;
        queuedBytes += record.pcm.byteLength;
        node.port.postMessage(record, [record.pcm]);
      }
    } catch (failure) {
      if (!abort.signal.aborted) { error = String(failure.message); notify(); }
    } finally {
      signal.removeEventListener('abort', stop);
      if (request === abort) {
        request = null; node?.port.postMessage({ reset: true }); queuedBytes = 0;
        if (!abort.signal.aborted && connection === signal && enabled) retryTimer = setTimeout(() => stream(signal), 1000);
      }
    }
  }
  async function activate() {
    error = null;
    try {
      // Creating/resuming the context happens before awaiting, preserving user activation.
      context ??= new AudioContext({ latencyHint: 'interactive' });
      const resumed = context.resume();
      ready ??= context.audioWorklet.addModule(new URL('audio-worklet.js', import.meta.url)).then(() => {
        node = new AudioWorkletNode(context, 'tiplay-audio', { outputChannelCount: [2], channelCount: 1 });
        node.connect(context.destination);
        node.port.onmessage = ({ data }) => {
          if (data.consumed) {
            queuedBytes = Math.max(0, queuedBytes - data.consumed); capacity?.(); capacity = null;
          }
          if (!data.microphone || !microphone || !connection || connection.aborted) return;
          if (microphoneQueue.length >= 5) { microphoneQueue.shift(); droppedMicrophonePackets++; }
          microphoneQueue.push(data.microphone); uploadMicrophone();
        };
      });
      await Promise.all([resumed, ready]);
      stream(connection); notify();
    } catch (failure) { error = failure.message; notify(); }
  }
  async function activateMicrophone() {
    if (!micDemand?.active || !node || microphone || capturePending || !connection || connection.aborted) return;
    const generation = ++captureGeneration;
    capturePending = true;
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (generation !== captureGeneration || !micDemand?.active || connection.aborted) {
        captured.getTracks().forEach(track => track.stop()); return;
      }
      microphone = captured;
      microphoneAllowed = true;
      source = context.createMediaStreamSource(captured); source.connect(node);
      node.port.postMessage({ captureRate: micDemand.sampleRate });
      error = null; notify();
    } catch (failure) { error = failure.message; notify(); }
    finally { if (generation === captureGeneration) capturePending = false; }
  }
  return {
    activate, activateMicrophone, stats: snapshot,
    attach(signal, hello) {
      this.stop(); connection = signal; support = hello.audio === true;
      signal.addEventListener('abort', () => { if (connection === signal) this.stop(); }, { once: true });
      stream(signal); notify();
    },
    status(status) {
      const changed = enabled !== (status.audio !== false);
      enabled = status.audio !== false;
      const rawDemand = status.mic;
      const demand = rawDemand && Number.isInteger(rawDemand.sampleRate) && rawDemand.sampleRate >= 8000 && rawDemand.sampleRate <= 48000 ? rawDemand : null;
      if (!demand?.active || demand.sampleRate !== micDemand?.sampleRate) stopMicrophone();
      micDemand = demand;
      if (!enabled) { stopStream(); stopMicrophone(); }
      else if (changed) stream(connection);
      if (enabled && microphoneAllowed && micDemand?.active) activateMicrophone();
      notify();
    },
    stop() { connection = null; stopStream(); stopMicrophone(); micDemand = null; notify(); },
    dispose() { this.stop(); context?.close().catch(() => {}); context = null; ready = null; node = null; },
  };
}
