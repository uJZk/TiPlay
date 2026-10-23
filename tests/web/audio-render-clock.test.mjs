// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioOutputMapping } from '../../site/play/audio-output-clock.js';

function renderer({ rate = .986, quantumFrames = 128, pipeline = () => 200 } = {}) {
  const origin = 1700000000000;
  let elapsed = 10000, native;
  const mapping = createAudioOutputMapping({ now: () => origin + elapsed, timeOrigin: () => origin });
  const context = { state: 'running', sampleRate: 48000, renderQuantumSize: typeof quantumFrames === 'function' ? 128 : quantumFrames,
    currentTime: 0, baseLatency: .012, outputLatency: .188, getOutputTimestamp: () => native };
  const counter = at => typeof rate === 'function' ? rate(at) : at * rate;
  function sample(at, { nativeFutureMs = 0, renderStepMs = 0, getterMs = 0 } = {}) {
    elapsed = at;
    native = { contextTime: counter(at - pipeline(at)) / 1000, performanceTime: at + nativeFutureMs };
    context.getOutputTimestamp = () => {
      elapsed += getterMs;
      const frames = typeof quantumFrames === 'function' ? quantumFrames(elapsed) : quantumFrames;
      const quantumMs = frames / 48;
      context.renderQuantumSize = frames;
      context.currentTime = (Math.floor(counter(elapsed) / quantumMs) * quantumMs + renderStepMs) / 1000;
      return native;
    };
    return mapping.capture(context);
  }
  return { mapping, context, sample, counter };
}

test('small recurring native pipeline steps cannot starve independently advancing render-rate evidence', () => {
  const h = renderer({ pipeline: at => 200 + (Math.floor(at / 1000) % 2 ? 5 : -5) });
  let pending = 0;
  for (let at = 10000; at <= 55000; at += 40) if (!h.sample(at)) pending++;
  const fit = h.mapping.deviceClock();
  assert.ok(pending > 20, 'the native output phase still requires reacquisition after its steps');
  assert.equal(fit.fitStatus, 'tracking');
  assert.ok(Math.abs(fit.rate - .986) < .00006, `${fit.rate}`);
  assert.equal(fit.reason, 'context', 'native output offsets cannot retire the render sample clock');
});

test('64 to 1024 frame render quantization has measured uncertainty instead of preventing rate acquisition', () => {
  for (const quantumFrames of [64, 128, 256, 512, 1024]) {
    const h = renderer({ quantumFrames });
    h.mapping.debug(true);
    for (let at = 10000; at <= 70000; at += 40) h.sample(at, { nativeFutureMs: 80 });
    const fit = h.mapping.deviceClock();
    assert.equal(fit.fitStatus, 'tracking', `${quantumFrames}: ${fit.fitRejectReason}`);
    assert.equal(fit.source, 'render');
    assert.ok(Math.abs(fit.rate - .986) < .0002, `${quantumFrames}: ${fit.rate}`);
    assert.ok(fit.uncertaintyMs >= quantumFrames / 48 / 2, 'the accepted fit reserves the known quantization interval');
    assert.ok(Number.isFinite(fit.fitDispersionMs), 'raw MAD remains diagnostic evidence');
  }
});

test('unavailable future native timestamps cannot train phase or block valid render-rate observations', () => {
  const h = renderer();
  for (let at = 10000; at <= 55000; at += 40) h.sample(at, { nativeFutureMs: 80 });
  const fit = h.mapping.deviceClock();
  assert.ok(Math.abs(fit.rate - .986) < .00006, `${fit.rate}`);
  assert.equal(h.mapping.diagnostics().outputState, 'latency-estimate', 'invalid native pairs never become trusted phase anchors');
});

