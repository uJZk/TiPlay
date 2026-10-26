// SPDX-License-Identifier: GPL-3.0-only
// The page must work from any path and offline once cached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { APP_VERSION } from '../../site/play/app-version.js';
import { DEFAULT_HOST, abortable, isCode, normalizeHost } from '../../site/play/link.js';
import { browserDiagnosticEvents, PAGE_VERSION } from '../../site/play/browser-diagnostics.js';
import { decoderStatsMatch } from '../../site/play/video-diagnostics.js';
import { rtcFailureSummary } from '../../site/play/rtc-diagnostics.js';
import { airPlayContext, airPlayFailed, createReceiverNoticeTracker, videoProblemFor, videoReadyFor, videoSourceFor } from '../../site/play/receiver-presentation.js';

const play = new URL('../../site/play/', import.meta.url);
const read = name => readFileSync(new URL(name, play), 'utf8');

test('rejected audio blocks request compact diagnostics only for a first source fault', () => {
  const callback = /onSourceDeadline: (\(\{ first \}\) => \{[\s\S]*?\n  \}),/.exec(read('app.js'))[1];
  const events = []; let snapshots = 0;
  const report = new Function('faultDiagnostics', 'browserDiagnosticEvents', 'pageStats', 'appearance', `return ${callback}`)(
    { report: event => events.push(event) }, browserDiagnosticEvents,
    () => { snapshots++; return { audio: { sourceDeadlineState: 'violated', sourceDeadlineRejectedFrames: 128,
      debug: { contextState: 'running', privateLargeDebug: 'not part of the fault summary' } } }; }, { matches: false });
  report({ first: true });
  for (let i = 0; i < 1000; i++) report({ first: false });
  assert.equal(snapshots, 1); assert.equal(events.length, 1); assert.equal(events[0].k, 'st');
  assert.equal(events[0].v['audio.sourceDeadlineState'], 'violated');
  assert.equal(events[0].v['audio.sourceDeadlineRejectedFrames'], 128);
  assert.ok(!JSON.stringify(events).includes('privateLargeDebug'));
});

test('a media terminal records its current reason before cleanup and cannot retry the same owner twice', () => {
  const source = /function streamEnded\([^\n]*\) \{[\s\S]*?\n\}/.exec(read('app.js'))[0];
  const events = [];
  const run = new Function('events', 'failLog', `
    let streamId = 9, terminalDiagnosticId = null, live = true;
    let lastError = Object.assign(new Error('prior connection'), { reason: 'ice-failed' });
    const faultDiagnostics = { reset: () => events.push('fault-reset') };
    const videoAbort = { abort: () => events.push('abort') }, rtcMedia = { close: () => events.push('close') };
    const sink = { stop: () => events.push('sink-stop') }, releaseTouches = () => {};
    const reportDiagnostics = () => { events.push(['diagnostic', lastError.reason]); if (failLog) throw new Error('diagnostic failed'); };
    const scheduleRetry = () => events.push('retry'), backoffDelay = () => 100, stop = () => {};
    let attempt = 0;
    ${source}
    streamEnded('timeout'); streamEnded('network');
    return lastError.reason;
  `);
  assert.equal(run(events), 'timeout');
  assert.deepEqual(events, ['fault-reset', ['diagnostic', 'timeout'], 'abort', 'close', 'sink-stop', 'retry']);
  const failed = [];
  assert.equal(run(failed, true), 'timeout');
  assert.deepEqual(failed, events, 'a failed diagnostic cannot bypass any cleanup or create a second retry');
});

test('the terminal decoder snapshot reaches page diagnostics before stream retirement', () => {
  const source = /function onVideoMessage\([^\n]*\) \{[\s\S]*?\n\}/.exec(read('app.js'))[0];
  const run = new Function('decoderStatsMatch', `
    const active = true, streamId = 3, config = { epoch: 8 }; let videoStats = { codec: 'old', decodeInFlightFrames: 0 };
    const performanceStats = value => value, render = () => {};
    let terminal;
    const streamEnded = reason => { terminal = { reason, stats: { ...videoStats } }; };
    ${source}
    onVideoMessage({ type: 'end', id: 3, reason: 'decode-stalled', stats: { streamGeneration: 3, codec: 'hvc1.1.6.L93.B0', epoch: 8, decodeInFlightFrames: 48 } });
    return terminal;
  `);
  assert.deepEqual(run(decoderStatsMatch), { reason: 'decode-stalled', stats: { streamGeneration: 3, codec: 'hvc1.1.6.L93.B0', epoch: 8, decodeInFlightFrames: 48 } });
});

