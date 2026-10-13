/*! SPDX-License-Identifier: GPL-3.0-only */
import { presentationTime } from './clock-sync.js';
import { readAudioRecords } from './audio-protocol.js';
import { initialPlaybackPlans } from './playback-window.js';

const MAX_AUDIO_AHEAD_BYTES = 1024 * 1024;

/** Owns speaker/capture resources; capture exists only during an iPhone microphone demand. */
export function createBrowserAudio({ fetchPhone, credentials, onState = () => {}, onTiming = () => {}, onQueued = () => {}, onMode = () => {} }) {
  let context = null, node = null, ready = null, connection = null, request = null;
  let support = false, enabled = true, microphone = null, source = null, micDemand = null;
  let queuedBytes = 0, capacity = null, captureGeneration = 0, uploading = false, error = null;
  let permissionPending = null, capturePending = false, microphoneQueue = [], droppedMicrophonePackets = 0;
  let retryTimer = null;
  let clock = null, delayPlans = initialPlaybackPlans(), timedPackets = 0, fallbackPackets = 0;
  let clockBase = null, playbackGeneration = 0;
  let microphoneAbort = null;
  let capturedMicrophonePackets = 0, uploadedMicrophonePackets = 0, rejectedMicrophoneUploads = 0, microphonePeak = 0;
  const snapshot = () => ({ supported: support, enabled, sound: context?.state === 'running', microphone: Boolean(microphone), micRequested: Boolean(micDemand?.active), droppedMicrophonePackets, capturedMicrophonePackets, uploadedMicrophonePackets, rejectedMicrophoneUploads, microphonePeak, error, timedPackets, fallbackPackets, queuedBytes });
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
      .then(async response => {
        if (!response.ok) {
          rejectedMicrophoneUploads++;
          // Siri can finish before its inactive status reaches the browser.
          // A final in-flight packet then receives this normal teardown reply.
          if (response.status === 409 && (await response.json().catch(() => null))?.error === 'microphone-inactive') {
            if (generation === captureGeneration) { error = null; stopMicrophone(); notify(); }
            return;
          }
          throw new Error(`Microphone HTTP ${response.status}`);
        }
        uploadedMicrophonePackets += packets.length;
      })
      .catch(failure => { if (generation === captureGeneration && !abort.signal.aborted) { error = failure.message; stopMicrophone(); notify(); } })
      .finally(() => { if (microphoneAbort === abort) microphoneAbort = null; uploading = false; clearTimeout(timer); currentConnection.removeEventListener('abort', stop); uploadMicrophone(); });
  }
  function stopStream() {
    playbackGeneration++; clockBase = null;
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
        // Read through the producer's two-second music lead so the same HTTP stream
        // can deliver a following navigation/call packet without waiting for music.
        while ((record.flags & 1) && queuedBytes >= MAX_AUDIO_AHEAD_BYTES && !abort.signal.aborted) {
          await new Promise(resolve => { capacity = resolve; });
        }
        if (abort.signal.aborted) break;
        if (record.pcm.byteLength) onMode(record.mode);
        record.sourceTime = presentationTime(record.presentationMs, clock);
        const hasPcm = record.pcm.byteLength > 0;
        if (hasPcm) {
          if (Number.isFinite(record.sourceTime)) { timedPackets++; onTiming(record.sourceTime); }
          else fallbackPackets++;
        }
        clockBase ??= performance.timeOrigin + performance.now() - context.currentTime * 1000;
        node.port.postMessage({ plans: delayPlans, clockBase });
        record.generation = playbackGeneration;
        queuedBytes += record.pcm.byteLength;
        node.port.postMessage(record, [record.pcm]);
        if (hasPcm) onQueued();
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
          if (data.consumed && data.generation === playbackGeneration) {
            queuedBytes = Math.max(0, queuedBytes - data.consumed); capacity?.(); capacity = null;
          }
          if (!data.microphone || !microphone || !connection || connection.aborted) return;
          capturedMicrophonePackets++;
          microphonePeak = data.peak ?? 0;
          if (microphoneQueue.length >= 5) { microphoneQueue.shift(); droppedMicrophonePackets++; }
          microphoneQueue.push(data.microphone); uploadMicrophone();
        };
      });
      // Autoplay may keep resume pending until the first gesture; loading the worklet
      // and requesting microphone permission must not wait for that gesture.
      resumed.then(() => { stream(connection); notify(); }).catch(failure => { error = failure.message; notify(); });
      await ready;
      await activateMicrophone();
      notify();
    } catch (failure) { error = failure.message; notify(); }
  }
  async function activateMicrophone() {
    if (!enabled || !micDemand?.active || !node || microphone || capturePending || !connection || connection.aborted) return;
    const generation = ++captureGeneration;
    capturePending = true;
    try {
      // Wait for the startup permission probe rather than opening a second prompt.
      if (permissionPending) await permissionPending;
      if (generation !== captureGeneration || !micDemand?.active || !connection || connection.aborted) return;
      const captured = await navigator.mediaDevices.getUserMedia(captureConstraints);
      if (generation !== captureGeneration || !micDemand?.active || connection.aborted) {
        captured.getTracks().forEach(track => track.stop()); return;
      }
      microphone = captured;
      source = context.createMediaStreamSource(captured); source.connect(node);
      node.port.postMessage({ captureRate: micDemand.sampleRate });
      error = null; notify();
    } catch (failure) { error = failure.message; notify(); }
    finally { if (generation === captureGeneration) capturePending = false; }
  }
  const captureConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
  function requestPermission() {
    if (permissionPending) return permissionPending;
    // Ask on page open, but do not leave a recording indicator on while Siri/calls
    // are idle. Demand reopens the capture device using the granted permission.
    permissionPending = Promise.resolve().then(() => navigator.mediaDevices.getUserMedia(captureConstraints))
      .then(captured => { captured.getTracks().forEach(track => track.stop()); })
      .catch(failure => { error = failure.message; notify(); })
      .finally(() => { permissionPending = null; });
    return permissionPending;
  }
  return {
    activate, activateMicrophone, stats: snapshot,
    clock(value) { clock = value; },
    delay(value) { delayPlans = value; node?.port.postMessage({ plans: delayPlans }); },
    reset() { playbackGeneration++; clockBase = null; queuedBytes = 0; node?.port.postMessage({ reset: true }); capacity?.(); capacity = null; },
    start() { requestPermission(); activate(); },
    gesture() { if (context?.state !== 'running') activate(); },
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
      const newDemand = demand?.active && (!micDemand?.active || demand.sampleRate !== micDemand?.sampleRate);
      if (!demand?.active || demand.sampleRate !== micDemand?.sampleRate) stopMicrophone();
      micDemand = demand;
      if (!enabled) { stopStream(); stopMicrophone(); }
      else if (changed) stream(connection);
      // Retry permission on a new iPhone demand, never on each status heartbeat.
      if (enabled && (newDemand || changed) && micDemand?.active) activateMicrophone();
      notify();
    },
    stop() { connection = null; stopStream(); stopMicrophone(); micDemand = null; notify(); },
    dispose() { this.stop(); context?.close().catch(() => {}); context = null; ready = null; node = null; },
  };
}