test('getter time is paired correctly and a main-thread observation gap retains the established reset boundary', () => {
  const h = renderer({ rate: .988 });
  for (let at = 10000; at <= 40000; at += 40) h.sample(at, { getterMs: 7 });
  const before = h.mapping.deviceClock();
  assert.ok(Math.abs(before.rate - .988) < .00006);
  assert.equal(h.sample(41520, { getterMs: 7 }), null, 'an expired native phase still needs two fresh pairs');
  const reacquiring = h.mapping.deviceClock();
  assert.equal(reacquiring.reason, 'gap');
  assert.equal(reacquiring.fitStatus, 'acquiring');
  assert.equal(reacquiring.source, 'holdover');
  assert.equal(reacquiring.rate, 1, 'an unobserved rate interval retains the baseline nominal reset');
  assert.equal(reacquiring.targetRatePpm, reacquiring.ratePpm, 'an old unachieved target cannot steer the new fit');
  assert.equal(h.sample(41560, { getterMs: 7 })?.outputMethod, 'timestamp');
  for (let at = 41600; at <= 70000; at += 40) h.sample(at, { getterMs: 7 });
  assert.ok(Math.abs(h.mapping.deviceClock().rate - .988) < .00006);
});

test('a real render-rate change remains measurable through recurring independent pipeline changes', () => {
  const switchAt = 35000;
  const counter = at => at <= switchAt ? at * .986 : switchAt * .986 + (at - switchAt) * 1.012;
  const h = renderer({ rate: counter, pipeline: at => 200 + (Math.floor(at / 1000) % 2 ? 5 : -5) });
  for (let at = 10000; at <= 35000; at += 40) h.sample(at);
  assert.ok(Math.abs(h.mapping.deviceClock().rate - .986) < .00006);
  h.sample(35040);
  assert.ok(h.mapping.deviceClock().rate < .99, 'a new physical rate cannot cause an instantaneous resampler ratio step');
  for (let at = 35080; at <= 95000; at += 40) h.sample(at);
  assert.ok(Math.abs(h.mapping.deviceClock().rate - 1.012) < .00006, `${h.mapping.deviceClock().rate}`);
});

test('a forward render-coordinate jump discards its fit without training the jump as drift', () => {
  const h = renderer({ rate: .996 });
  for (let at = 10000; at <= 35000; at += 40) h.sample(at);
  const before = h.mapping.deviceClock();
  h.sample(35040, { renderStepMs: 20 });
  const jumped = h.mapping.deviceClock();
  assert.equal(jumped.reason, 'step');
  assert.equal(jumped.generation, before.generation + 1);
  assert.equal(jumped.rate, before.rate, 'a coordinate step does not prove a changed oscillator');
  assert.equal(jumped.source, 'native', 'independent current native evidence survives a render-coordinate jump');
  for (let at = 35080; at <= 55000; at += 40) h.sample(at, { renderStepMs: 20 });
  assert.ok(Math.abs(h.mapping.deviceClock().rate - .996) < .00006);
});

test('a larger observed block retains its quantization reserve after blocks shrink again', () => {
  const h = renderer({ quantumFrames: at => at < 30000 ? 128 : at < 45000 ? 1024 : 64 });
  for (let at = 10000; at <= 70000; at += 40) h.sample(at, { nativeFutureMs: 80 });
  const fit = h.mapping.deviceClock();
  assert.equal(fit.fitStatus, 'tracking');
  assert.ok(Math.abs(fit.rate - .986) < .0002);
  assert.ok(fit.uncertaintyMs >= 1024 / 48 / 2);
  assert.equal(fit.source, 'render');
});

test('a changed oscillator hidden by a main-thread gap must reacquire instead of keeping an old target', () => {
  const counter = at => at < 41000 ? at * .988 : 41000 * .988 + at - 41000;
  const h = renderer({ rate: counter });
  for (let at = 10000; at <= 40000; at += 40) h.sample(at);
  const before = h.mapping.deviceClock();
  assert.equal(h.sample(42000), null);
  const gap = h.mapping.deviceClock();
  assert.equal(gap.reason, 'gap');
  assert.equal(gap.rate, 1, 'the baseline gap policy does not assume an unchanged oscillator');
  assert.equal(gap.targetRatePpm, gap.ratePpm);
  assert.equal(gap.confidence, 0);
  for (let at = 42040; at <= 70000; at += 40) h.sample(at);
  assert.ok(Math.abs(h.mapping.deviceClock().rate - 1) < .00006);
});