test('a queued old worker or codec snapshot cannot refresh the current decoder sample age', () => {
  const source = /function onVideoMessage\([^\n]*\) \{[\s\S]*?\n\}/.exec(read('app.js'))[0];
  const run = new Function('decoderStatsMatch', `
    const active = true, streamId = 3, config = { epoch: 8 }; let videoStats = {};
    const performanceStats = value => value, render = () => {};
    ${source}
    onVideoMessage({ type: 'stats', id: 3, stats: { streamGeneration: 3, epoch: 8, decoderStatsSampledAtMs: 100 } });
    onVideoMessage({ type: 'stats', id: 2, stats: { streamGeneration: 2, epoch: 8, decoderStatsSampledAtMs: 300 } });
    onVideoMessage({ type: 'stats', id: 3, stats: { streamGeneration: 3, epoch: 7, decoderStatsSampledAtMs: 500 } });
    return videoStats;
  `);
  assert.deepEqual(run(decoderStatsMatch), { streamGeneration: 3, epoch: 8, decoderStatsSampledAtMs: 100 });
});

test('decoder setup precedes pairing and the first authenticated clock reaches video and audio before media opens', async () => {
  const connect = /async function connectVideo\(\) \{([\s\S]*?)\n\}/.exec(read('app.js'))[0];
  let finishSetup;
  const codecsReady = new Promise(resolve => { finishSetup = resolve; });
  const events = [];
  const run = new Function('codecsReady', 'events', 'abortable', `
    let streamId = 0, sink = null, retryTimer, retryCountdownTimer, videoAbort, live, phase, lastViewport, rtcMedia, lastError;
    const faultDiagnostics = { reset() {} };
    let rtcProgress, resourceToken, controlClock, outbox = null, heartbeatTimer, mediaTiming;
    const controlWaiters = new Set();
    const link = { code: '1234' }, session = 'owner', PROTOCOL = 1, videoPath = {};
    const clock = { offset: 10, rtt: 2, at: 100 };
    let authenticated = false;
    const phoneFetch = () => { throw new Error('No unauthenticated HTTP media/control or clock request is allowed.'); };
    const authenticateRtcOffer = async options => {
      if (options.session !== 'owner' || options.code !== '1234' || options.offer !== 'offer') throw new Error('wrong pairing owner');
      events.push(['pairing', options.session]); return { sdp: 'verified-answer', epoch: 7 };
    };
    const hello = { app: 'TiPlay', protocol: 1, audio: true, transport: 'webrtc-datachannel-v1' };
    const createRtcMediaTransport = options => {
      events.push(['peer-created']);
      return {
        video: null, connect: async () => { await options.exchange('offer'); authenticated = true; events.push(['authenticated']); },
        resourceToken: () => 'random-resource-capability', clockSample: () => ({ serverMs: 100, started: 90, ended: 110 }),
        hello: () => hello, openAudio() {},
      };
    };
    const browserAudio = { attach(_signal, value) { events.push(['audio-attach', value]); }, clock: value => events.push(['audio-clock', value]) };
    const mediaTimings = new Map([['carplay', { reset: () => events.push(['timing-reset']), mode() {} }]]);
    const timingFor = mode => mediaTimings.get(mode);
    const render = () => {}, resetReceiverPresentation = () => {}, reportAppearance = () => events.push(['appearance']), scheduleViewport = () => events.push(['viewport']);
    const setInterval = () => 0, clearInterval = () => {};
    const stop = reason => { throw new Error(reason); }, scheduleRetry = () => { throw new Error('Unexpected retry'); };
    const createClockEstimator = () => ({ observe: (...sample) => { events.push(['clock-sample', ...sample]); return clock; } });
    const postControl = () => {}, applyStatus = () => {}, controlFailed = () => {}, slots = { contacts: () => [] };
    const createControlOutbox = options => {
      if (!authenticated || options.maxInFlight !== 8) throw new Error('control started before authenticated RTC');
      events.push(['outbox']); return { heartbeat: () => events.push(['control-heartbeat']) };
    };
    ${connect}
    const pending = connectVideo();
    return { pending, setup() { sink = {
      clock: value => events.push(['video-clock', value]), open: () => events.push(['open']),
    }; } };
  `)(codecsReady, events, abortable);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [], 'decoder setup must finish before pairing or control begins');
  run.setup(); finishSetup('avc1'); await run.pending;
  const index = name => events.findIndex(([type]) => type === name);
  assert.ok(index('pairing') >= 0 && index('authenticated') > index('pairing'));
  assert.deepEqual(events.find(([type]) => type === 'clock-sample'), ['clock-sample', 100, 90, 110]);
  for (const name of ['video-clock', 'audio-clock']) {
    const value = events.find(([type, sample]) => type === name && sample !== null);
    assert.deepEqual(value, [name, { offset: 10, rtt: 2, at: 100 }]);
    assert.ok(events.indexOf(value) > index('authenticated') && events.indexOf(value) < index('open'));
  }
  assert.ok(index('outbox') > index('authenticated') && index('control-heartbeat') > index('outbox'));
  assert.deepEqual(events.find(([type]) => type === 'audio-attach')[1], { app: 'TiPlay', protocol: 1, audio: true, transport: 'webrtc-datachannel-v1' });
});

