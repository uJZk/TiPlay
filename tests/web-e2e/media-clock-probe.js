// SPDX-License-Identifier: GPL-3.0-only
import { createBrowserAudio } from '/play/audio.js';
import { createFramePresenter } from '/play/video.js';
import { createTimedFrames } from '/play/media-timing.js';
import { constantDelay } from '/play/delay-plan.js';
import { createWorkerProbe } from '/e2e/media-clock-worker-probe.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = message => { throw new Error(message); };
globalThis.__audioProbeReady = true;

globalThis.startAudioProbe = async () => {
  let audio, videoTimer, controlTimer, frames, presenter;
  const abort = new AbortController(), nativeContext = globalThis.AudioContext, contexts = [], violations = [];
  addEventListener('securitypolicyviolation', event => violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
  globalThis.AudioContext = class extends nativeContext {
    constructor(...args) { super(...args); contexts.push(this); }
  };
  const packetTimers = new Set(), states = [], reports = [], draws = [], workerProbes = [];
  let epoch = 0, diagnosticPeak = 0, diagnosticNonzero = 0, audioErrors = [], sourceOrigin, localOrigin;
  let rate = 1.00015, sequence = 0, lastReference = null, debugEnabled = false, referencesWithoutDebug = 0;
  try {
    sourceOrigin = 1000000000; localOrigin = performance.now();
    const rawSourceAt = local => sourceOrigin + (local - localOrigin) / rate;
    function packet(localPresentation, type, mode, epoch, packetSequence) {
      const count = 960, channels = 2, bytes = new Uint8Array(28 + count * channels * 2), view = new DataView(bytes.buffer);
      view.setUint32(0, bytes.length - 4); bytes[4] = 2; bytes[5] = type; bytes[6] = channels; bytes[7] = mode << 2;
      view.setUint32(8, 48000); view.setUint32(12, packetSequence); view.setUint32(16, epoch);
      view.setFloat64(20, rawSourceAt(localPresentation));
      for (let i = 0; i < count; i++) {
        const time = (localPresentation - localOrigin) / 1000 + i / 48000;
        for (let channel = 0; channel < channels; channel++) {
          const value = Math.sin(2 * Math.PI * (type === 0 ? 440 : 660) * time + channel * .2) * .16
            + Math.sin(2 * Math.PI * 2300 * time) * .03;
          view.setInt16(28 + (i * channels + channel) * 2, Math.round(value * 32767), true);
        }
      }
      return bytes;
    }
    const canvas = document.getElementById('picture'), input = document.createElement('canvas');
    input.width = 160; input.height = 90;
    const painter = input.getContext('2d');
    presenter = createFramePresenter(canvas, { applyTimingPolicy: true });
    frames = createTimedFrames((frame, config, id, timing, outputWindow) => {
      const before = presenter.stats().renderDroppedFrames;
      presenter.present(frame, config, timing, outputWindow);
      if (presenter.stats().renderDroppedFrames === before && outputWindow) {
        const at = performance.timeOrigin + performance.now();
        draws.push({ skew: outputWindow.audioAt - at, sourceDelay: at - timing });
      }
    });
    frames.delay(constantDelay(0));
    audio = createBrowserAudio({
      credentials: () => ({ code: '0000', session: 'synthetic-local-only' }),
      onState(state) {
        if (state.error) audioErrors.push(state.error);
        if (state.debug) {
          diagnosticPeak = Math.max(diagnosticPeak, state.debug.renderPeak || 0);
          diagnosticNonzero = Math.max(diagnosticNonzero, state.debug.renderNonzero || 0);
        }
      },
      onAudioReference(reference) {
        presenter.audio(reference); frames.audio(reference);
        for (const probe of workerProbes) probe.audio(reference);
        if (reference) {
          states.push({ mode: reference.mode, state: reference.state, at: performance.now() });
          if (reference.state === 'playing') {
            if (!debugEnabled) referencesWithoutDebug++;
            reports.push({ mode: reference.mode, method: reference.outputMethod, latencyMs: reference.outputLatencyMs,
              filterDelayMs: reference.filterDelayMs, uncertaintyMs: reference.uncertaintyMs,
              source: reference.sourceTimeMs, rate: reference.mediaRate });
            if (reference.mode === 'carplay') lastReference = reference;
          }
        }
      },
      fetchPhone: async (url, options) => {
        if (!url.startsWith('/audio?')) fail('Unexpected phone request');
        let timer, presentation = performance.now() + 400;
        const streamEpoch = ++epoch;
        return new Response(new ReadableStream({
          start(controller) {
            const emit = () => {
              try {
                // Both producers remain independent and audible in the same node.
                while (presentation < performance.now() + 420) {
                  controller.enqueue(packet(presentation, 0, 0, streamEpoch, ++sequence));
                  controller.enqueue(packet(presentation, 6, 1, streamEpoch + 100, sequence));
                  presentation += 20 * rate;
                }
              } catch (_) { clearInterval(timer); packetTimers.delete(timer); }
            };
            emit(); timer = setInterval(emit, 20); packetTimers.add(timer);
            options.signal.addEventListener('abort', () => {
              clearInterval(timer); packetTimers.delete(timer);
              try { controller.close(); } catch (_) {}
            }, { once: true });
          },
          cancel() { clearInterval(timer); packetTimers.delete(timer); },
        }));
      },
    });
    const clock = () => ({ version: 2, generation: 1, serverOriginMs: sourceOrigin,
      localOriginMs: performance.timeOrigin + localOrigin, rate, at: performance.timeOrigin + performance.now(),
      offset: performance.timeOrigin + localOrigin - sourceOrigin, rtt: .1,
      uncertaintyMs: .05, offsetConfidence: 1, rateConfidence: 1, state: 'tracking' });
    audio.status({ audio: true, debug: false });
    audio.clock(clock());
    audio.delay({ video: constantDelay(0), audio: constantDelay(60) }, 'carplay');
    audio.delay({ video: constantDelay(60), audio: constantDelay(60) }, 'airplay-mirror');
    audio.attach(abort.signal, { audio: true });
    // The runner clicks the page's button. No autoplay override or CSP
    // relaxation is passed to the browser.
    audio.start();
    workerProbes.push(await createWorkerProbe(false, clock()));
    workerProbes.push(await createWorkerProbe(true, clock()));
    controlTimer = setInterval(() => { const value = clock(); audio.clock(value); for (const probe of workerProbes) probe.clock(value); }, 100);
    videoTimer = setInterval(() => {
      // The desktop H.264 decoder may retain several frames. Deliver future
      // producer anchors early enough to exercise scheduling inside the same cap.
      const local = performance.now() + 200;
      painter.fillStyle = '#2366bb'; painter.fillRect(0, 0, 160, 90);
      painter.fillStyle = '#ee9922'; painter.fillRect(sequence % 120, 20, 20, 50);
      const frame = new VideoFrame(input, { timestamp: Math.round(local * 1000) });
      frames.present(frame, { mode: 'carplay', epoch: 1, width: 160, height: 90 }, 1,
        performance.timeOrigin + local, { sourceTimeMs: rawSourceAt(local), clockGeneration: 1 });
      for (const probe of workerProbes) probe.frame(local, rawSourceAt(local));
    }, 1000 / 30);
    await sleep(2000);
    if (referencesWithoutDebug < 20) fail('Missing production playout references: ' + JSON.stringify(audio.stats()));
    debugEnabled = true;
    audio.status({ audio: true, debug: true });
    await sleep(1500);
    const context = contexts[0];
    if (!context || context.state !== 'running') fail('AudioContext never started under user activation');
    const outputBeforeSuspend = context.getOutputTimestamp?.();
    await context.suspend();
    await sleep(180);
    if (!states.some(value => value.state === 'suspended')) fail('No explicit suspended output reference');
    await context.resume();
    await sleep(3500);
    // Offset refinement leaves the producer anchor and epoch intact.
    localOrigin += 12;
    audio.clock(clock());
    await sleep(1800);
    const state = audio.stats();
    diagnosticPeak = Math.max(diagnosticPeak, state.debug?.renderPeak || 0);
    diagnosticNonzero = Math.max(diagnosticNonzero, state.debug?.renderNonzero || 0);
    const primary = reports.filter(value => value.mode === 'carplay');
    if (primary.length < 50 || !reports.some(value => value.mode === 'airplay-mirror')) fail('Both actual worklet producers must report output');
    if (!primary.some(value => value.method === 'timestamp')) fail('Actual getOutputTimestamp was not used');
    if (!(diagnosticPeak > .05 && diagnosticNonzero > 1000)) fail('Actual worklet output did not contain the nonzero waveform');
    if (violations.length) fail('Production CSP blocked integration');
    if (audioErrors.length) fail('Audio integration reported errors: ' + audioErrors.join('; '));
    if (draws.length < 50 || draws.some(value => value.skew < -45 || value.skew > 125 || value.sourceDelay > 0)) {
      fail('A/V Canvas submission escaped the exact skew/cap window');
    }
    const workers = workerProbes.map(probe => probe.result());
    for (const result of workers) {
      if (result.errors.length || !(result.stats?.decoded > 100)) fail('Actual ' + result.mode + ' decode failed: ' + JSON.stringify(result));
      if (result.mode === 'offscreen' && !(result.stats?.currentFps > 10)) fail('Actual worker OffscreenCanvas did not draw');
      if (result.mode === 'transfer' && (result.draws < 50 || result.minSkew < -45 || result.maxSkew > 125)) fail('Actual transferred video violated the A/V window: ' + JSON.stringify(result));
    }
    globalThis.__audioProbeResult = { done: true, ok: true, browser: navigator.userAgent,
      secureContext: isSecureContext, wasmCsp: 'production policy, no bypass', outputBeforeSuspend,
      summary: { carplayReferences: primary.length, mixedMirrorReferences: reports.length - primary.length, referencesWithoutDebug,
        peak: diagnosticPeak, nonzero: diagnosticNonzero, draws: draws.length,
        minSkewMs: Math.min(...draws.map(value => value.skew)), maxSkewMs: Math.max(...draws.map(value => value.skew)),
        scheduler: frames.stats(), presenter: presenter.stats() },
      states, reports: reports.filter((_, index) => index % 10 === 0), lastReference, workers,
      physicalOutputMeasured: false };
  } catch (error) {
    globalThis.__audioProbeResult = { done: true, ok: false, error: error.stack || String(error),
      violations, audioErrors, states: states.slice(-30), reports: reports.slice(-30),
      diagnosticPeak, diagnosticNonzero, scheduler: frames?.stats(), presenter: presenter?.stats(), workers: workerProbes.map(probe => probe.result()) };
  } finally {
    clearInterval(videoTimer); clearInterval(controlTimer); abort.abort(); audio?.dispose();
    for (const timer of packetTimers) clearInterval(timer);
    frames?.reset(); presenter?.dispose(); globalThis.AudioContext = nativeContext;
    for (const probe of workerProbes) probe.dispose();
  }
};
document.getElementById('start').addEventListener('click', () => void globalThis.startAudioProbe());