test('a running render stall and catch-up cannot become long-lived oscillator evidence', () => {
  const counter = at => at < 35000 ? at : at < 35100 ? 35000 : at < 35200 ? 35000 + 2 * (at - 35100) : at;
  const h = renderer({ rate: counter });
  for (let at = 10000; at <= 60000; at += 20) {
    h.sample(at);
    assert.ok(Math.abs(h.mapping.deviceClock().rate - 1) < .00006, `at ${at}`);
  }
  const fit = h.mapping.deviceClock();
  assert.equal(fit.fitStatus, 'tracking');
  assert.ok(fit.generation > 2, 'the discontinuous render segment retires its own rate evidence');
});

test('native residual uncertainty converts from context milliseconds to performance milliseconds once', () => {
  for (const extra of [-.0001, .0001]) {
    const rate = .988, origin = 1700000000000, pattern = [-1, -1, 0, 1, 1];
    let elapsed, pair;
    const mapping = createAudioOutputMapping({ now: () => origin + elapsed, timeOrigin: () => origin });
    const context = { state: 'running', sampleRate: 48000, currentTime: 0,
      getOutputTimestamp: () => pair };
    for (let i = 0; i <= 400; i++) {
      elapsed = 10000 + i * 100; context.currentTime = elapsed * rate / 1000;
      pair = { contextTime: ((elapsed - 200) * rate + pattern[i % pattern.length]) / 1000, performanceTime: elapsed };
      mapping.capture(context);
    }
    const nativeU = mapping.diagnostics().outputTimestampFitUncertaintyMs;
    const applied = mapping.deviceClock().rate, previous = pair;
    assert.ok(nativeU > .5 && nativeU < 1.5, 'native MAD remains distinct from render quantization');
    elapsed += 40; context.currentTime = elapsed * rate / 1000;
    const held = mapping.capture(context);
    assert.equal(held?.outputMethod, 'timestamp-holdover');
    assert.ok(Math.abs(held.uncertaintyMs - (128 / 48 + nativeU) / applied) < .000001,
      'holdover age rate error is reserved once at the actual caller projection distance');
    elapsed += 40; context.currentTime = elapsed * rate / 1000;
    const allowedContextInnovation = 128 / 48 + nativeU + 80 * .02 * applied;
    pair = { contextTime: previous.contextTime + (80 * applied + allowedContextInnovation + extra) / 1000,
      performanceTime: elapsed };
    const boundary = mapping.capture(context);
    assert.equal(boundary?.outputMethod ?? null, extra < 0 ? 'timestamp' : null, 'native phase admission uses the same applied rate and one uncertainty conversion');
  }
});

test('a truthful native clock owns the target while render-ahead progress changes independently', () => {
  for (const stepped of [false, true]) {
    const origin = 1700000000000;
    let elapsed = 1000, pair;
    const mapping = createAudioOutputMapping({ now: () => origin + elapsed, timeOrigin: () => origin });
    const context = { state: 'running', sampleRate: 48000, currentTime: 0,
      getOutputTimestamp: () => pair };
    for (elapsed = 1000; elapsed <= 39960; elapsed += 40) {
      const offset = stepped ? Math.floor(elapsed / 1000) % 2 ? 5 : -5 : 0;
      context.currentTime = (1000 + elapsed * .986) / 1000;
      pair = { contextTime: (elapsed + offset) / 1000, performanceTime: elapsed };
      mapping.capture(context);
    }
    elapsed -= 40;
    const fit = mapping.deviceClock(), offset = stepped ? Math.floor(elapsed / 1000) % 2 ? 5 : -5 : 0;
    assert.equal(fit.source, stepped ? 'render' : 'native');
    if (!stepped) assert.ok(Math.abs(fit.rate - 1) < .000001, 'render-ahead motion cannot displace a fresh native oscillator target');
    const feedbackContext = context.currentTime * 1000;
    const reference = mapping.reference({ state: 'playing', contextTimeMs: feedbackContext, sourceTimeMs: 800000,
      mediaRate: 1, filterUncertaintyMs: 0 }, context);
    const truth = origin + feedbackContext - offset;
    assert.ok(['timestamp', 'timestamp-holdover'].includes(reference.outputMethod));
    assert.ok(Math.abs(reference.audibleTimeMs - truth) <= reference.uncertaintyMs + .0003,
      `unsettled applied rate must remain inside native projection uncertainty (${fit.source})`);
  }
});