function retryPage(lastError) {
  const app = read('app.js');
  const extract = name => new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(app)[0];
  let now = 0, nextId = 0;
  const timers = new Map(), elements = new Map(), overlays = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { setAttribute() {} });
    return elements.get(id);
  };
  const setTimer = (callback, delay, repeat) => {
    const id = ++nextId; timers.set(id, { callback, at: now + delay, repeat }); return id;
  };
  const page = new Function('$', 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'renderReconnect', 'lastError', 'rtcFailureSummary', 'PAGE_VERSION', 'airPlayContext', 'airPlayFailed', 'createReceiverNoticeTracker', 'videoProblemFor', 'videoReadyFor', 'videoSourceFor', `
    let phase, retryAt, retryTimer, retryCountdownTimer, reconnects = 0, streamId = 0, videoAbort, rtcMedia, rtcProgress, resourceToken, controlClock;
    const controlWaiters = new Set(), codecsReady = new Promise(() => {}), abortable = value => value;
    let active = true, live = false, notice = null, status = null, unsupported = null, outbox = null, wakeLock = null, config = null;
    let receiverFailure = false;
    const receiverNotices = createReceiverNoticeTracker();
    let heartbeatTimer, statsTimer, lastViewport, fitRequestedAt = 0;
    const browserLocation = { stop() {} };
    let problem = null;
    const browserNotice = { update(value) { if (value) problem = value; }, reset(id) { if (!id || problem?.id === id) problem = null; } };
    const codecName = value => value;
    const videoStats = {};
    const statsVisible = false, link = { code: '1234' }, stage = {}, session = 'session';
    const airplayControls = { update() {}, videoActive: () => false };
    let trustVisible = true, trustClears = 0;
    const airplayTrust = { clear() { trustVisible = false; trustClears++; } };
    const browserAudio = { stop() {} }, sink = { stop() {} }, slots = { releaseAll() {} };
    const faultDiagnostics = { reset() {} };
    const cancelViewport = () => {}, cancelMove = () => {}, renderStats = () => {};
    const t = (key, ...args) => args.length ? key + ':' + args.join(',') : key;
    const phoneFetch = () => new Promise(() => {});
    const createClockEstimator = () => ({ observe: () => null, snapshot: () => null });
    ${['statusText', 'retryStatusText', 'connectionDetailsText', 'rtcStageText', 'rtcCandidateText', 'rtcRetryText', 'render', 'scheduleRetry', 'stop', 'connectVideo'].map(extract).join('\n')}
    return { scheduleRetry, stop, connectVideo, reconnects: () => reconnects,
      present(value) {
        phase = 'waiting'; status = value.status ?? null; config = value.config ?? null;
        live = value.live ?? false; unsupported = value.unsupported ?? null;
        receiverFailure = receiverNotices.observe(status, config).failure;
        render(); return $('status').textContent;
      },
      connecting(progress) { phase = 'connecting'; rtcProgress = progress; render(); return $('status').textContent; },
      details() { $('diagnostics').open = true; render(); return $('connection-details').textContent; },
      problem: () => problem, inlineMessage: () => $('message').textContent, statusHidden: () => $('status').hidden,
      trustState: () => ({ visible: trustVisible, clears: trustClears }) };
  `)($, { now: () => now }, (callback, delay) => setTimer(callback, delay, 0), id => timers.delete(id),
    (callback, delay) => setTimer(callback, delay, delay), id => timers.delete(id), value => overlays.push(value.text), lastError, rtcFailureSummary, PAGE_VERSION,
    airPlayContext, airPlayFailed, createReceiverNoticeTracker, videoProblemFor, videoReadyFor, videoSourceFor);
  return {
    ...page, overlays, text: () => $('status').textContent,
    intervals: () => [...timers.values()].filter(timer => timer.repeat).length,
    advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
        timer.callback();
      }
      now = target;
    },
  };
}

test('waiting messages follow receiver phase and actual video source rather than session availability', () => {
  const page = retryPage(null);
  assert.equal(page.present({ status: { state: 'idle' } }), 'waitingSource');
  assert.equal(page.present({ status: { state: 'connecting' } }), 'waitingSource');
  for (const [state, key] of Object.entries({
    preparing: 'carPlayPreparing', blocked: 'carPlayBlocked', disabled: 'carPlayDisabled',
    failed: 'carPlayFailed', recovering: 'carPlayRecovering', stopping: 'carPlayStopping',
    connecting: 'phoneConnecting', ready: 'waitingPhone', waiting: 'waitingPhone',
  })) {
    assert.equal(page.present({ status: { state: 'idle', receivers: { carplay: { state } } } }), key);
  }
  assert.equal(page.present({ status: { videoSource: 'carplay' } }), 'waitingFrame');
  assert.equal(page.present({ status: { videoSource: 'airplay' } }), 'waitingVideo');
  assert.equal(page.present({ config: { mode: 'carplay' } }), 'waitingFrame');
  assert.equal(page.present({ config: { mode: 'airplay-mirror' } }), 'waitingVideo');
  assert.equal(page.present({ status: { airplay: { kind: 'audio' } } }), '');
  assert.equal(page.statusHidden(), true);
  assert.equal(page.present({ status: { airplay: { kind: 'photo', resource: 'photo' } } }), '');
  assert.equal(page.present({ status: { airplay: { kind: 'video', resource: 'movie', ready: false } } }), 'waitingVideo');
  assert.equal(page.present({ status: { airplay: { kind: 'video', resource: 'movie', ready: true, playing: false } } }), 'airPlayPaused');
  assert.equal(page.present({ status: { airplay: { kind: 'video', resource: 'movie', ready: true, playing: true } } }), '');
  assert.equal(page.present({ live: true, config: { codec: 'avc1', mode: 'carplay' }, status: { state: 'idle' } }), '');
  assert.equal(page.statusHidden(), true);
  assert.equal(page.present({ live: true, config: { codec: 'avc1', mode: 'airplay-mirror' } }), '');
});

test('AirPlay handoff and its local-network permission take precedence over a retired CarPlay picture and failure', () => {
  const page = retryPage(null);
  const receivers = { carplay: { state: 'suspended' }, airplay: { state: 'listening' } };
  assert.equal(page.present({ config: { mode: 'carplay' }, status: { receivers } }), 'carPlaySuspended');
  assert.equal(page.present({ status: { receivers: { ...receivers, airplay: { state: 'permission' } } } }), 'airPlayPermission');
  for (const state of ['mirror', 'video', 'loading', 'photo']) {
    assert.equal(page.present({ config: { mode: 'carplay' },
      status: { receivers: { ...receivers, airplay: { state } } } }), 'waitingVideo');
  }
  assert.equal(page.present({ status: { receivers, videoSource: 'airplay' } }), 'waitingVideo');
  for (const state of ['failed', 'suspended']) {
    assert.equal(page.present({ status: { receivers: { carplay: { state } },
      airplay: { kind: 'video', resource: 'movie', ready: true, playing: true } } }), '');
    assert.equal(page.present({ status: { receivers: { carplay: { state } },
      airplay: { kind: 'photo', resource: 'photo', outputAllowed: true } } }), '');
  }
  assert.equal(page.present({ status: { receivers: { carplay: { state: 'failed' } } } }), 'carPlayFailed');
});

test('an inactive AirPlay receiver permission failure cannot replace the current CarPlay phase', () => {
  const page = retryPage(null);
  const airplay = { state: 'permission' };
  for (const [state, expected] of [['failed', 'carPlayFailed'], ['connecting', 'phoneConnecting'], ['ready', 'waitingPhone']]) {
    assert.equal(page.present({ status: { receivers: { carplay: { state }, airplay } } }), expected);
  }
  assert.equal(page.present({ status: { receivers: { carplay: { state: 'suspended' }, airplay } } }), 'airPlayPermission');
  assert.equal(page.present({ status: { videoSource: 'airplay', receivers: { carplay: { state: 'failed' }, airplay } } }), 'airPlayPermission');
  assert.equal(page.present({ config: { mode: 'airplay-mirror' },
    status: { receivers: { carplay: { state: 'failed' }, airplay } } }), 'airPlayPermission');
});

test('producer changes and explicit return snapshots supersede old decoded frames and configs', () => {
  const page = retryPage(null);
  assert.equal(page.present({ live: true, config: { mode: 'carplay' }, status: { videoSource: 'carplay' } }), '');
  assert.equal(page.present({ live: true, config: { mode: 'carplay' }, status: { videoSource: 'carplay',
    receivers: { carplay: { state: 'suspended' }, airplay: { state: 'loading' } } } }), '');
  assert.equal(page.present({ live: true, config: { mode: 'carplay' }, status: { videoSource: null,
    receivers: { carplay: { state: 'suspended' }, airplay: { state: 'loading' } } } }), 'waitingVideo');
  assert.equal(page.present({ live: true, config: { mode: 'airplay-mirror' }, status: { videoSource: 'carplay',
    receivers: { carplay: { state: 'connected' }, airplay: { state: 'listening' } } } }), 'waitingFrame');
  assert.equal(page.present({ live: true, config: { mode: 'airplay-mirror' }, status: { videoSource: null,
    receivers: { carplay: { state: 'failed' }, airplay: { state: 'listening' } } } }), 'carPlayFailed');
  for (const kind of ['video', 'photo', 'audio']) {
    assert.equal(page.present({ unsupported: 'hvc1', config: { mode: 'carplay' }, status: { videoSource: null,
      airplay: { id: 7, kind, resource: 'new', ready: true, playing: true, outputAllowed: true } } }), '');
    assert.equal(page.statusHidden(), true);
  }
});

test('only foreground AirPlay faults replace the current phase and active output has no success row', () => {
  for (const state of ['failed', 'discovery-failed', 'audio-failed', 'playback-failed']) {
    const page = retryPage(null);
    assert.equal(page.present({ live: true, config: { mode: 'carplay' }, status: { videoSource: 'carplay',
      receivers: { carplay: { state: 'connected' }, airplay: { state } } } }), '');
    page.present({ status: { videoSource: null, receivers: { carplay: { state: 'suspended' }, airplay: { state: 'loading' } } } });
    assert.equal(page.present({ config: { mode: 'carplay' }, status: { videoSource: null,
      receivers: { carplay: { state: 'suspended' }, airplay: { state } } } }), 'airPlayFailed');
  }
  const page = retryPage(null);
  assert.equal(page.present({ status: { airplay: { id: 8, kind: 'video', resource: 'movie', ready: true, playing: false } } }), 'airPlayPaused');
  assert.equal(page.statusHidden(), false);
  assert.equal(page.present({ status: { airplay: { id: 8, kind: 'video', resource: 'movie', ready: true, playing: true } } }), '');
  assert.equal(page.statusHidden(), true);
});

test('a new producer epoch waits for its own decoded event while an identical config preserves readiness', () => {
  const source = /function onVideoMessage\([^\n]*\) \{[\s\S]*?\n\}/.exec(read('app.js'))[0];
  const fixture = new Function(`
    const active = true, streamId = 1; let config = { epoch: 7, mode: 'carplay' }, live = true;
    let videoStats = { decodedFps: 30 }, unsupported = null, mediaTiming;
    const sink = { delay() {} }, timingFor = () => ({ plans() {}, started() {} });
    const outbox = { push() {} }, keepScreenOn = () => {}, render = () => {}, updateReceiverNotice = () => {};
    ${source}
    return { receive(value) { onVideoMessage({ id: 1, ...value }); return { live, config, videoStats }; } };
  `)();
  assert.equal(fixture.receive({ type: 'config', config: { epoch: 7, mode: 'carplay' } }).live, true);
  assert.equal(fixture.receive({ type: 'config', config: { epoch: 8, mode: 'airplay-mirror' } }).live, false);
  assert.equal(fixture.receive({ type: 'decoded', epoch: 7 }).live, false);
  assert.equal(fixture.receive({ type: 'decoded', epoch: 8 }).live, true);
  assert.equal(fixture.receive({ type: 'config', config: { epoch: 9, mode: 'carplay' } }).live, false);
});

test('default connection and retry messages keep technical state in the optional diagnostics', () => {
  const diagnostic = { stage: 'remote-ice', localCandidates: 2, remoteCandidates: 0, iceState: 'checking', connectionState: 'connecting' };
  const page = retryPage({ rtcReason: 'timeout', rtcDiagnostic: diagnostic, message: 'secret pairing-code' });
  assert.equal(page.connecting(diagnostic), 'connecting');
  assert.match(page.details(), new RegExp(PAGE_VERSION));
  assert.match(page.details(), /rtcCandidates:2,0/);
  page.scheduleRetry(3000);
  assert.equal(page.text(), 'retryConnection:3');
  assert.equal(page.overlays.at(-1), 'retryConnection:3');
  assert.match(page.details(), /rtcRemoteTimeout/);
  assert.doesNotMatch(page.details(), /secret|pairing-code/);
  page.advance(1000);
  assert.equal(page.text(), 'retryConnection:2');
  assert.doesNotMatch(page.text(), /ICE|Peer|DC|Candidates|v\d+/);
});

test('codec and protocol errors use persistent notices while pairing errors stay beside Connect', () => {
  const page = retryPage(null);
  assert.equal(page.present({ unsupported: 'hvc1', config: { mode: 'carplay' } }), 'pictureUnavailable');
  assert.equal(page.problem().text, 'unsupportedHevc:hvc1');
  assert.equal(page.inlineMessage(), '');
  page.stop('protocol');
  assert.equal(page.problem().text, 'protocol');
  assert.equal(page.text(), 'stopped');
  page.stop('badCode');
  assert.equal(page.inlineMessage(), 'badCode');
  assert.equal(page.problem().text, 'protocol', 'pairing feedback must not replace the notification');
  for (const key of ['invalidCode', 'invalidHost']) {
    page.stop(key);
    assert.equal(page.inlineMessage(), key);
  }
});

test('retry messages count down every second without receiving a phone heartbeat', () => {
  for (const [error, key] of [[null, 'lost'], [{ status: 500 }, 'unreachable'], [{ status: 503 }, 'retryAndroid'], [{ status: 429 }, 'throttled']]) {
    const page = retryPage(error);
    page.scheduleRetry(3000);
    assert.equal(page.text(), `${key}:3`);
    page.advance(1000); assert.equal(page.text(), `${key}:2`);
    page.advance(1000); assert.equal(page.text(), `${key}:1`);
    assert.deepEqual(page.overlays, [`${key}:3`, `${key}:2`, `${key}:1`], 'both waiting overlay and settings status receive the actual countdown');
    page.advance(1000);
    assert.equal(page.text(), 'connecting'); assert.equal(page.reconnects(), 1);
    assert.equal(page.intervals(), 0, 'the connection attempt clears the countdown timer');
  }
});

test('replacing a retry schedule cancels the previous countdown and reconnect attempt', () => {
  const page = retryPage(null);
  page.scheduleRetry(3000); page.advance(500);
  page.scheduleRetry(4000);
  assert.equal(page.intervals(), 1);
  const notifications = page.overlays.length;
  page.advance(500);
  assert.equal(page.overlays.length, notifications, 'the old one-second timer must be cancelled');
  page.advance(500); assert.equal(page.text(), 'lost:3');
  page.advance(1500); assert.equal(page.reconnects(), 0, 'the original reconnect deadline must be cancelled');
  page.advance(1500); assert.equal(page.reconnects(), 1); assert.equal(page.intervals(), 0);
});

test('stopping or manually connecting clears the retry countdown immediately', () => {
  for (const action of ['stop', 'connectVideo']) {
    const page = retryPage(null);
    page.scheduleRetry(3000); page.advance(1000);
    page[action]();
    assert.equal(page.intervals(), 0);
    const notifications = page.overlays.length;
    page.advance(3000);
    assert.equal(page.overlays.length, notifications, action);
    assert.equal(page.reconnects(), 0, 'cancelled retry cannot start another connection');
  }
});

test('disconnect immediately clears an AirPlay approval before a delayed status poll arrives', () => {
  const page = retryPage(null);
  assert.deepEqual(page.trustState(), { visible: true, clears: 0 });
  page.scheduleRetry(3000);
  page.stop();
  assert.deepEqual(page.trustState(), { visible: false, clears: 1 });
  page.advance(5000);
  assert.deepEqual(page.trustState(), { visible: false, clears: 1 });
});

test('blank and whitespace address fields connect to the default phone', () => {
  const submit = /\$\('link-form'\)\.addEventListener\('submit', event => \{([\s\S]*?)\n\}\);/.exec(read('app.js'))[1];
  for (const value of ['', '   ', '169.254.111.112:9000', 'invalid']) {
    const fields = { code: { value: '1234', focus() {} }, host: { value, focus() {} } };
    const run = new Function('$', 'DEFAULT_HOST', 'normalizeHost', 'isCode', `
      let link, stopped, started = false;
      const active = false, event = { preventDefault() {} };
      const stop = value => { stopped = value; }, saveLink = () => {}, showLink = () => {};
      const start = () => { started = true; };
      function submit() { ${submit} }
      submit();
      return { link, stopped, started };
    `);
    const result = run(id => fields[id], DEFAULT_HOST, normalizeHost, isCode);
    if (value === 'invalid') {
      assert.equal(result.stopped, 'invalidHost');
      assert.equal(result.started, false);
    } else {
      assert.equal(result.link.host, value.trim() || DEFAULT_HOST);
      assert.equal(result.started, true);
    }
  }
});

test('disconnect is a separate full-width row immediately below connect', () => {
  const html = read('index.html');
  assert.match(html, /<button id="connect"[^>]*>[\s\S]*?<\/button>\s*<button id="disconnect" type="button"[^>]* hidden><\/button>/);
  assert.equal([...html.matchAll(/id="disconnect"/g)].length, 1);
  assert.match(read('style.css'), /#connect,#disconnect\{display:block;width:100%;/);
  assert.match(read('style.css'), /#disconnect\{margin-top:8px\}/);
});

test('the service worker precaches every runtime file and leaves sources and the independent clock lab on the network', () => {
  const assets = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(read('sw.js'))[1].replaceAll("'", '"'));
  const files = readdirSync(play, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name !== 'sw.js').map(entry => (entry.parentPath.slice(new URL(play).pathname.replace(/\/$/, '').length) + '/' + entry.name).replaceAll('\\', '/').replace(/^\/+/, ''));
  assert.deepEqual([...assets].filter(name => name !== './').sort(), files.filter(name => !name.startsWith('chatgpt/')
    && !name.split('/').includes('source') && /\.(js|mjs|wasm|css|html|svg|png)$/.test(name)).sort());
  assert.equal(assets.some(name => name.startsWith('chatgpt/')), false);
  assert.equal(assets.some(name => /\.(zip|gz)$/.test(name)), false);
});

test('the service worker answers only its own files, so the download pages in its scope reach the network', () => {
  const handlers = {};
  const worker = { location: new URL('https://example.test/DiPlay/sw.js'), addEventListener: (type, handler) => { handlers[type] = handler; } };
  const cache = { match: async () => new Response('cached') };
  new Function('self', 'caches', 'fetch', read('sw.js'))(worker, { open: async () => cache }, async () => new Response('network'));
  const answers = (url, method = 'GET') => {
    let answered = false;
    handlers.fetch({ request: { method, url }, respondWith: () => { answered = true; } });
    return answered;
  };
  for (const url of ['https://example.test/DiPlay/', 'https://example.test/DiPlay/?t=100.64.0.1', 'https://example.test/DiPlay/index.html',
    'https://example.test/DiPlay/app.js?v=2', 'https://example.test/DiPlay/decoder-worker.js', 'https://example.test/DiPlay/icon.svg',
    // The pairing link: a navigation's request URL keeps its fragment.
    'https://example.test/DiPlay/#c=1234', 'https://example.test/DiPlay/?t=100.64.0.1#c=1234']) {
    assert.ok(answers(url), url);
  }
  for (const url of ['https://example.test/DiPlay/chatgpt/', 'https://example.test/DiPlay/chatgpt/app.js',
    'https://example.test/DiPlay/download/', 'https://example.test/DiPlay/download/zh-Hans/',
    'https://example.test/DiPlay/download/assets/site.css', 'https://example.test/DiPlay/download/index.html',
    'https://example.test/DiPlay/download/#install', 'https://example.test/DiPlay/play/', 'https://example.test/DiPlay/play/#c=1234',
    'https://example.test/DiPlay/play/sw.js', 'https://example.test/DiPlay/sw.js',
    'https://example.test/DiPlay/app.js/', 'https://example.test/app.js', 'https://other.test/DiPlay/app.js',
    'http://100.109.220.253:8080/hello', 'http://100.109.220.253:8080/play/app.js']) {
    assert.ok(!answers(url), url);
  }
  assert.ok(!answers('https://example.test/DiPlay/', 'POST'));
});

test('the page loads only relative, same-origin resources', () => {
  const html = read('index.html');
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (url === 'https://github.com/uJZk/TiPlay/releases') continue; // product version link
    assert.match(url, /^[a-z][\w./-]*$/, url);
  }
  for (const name of ['app.js', 'decoder-worker.js', 'style.css']) {
    assert.doesNotMatch(read(name), /(?:import|from|url\()\s*['"(]?(?:https?:)?\/\//, name);
  }
});


test('browser settings uses the Android product version without a playback overlay', () => {
  const properties = readFileSync(new URL('../../gradle.properties', import.meta.url), 'utf8');
  assert.equal(APP_VERSION, /^tiplayVersionName=(.+)$/m.exec(properties)[1]);
  const html = read('index.html');
  assert.match(html, /<footer><a id="page-version" href="https:\/\/github.com\/uJZk\/TiPlay\/releases"><\/a><\/footer>/);
  assert.doesNotMatch(html, /<small id="page-version"/);
  assert.doesNotMatch(read('style.css'), /#page-version\s*\{[^}]*position:fixed/);
});


test('retired outbox senders cannot use the current session or its peer', async () => {
  const source = read('app.js');
  const control = /async function postControl\([^\n]*\) \{([\s\S]*?)\n\}/.exec(source)[0];
  const calls = [];
  const post = new Function('calls', `
    const active = true, session = 'new-owner';
    const rtcMedia = { isConnected: () => true, control: (...args) => { calls.push(args); return { q: args[0] }; } };
    const locationEvents = events => events, controlWaiters = new Set(), controlClock = null;
    ${control}
    return postControl;
  `)(calls);
  await assert.rejects(post(1, [{ k: 't', p: [[0, 0.5, 0.5, 1]] }], 'retired-owner'), /owner retired/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await post(2, [], 'new-owner'), { q: 2 });
});


test('a failed connection attempt cancels its unresolved SRP exchange before scheduling retry', async () => {
  const connect = /async function connectVideo\(\) \{([\s\S]*?)\n\}/.exec(read('app.js'))[0];
  const run = new Function('abortable', `
    let streamId = 0, rtcMedia = null, retryTimer, retryCountdownTimer, videoAbort, live, phase, lastError, lastViewport;
    let rtcProgress, resourceToken, controlClock;
    const faultDiagnostics = { reset() {} };
    const session = 'owner', link = { code: '1234' }, controlWaiters = new Set();
    let aborted = false, retries = 0, exchangeCalled = false;
    const sink = { stop() {}, clock() {} }, browserAudio = { clock() {} }, codecsReady = Promise.resolve('avc1');
    const videoPath = {}, render = () => {}, reportDiagnostics = () => {}, backoffDelay = () => 500;
    const scheduleRetry = () => retries++;
    let attempt = 0, mediaTiming;
    const timing = { reset() {}, mode() {} }, mediaTimings = new Map([['carplay', timing]]), timingFor = () => timing;
    const createClockEstimator = () => ({ observe: () => null });
    const phoneFetch = () => { throw new Error('Unexpected plaintext bootstrap.'); };
    const authenticateRtcOffer = ({ signal }) => {
      exchangeCalled = true;
      return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }));
    };
    const createRtcMediaTransport = options => ({ connect: async () => {
      options.exchange('offer').catch(() => {});
      throw Object.assign(new Error('connect-timeout'), { reason: 'connect-timeout' });
    } });
    ${connect}
    return connectVideo().then(() => ({ exchangeCalled, aborted, retries }));
  `);
  assert.deepEqual(await run(abortable), { exchangeCalled: true, aborted: true, retries: 1 });
});

test('controls wait for authenticated RTC and cannot cross ownership changes during that wait', async () => {
  const control = /async function postControl\([^\n]*\) \{([\s\S]*?)\n\}/.exec(read('app.js'))[0];
  const calls = [];
  const fixture = new Function('calls', `
    let active = true, session = 'old-owner', rtcMedia = null, controlClock = null;
    const controlWaiters = new Set(), locationEvents = events => events;
    ${control}
    return { postControl, pending: () => controlWaiters.size,
      ready(owner) { session = owner; rtcMedia = { isConnected: () => true, control: (...args) => { calls.push(args); return { q: args[0] }; } };
        for (const waiter of controlWaiters) waiter.resolve(); controlWaiters.clear(); } };
  `)(calls);
  const pending = fixture.postControl(1, [{ k: 't', p: [[0, .5, .5, 1]] }], 'old-owner');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.pending(), 1); assert.deepEqual(calls, []);
  fixture.ready('new-owner');
  await assert.rejects(pending, /owner retired/); assert.deepEqual(calls, []);
  assert.deepEqual(await fixture.postControl(2, [], 'new-owner'), { q: 2 });
});
