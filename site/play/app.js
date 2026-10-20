/*! SPDX-License-Identifier: GPL-3.0-only
 * Adapted from WheelPlay (https://github.com/fython/wheelplay), GPL-3.0-only,
 * common/src/main/assets/web/app.js at commit c1bd077 (pointer handling, viewport report, reconnect loop, stats getter).
 * Modified for TiPlay, 2026-10. Source code: https://github.com/uJZk/TiPlay
 *
 * Main thread of the TiPlay browser link (protocol v1). Authenticated local WebRTC carries application media.
 * On the Tesla path its video stream is transferred to decoder-worker.js, which draws on the
 * transferred canvas; other browsers take a later rung of the fallback ladder (link.js choosePath). */
import {
  DEFAULT_HOST, PROTOCOL, addressSpaceFor, backoffDelay, choosePath, createControlOutbox, createTouchSlots,
  isCode, linkFromAddress, linkLocation, mapPoint, newSessionId, normalizeHost, supportedCodecs,
  viewportFor,
} from './link.js';
import { connectRtc, createRtcAudioSource } from './rtc-transport.js';
import { authenticateRtcOffer } from './rtc-pairing.js';
import { APP_VERSION } from './app-version.js';
import { createLocationNotice } from './location-notice.js';
import { createBrowserLocation, locationEvents } from './geolocation.js';
import { followAppearance } from './appearance.js';
import { probeMirrorCapabilities, probeMirrorAudioFormats } from './airplay-capabilities.js';
import { createReconnectOverlay } from './reconnect.js';
import { pumpChunkStream } from './transport.js';
import { formatPerformanceMonitor, performanceStats } from './fps-window.js';
import { createClockEstimator } from './clock-sync.js';
import { createMediaTiming, createTimedFrames, createVideoEpochGuard } from './media-timing.js';
import { createBrowserAudio } from './audio.js';
import { createAirPlayControls } from './airplay-controls.js';
import { createAirPlayTrustNotification } from './airplay-trust.js';
import { createBrowserNotice } from './browser-notice.js';
import { browserDiagnosticEvents, PAGE_VERSION } from './browser-diagnostics.js';
import { rtcFailureReason, rtcFailureSummary } from './rtc-diagnostics.js';
import { createVideoDiagnosticTracker, safeSenderDiagnostics } from './video-diagnostics.js';

const STRINGS = {
  en: {
    heading: 'Connect to TiPlay',
    intro: 'Connect this screen and your Android device to the same network. Enter the code shown in TiPlay to display CarPlay.',
    codeLabel: 'Pairing code',
    hostLabel: 'Android device address',
    hostHelp: 'Use the address shown in TiPlay, including the port. Leave blank to use 169.254.111.111:8080.',
    resume: 'Return to CarPlay',
    resizeHelp: 'The picture follows this window and reconnects automatically when needed.',
    connect: 'Connect',
    disconnect: 'Disconnect',
    settings: 'Setting',
    stats: 'Performance monitor',
    statsLabel: 'Performance monitor: codec, current FPS, current Delta, dropped frames',
    fit: 'Apply and reconnect',
    fitPending: 'Reconnecting…',
    source: 'TiPlay',
    enterCode: 'Enter the pairing code to connect.',
    ready: 'Ready to connect.',
    stopped: 'Disconnected.',
    connecting: 'Connecting to the Android device…',
    rtcLocalIce: 'Preparing this browser’s direct connection…',
    rtcPairing: 'Contacting Android and verifying the pairing code…',
    rtcRemoteIce: 'Android verified. Opening the direct data channels…',
    rtcAuth: 'Data channels open. Authenticating the media session…',
    rtcConnected: 'Connection established. Preparing playback…',
    rtcCandidates: 'Candidate totals: browser {0}, Android {1}.',
    rtcBrowserClasses: 'Browser: {0}.',
    rtcAndroidClasses: 'Android: {0}.',
    rtcPrivateIpv4: 'private IPv4',
    rtcCgnatIpv4: 'CGNAT IPv4',
    rtcLinkLocal: 'link-local IPv4',
    rtcStates: 'ICE {0}, peer {1}; DC video/audio/control {2}/{3}/{4}.',
    rtcAndroidNoCandidates: 'Android’s answer contains no ICE candidates; no Android candidate is available for the direct connection.',
    rtcFetch: 'Cannot reach the Android HTTP service. Check the address and local-network permission.',
    rtcMissingInterface: 'Android has no WebRTC pairing interface. Check that the matching test APK is installed.',
    rtcAndroidSignaling: 'Android could not prepare the WebRTC connection. Check its diagnostic report.',
    rtcPairingFailed: 'The phone’s pairing verification failed. Re-enter the current pairing code.',
    rtcBadResponse: 'Android returned an invalid pairing response.',
    rtcIceFailed: 'The direct ICE/data-channel connection failed.',
    rtcUnsupported: 'This browser does not provide WebRTC data channels.',
    rtcConnectionFailed: 'The connection failed at this stage.',
    rtcLocalTimeout: 'The browser’s local ICE candidate collection timed out.',
    rtcPairingTimeout: 'Contacting and verifying Android timed out.',
    rtcRemoteTimeout: 'Android was verified, but opening ICE/data channels timed out.',
    rtcAuthTimeout: 'The data channels opened, but session authentication timed out.',
    rtcRetryDetail: '{0} Last stage: {1} Retrying in {2} s…',
    unreachable: 'The Android device does not answer. Retrying in {0} s…',
    lost: 'Connection lost. Retrying in {0} s…',
    throttled: 'Too many wrong pairing codes. Retrying in {0} s…',
    waitingPhone: 'Connected to the Android device. Waiting for the iPhone…',
    phoneConnecting: 'CarPlay is connecting…',
    waitingVideo: 'AirPlay is connecting…',
    waitingFrame: 'Waiting for the CarPlay picture…',
    waitingSource: 'Connected to the Android device. Waiting for a projection…',
    carPlayPreparing: 'CarPlay is preparing…',
    carPlayDisabled: 'CarPlay is disabled.',
    carPlayFailed: 'CarPlay connection failed.',
    carPlayRecovering: 'CarPlay is reconnecting…',
    carPlayStopping: 'CarPlay is disconnecting…',
    carPlayBlocked: 'CarPlay is waiting for setup or permission.',
    pictureUnavailable: 'Picture unavailable.',
    airPlayAudio: 'AirPlay audio.',
    airPlayPhoto: 'AirPlay photo.',
    airPlayPlaying: 'AirPlay is playing.',
    airPlayPaused: 'AirPlay is paused.',
    airPlayBuffering: 'AirPlay is buffering…',
    streaming: '{0} · {1} fps',
    badCode: 'The pairing code is wrong. Check it in TiPlay on the Android device.',
    replaced: 'Another browser took over the display. Connect again to take it back.',
    protocol: 'TiPlay on the Android device does not match this page. Update the app.',
    unsupported: 'This browser cannot decode {0}.',
    unsupportedHevc: 'This browser cannot decode this HEVC stream. Reconnect to report decoder support again.',
    unsupportedHdr: 'AirPlay mirroring requires SDR video; this source sends HDR.',
    noVideo: 'This browser cannot show the video ({0}). Open the page over HTTPS in a browser with WebCodecs support.',
    invalidCode: 'Enter the 4-digit pairing code.',
    invalidHost: 'Enter an IPv4 address with port, for example 169.254.111.111:8080.',
  },
  zh: {
    heading: '连接 TiPlay',
    intro: '让这块屏幕与安卓端连接同一网络，输入 TiPlay 显示的配对码，即可显示 CarPlay。',
    codeLabel: '配对码',
    hostLabel: '安卓端地址',
    hostHelp: '填写 TiPlay 显示的地址，包含端口；留空使用 169.254.111.111:8080。',
    resume: '返回 CarPlay',
    resizeHelp: '画面随窗口调整，必要时自动重新连接。',
    connect: '连接',
    disconnect: '断开',
    settings: '设置',
    stats: '性能监视器',
    statsLabel: '性能监视器：编码、当前 FPS、当前 Delta、丢帧计数',
    fit: '应用并重新连接',
    fitPending: '正在重新连接…',
    source: 'TiPlay',
    enterCode: '输入配对码后连接。',
    ready: '可以连接。',
    stopped: '已断开。',
    connecting: '正在连接安卓端…',
    rtcLocalIce: '正在准备车机浏览器的直连候选地址…',
    rtcPairing: '正在联系安卓端并验证配对码…',
    rtcRemoteIce: '安卓端已通过验证，正在建立 ICE / 数据通道…',
    rtcAuth: '数据通道已打开，正在认证媒体会话…',
    rtcConnected: '连接已建立，正在准备播放…',
    rtcCandidates: '候选总数：浏览器 {0}，安卓端 {1}。',
    rtcBrowserClasses: '浏览器分类：{0}。',
    rtcAndroidClasses: '安卓分类：{0}。',
    rtcPrivateIpv4: '私有 IPv4',
    rtcCgnatIpv4: 'CGNAT IPv4',
    rtcLinkLocal: '链路本地 IPv4',
    rtcStates: 'ICE {0}，Peer {1}；DC 视频/音频/控制 {2}/{3}/{4}。',
    rtcAndroidNoCandidates: '安卓端响应中没有 ICE 候选，当前没有可用于直连的安卓候选。',
    rtcFetch: '无法访问安卓端 HTTP 服务，请检查地址和本地网络访问权限。',
    rtcMissingInterface: '安卓端缺少 WebRTC 配对接口，请确认安装了配套测试 APK。',
    rtcAndroidSignaling: '安卓端未能准备 WebRTC 连接，请查看安卓端诊断报告。',
    rtcPairingFailed: '安卓端的配对校验未通过，请重新输入当前配对码。',
    rtcBadResponse: '安卓端返回了无效的配对响应。',
    rtcIceFailed: 'ICE / 数据通道直连失败。',
    rtcUnsupported: '此浏览器未提供 WebRTC 数据通道。',
    rtcConnectionFailed: '连接在此阶段失败。',
    rtcLocalTimeout: '浏览器收集本机 ICE 候选地址超时。',
    rtcPairingTimeout: '联系安卓端或验证配对超时。',
    rtcRemoteTimeout: '安卓端已验证，但建立 ICE / 数据通道超时。',
    rtcAuthTimeout: '数据通道已打开，但媒体会话认证超时。',
    rtcRetryDetail: '{0} 最后阶段：{1} {2} 秒后重试…',
    unreachable: '安卓端没有响应，{0} 秒后重试…',
    lost: '连接中断，{0} 秒后重试…',
    throttled: '配对码错误次数过多，{0} 秒后重试…',
    waitingPhone: '已连接安卓端，等待 iPhone…',
    phoneConnecting: 'CarPlay 正在连接…',
    waitingVideo: 'AirPlay 正在连接…',
    waitingFrame: '正在等待 CarPlay 画面…',
    waitingSource: '已连接安卓端，等待投屏…',
    carPlayPreparing: 'CarPlay 正在准备…',
    carPlayDisabled: 'CarPlay 已禁用。',
    carPlayFailed: 'CarPlay 连接失败。',
    carPlayRecovering: 'CarPlay 正在重新连接…',
    carPlayStopping: 'CarPlay 正在断开连接…',
    carPlayBlocked: 'CarPlay 等待设置或授权。',
    pictureUnavailable: '画面暂不可用。',
    airPlayAudio: 'AirPlay 音频。',
    airPlayPhoto: 'AirPlay 照片。',
    airPlayPlaying: 'AirPlay 正在播放。',
    airPlayPaused: 'AirPlay 已暂停。',
    airPlayBuffering: 'AirPlay 正在缓冲…',
    streaming: '{0} · {1} fps',
    badCode: '配对码不正确，请在安卓端上的 TiPlay 中核对。',
    replaced: '另一个浏览器接管了画面。再次连接即可收回。',
    protocol: '安卓端上的 TiPlay 与本页不匹配，请更新应用。',
    unsupported: '此浏览器无法解码 {0}。',
    unsupportedHevc: '此浏览器无法解码此 HEVC 视频流，请重新连接以再次汇报解码能力。',
    unsupportedHdr: 'AirPlay 镜像需要 SDR 视频，当前来源发送的是 HDR。',
    noVideo: '此浏览器无法显示画面（{0}）。请使用支持 WebCodecs 的浏览器通过 HTTPS 打开本页。',
    invalidCode: '请输入 4 位配对码。',
    invalidHost: '请输入带端口的 IPv4 地址，例如 169.254.111.111:8080。',
  },
};
const lang = /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
const t = (key, ...args) => (STRINGS[lang][key] ?? STRINGS.en[key]).replace(/\{(\d)\}/g, (_, index) => args[index]);
const CODEC_NAMES = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', vp8: 'VP8', vp09: 'VP9', av01: 'AV1' };
const LINK_KEY = 'tiplay.link', STATS_KEY = 'tiplay.stats';
const $ = id => document.getElementById(id);
const videoDiagnosticTracker = createVideoDiagnosticTracker();
const browserNotice = createBrowserNotice($('browser-notice'), lang);
const stage = $('stage'), touch = $('touch');
const codecName = codec => CODEC_NAMES[String(codec).split('.')[0]] ?? codec;
const renderReconnect = createReconnectOverlay({
  overlay: $('reconnect'), message: $('reconnect-message'), settings: $('reconnect-settings'),
  panel: $('panel'), stage, onSettings: showPortal,
});

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
$('stats').setAttribute('aria-label', t('statsLabel'));
$('page-version').textContent = `TiPlay ${APP_VERSION} · ${PAGE_VERSION}`;

function loadLink() {
  try {
    const saved = JSON.parse(localStorage.getItem(LINK_KEY) || 'null');
    return { host: normalizeHost(saved?.host) ?? DEFAULT_HOST, code: isCode(saved?.code) ? saved.code : null };
  } catch (_) {
    return { host: DEFAULT_HOST, code: null };
  }
}

function saveLink() {
  try { localStorage.setItem(LINK_KEY, JSON.stringify(link)); } catch (_) {}
}

let link = loadLink();
const addressed = linkFromAddress(location.search, location.hash, link);
if (addressed) {
  link = addressed;
  saveLink();
}
// `?t=` keeps a phone other than the default in bookmarks; the pairing code stays out of history entries and copied URLs.
const showLink = () => history.replaceState(null, '', linkLocation(location.pathname, location.search, link.host));
showLink();

const slots = createTouchSlots();
let session = null, active = false, phase = 'ready', notice = null;
let attempt = 0, reconnects = 0, retryTimer = null, retryAt = 0, streamId = 0, videoAbort = null, lastError = null;
let retryCountdownTimer = null, rtc = null, rtcAudio = null, resourceToken = null, rtcProgress = null;
let config = null, live = false, status = null, unsupported = null, videoStats = {};
let outbox = null, heartbeatTimer = null, statsTimer = null, viewportFrame = null, lastViewport = '';
const locationNotice = createLocationNotice($('location-notice'), lang);
const browserLocation = createBrowserLocation({
  onIssue: reason => locationNotice.show(reason),
  push: event => outbox?.push(event, 'latest'), navigator,
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  secure: window.isSecureContext,
});
const appearance = window.matchMedia('(prefers-color-scheme: dark)');
const reportAppearance = followAppearance(appearance, () => outbox);
const mediaTimings = new Map();
let mediaTiming;
function timingFor(mode) {
  let timing = mediaTimings.get(mode);
  if (!timing) {
    timing = createMediaTiming(delay => {
      browserAudio.delay(delay, mode);
      if (mediaTiming === timing) sink?.delay?.(delay);
    });
    mediaTimings.set(mode, timing);
    timing.mode(mode);
  }
  return timing;
}
const browserAudio = createBrowserAudio({
  onMode: mode => {
    const timing = timingFor(mode);
    if (!config) { mediaTiming = timing; sink?.delay?.(timing.plans()); }
  },
  onTiming: (source, mode) => timingFor(mode).observe('audio', source),
  onQueued: mode => timingFor(mode).started(),
  onAudioReference: reference => sink?.audio(reference),
  fetchPhone: audioFetch, credentials: () => ({ code: '', session }),
});
mediaTiming = timingFor('carplay');
// Pairing, touching CarPlay and using page controls already provide activation.
// Resume playback on ordinary page gestures when autoplay is restricted.
document.addEventListener('pointerdown', () => browserAudio.gesture(), { capture: true, passive: true });
document.addEventListener('keydown', () => browserAudio.gesture(), { capture: true });
const airplayControls = createAirPlayControls($('stage'), event => outbox?.push(event), lang, { fetchPhone: phoneFetch, credentials: () => ({ code: resourceToken ?? '', session }), host: () => link.host });
const airplayTrust = createAirPlayTrustNotification($('airplay-trust'), event => outbox?.push(event), lang);
browserAudio.start();
let movePending = false, moveGeneration = 0, fitRequestedAt = 0, wakeLock = null, resumeOnShow = false;
let statsVisible = false;
try { statsVisible = localStorage.getItem(STATS_KEY) === '1'; } catch (_) {}

// The video path: feature detection only, never the user agent. `sink` opens response bodies on the chosen path.
let videoPath = { path: 'pending', reason: null }, sink = null, probedCodecs = '';
const pathReady = setUpVideo().catch(error => {
  videoPath = { path: 'none', reason: String(error?.message ?? error) };
});
const codecsReady = pathReady.then(async () => {
  let names = [];
  if (videoPath.decode === 'worker' || videoPath.decode === 'main') names = await supportedCodecs(config => VideoDecoder.isConfigSupported(config));
  probedCodecs = names.join(',');
  return probedCodecs;
});

function streamsTransferable() {
  try {
    const stream = new ReadableStream(), channel = new MessageChannel();
    channel.port1.postMessage(stream, [stream]);
    channel.port1.close();
    channel.port2.close();
    return true;
  } catch (_) {
    return false;
  }
}

/** Starts the decoder worker; resolves with it and whether it has VideoDecoder, or null when module workers fail. */
function startWorker() {
  return new Promise(resolve => {
    let worker;
    try {
      worker = new Worker(new URL('decoder-worker.js', import.meta.url), { type: 'module' });
    } catch (_) {
      resolve(null);
      return;
    }
    const fail = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };
    // Generous: on a first visit over a slow link the worker's modules still have to download.
    const timer = setTimeout(fail, 15000);
    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (data.type !== 'ready') return;
      clearTimeout(timer);
      worker.onerror = null;
      worker.onmessage = null;
      resolve({ worker, videoDecoder: data.videoDecoder });
    };
  });
}

async function setUpVideo() {
  const features = {
    secureContext: window.isSecureContext === true,
    videoDecoder: typeof VideoDecoder === 'function',
    workerVideoDecoder: false,
    offscreenCanvas: typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function',
    transferableStreams: streamsTransferable(),
  };
  const started = features.secureContext && features.videoDecoder ? await startWorker() : null;
  features.workerVideoDecoder = Boolean(started?.videoDecoder);
  videoPath = choosePath(features);
  const path = videoPath;
  if (started && path.decode !== 'worker') started.worker.terminate();
  const canvas = $('screen');
  const firstPresented = config => onVideoMessage({ type: 'decoded', id: config.streamId, epoch: config.epoch });
  if (path.decode === 'worker') {
    const { worker } = started;
    let presenter = null;
    if (path.draw === 'worker') {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
    } else {
      presenter = (await import('./video.js')).createFramePresenter(canvas, { applyTimingPolicy: true, pace: true, onFirstPresent: firstPresented });
    }
    const presentationEpochs = createVideoEpochGuard(() => presenter?.close());
    worker.onmessage = ({ data }) => {
      if (active && data.id === streamId) presentationEpochs.message(data);
      if (data.type === 'frame') {
        try {
          if (active && data.id === streamId) presenter.present(data.frame, data.config, data.timing, data.outputWindow);
          else data.frame.close();
        } finally {
          worker.postMessage({ type: 'frame-ack', frameId: data.frameId });
        }
      }
      else if (data.type === 'stats') onVideoMessage({ type: 'stats', id: data.id, stats: { ...data.stats, ...presenter?.stats() } });
      else if (data.type === 'idle') {
        if (active && data.id === streamId) presenter?.close();
        onVideoMessage(data);
      }
      else onVideoMessage(data);
    };
    worker.onerror = () => stop('noVideo', 'decoder worker failed');
    sink = {
      clock(clock) { worker.postMessage({ type: 'clock', clock }); },
      audio(reference) { presenter?.audio(reference); worker.postMessage({ type: 'audio-output', reference }); },
      touch() { worker.postMessage({ type: 'touch' }); },
      open(id, body, signal) {
        if (path.feed === 'stream') worker.postMessage({ type: 'stream', id, stream: body }, [body]);
        else {
          const channel = new MessageChannel();
          worker.postMessage({ type: 'feed', id, port: channel.port2 }, [channel.port2]);
          pumpChunkStream(body, channel.port1, signal);
        }
      },
      stop() { worker.postMessage({ type: 'stop' }); presenter?.close(); },
      dispose() { worker.postMessage({ type: 'dispose' }); presenter?.dispose(); },
      resize: (width, height) => (presenter ? presenter.resize(width, height) : worker.postMessage({ type: 'resize', width, height })),
    };
  } else if (path.decode === 'main') {
    const { createDecoderPipeline, createFramePresenter } = await import('./video.js');
    const presenter = createFramePresenter(canvas, { applyTimingPolicy: true, pace: true, onFirstPresent: firstPresented });
    const frames = createTimedFrames((frame, config, id, timing, outputWindow) => presenter.present(frame, config, timing, outputWindow), {
      observe(source, ready) { mediaTiming.observe('video', source, ready); },
    });
    const epochs = createVideoEpochGuard(() => { frames.reset(); presenter.close(); });
    const pipeline = createDecoderPipeline({ post: message => {
      epochs.message(message);
      onVideoMessage(message);
    }, present: frames.present });
    let timer = null;
    const stop = () => { clearInterval(timer); epochs.reset(); pipeline.stop(); };
    sink = {
      clock: pipeline.clock,
      audio(reference) { presenter.audio(reference); frames.audio(reference); },
      delay(plans) { frames.delay(plans.video); },
      touch() { frames.touch(); },
      open(id, body) {
        stop();
        pipeline.read(id, body);
        timer = setInterval(() => onVideoMessage({ type: 'stats', id, stats: { ...pipeline.stats(), ...frames.stats(), ...presenter.stats() } }), 1000);
      },
      stop,
      dispose() { stop(); presenter.dispose(); },
      resize: presenter.resize,
    };
  }
}

function phoneFetch(route, init = {}) {
  return fetch(`http://${link.host}${route}`, {
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', targetAddressSpace: addressSpaceFor(link.host), ...init,
  });
}

function audioFetch(route, init = {}) {
  if (!rtcAudio || init.signal?.aborted) return Promise.reject(new Error('RTC audio unavailable'));
  const body = rtcAudio.open(init.signal);
  return Promise.resolve(new Response(body, { status: 200 }));
}

let portalRevision = null;

function showPortal() {
  releaseTouches();
  cancelViewport();
  stage.hidden = true;
  $('panel').hidden = false;
  render();
}

function resumeCarPlay() {
  $('panel').hidden = true;
  stage.hidden = false;
  onResize();
  render();
}

function start() {
  if (active || videoPath.path === 'none') return;
  browserNotice.reset();
  cancelViewport();
  portalRevision = null;
  // A fresh session id per start lets "Connect" take the display back after another browser replaced this one.
  session = newSessionId();
  active = true;
  notice = null;
  attempt = 0;
  reconnects = 0;
  lastError = null;
  status = null;
  config = null;
  unsupported = null;
  airplayControls.update(null);
  airplayTrust.clear();
  live = false;
  lastViewport = '';
  fitRequestedAt = 0;
  $('panel').hidden = true;
  stage.hidden = false;
  outbox = createControlOutbox({ send: postControl, maxInFlight: 8, heldContacts: () => slots.contacts(), onStatus: applyStatus, onError: controlFailed });
  reportAppearance();
  heartbeatTimer = setInterval(() => outbox.heartbeat(), 400);
  statsTimer = setInterval(() => {
    for (const event of browserDiagnosticEvents(pageStats(), appearance.matches, status?.debug === true, status?.debugSession, videoDiagnosticTracker)) outbox.push(event, 'latest');
  }, 5000);
  outbox.heartbeat();
  resizeCanvas();
  scheduleViewport();
  keepScreenOn();
  connectVideo();
}

function stop(key = null, ...args) {
  cancelViewport();
  notice = key ? { key, args } : null;
  active = false;
  browserAudio.stop();
  airplayControls.update(null);
  airplayTrust.clear();
  phase = 'ready';
  streamId++;
  clearTimeout(retryTimer);
  clearInterval(heartbeatTimer);
  clearInterval(retryCountdownTimer);
  clearInterval(statsTimer);
  videoAbort?.abort();
  rtc?.close(); rtc = null; rtcAudio?.close(); rtcAudio = null; resourceToken = null;
  sink?.stop();
  cancelMove();
  slots.releaseAll();
  browserLocation.stop();
  outbox?.close();
  outbox = null;
  status = null;
  live = false;
  wakeLock?.then(lock => lock?.release()).catch(() => {});
  wakeLock = null;
  $('panel').hidden = false;
  stage.hidden = true;
  render();
}

function sendBye() {
  rtc?.bye();
}

async function connectVideo() {
  const id = ++streamId;
  sink?.stop();
  clearTimeout(retryTimer);
  clearInterval(retryCountdownTimer);
  videoAbort?.abort();
  rtc?.close(); rtc = null; rtcAudio?.close(); rtcAudio = null; resourceToken = null;
  live = false;
  phase = 'connecting';
  rtcProgress = null;
  render();
  const abort = videoAbort = new AbortController();
  try {
    const codecs = await codecsReady;
    if (id !== streamId) return;
    if (!sink) { stop('noVideo', videoPath.reason); return; }
    const clockEstimator = createClockEstimator();
    const clockStart = performance.timeOrigin + performance.now();
    const connected = await connectRtc({
      fetchPhone: phoneFetch, session, code: link.code, codecs, signal: abort.signal,
      authenticateOffer: authenticateRtcOffer,
      onProgress(progress) {
        if (active && id === streamId && !abort.signal.aborted) { rtcProgress = progress; render(); }
      },
      onClose(error) {
        if (active && id === streamId && !abort.signal.aborted) {
          lastError = error; streamEnded('network', error);
        }
      },
    });
    if (id !== streamId) { connected.close(); return; }
    rtc = connected;
    const hello = connected.hello;
    if (hello.app !== 'TiPlay' || hello.protocol !== PROTOCOL) { stop('protocol'); return; }
    resourceToken = hello.resourceToken ?? null;
    // The authenticated clock RPC avoids treating ICE/DTLS setup time as clock uncertainty.
    const clockReplyStart = performance.timeOrigin + performance.now();
    const sample = await connected.clock();
    if (id !== streamId) return;
    const clock = clockEstimator.observe(sample.clockMs, clockReplyStart, performance.timeOrigin + performance.now());
    if (!clock && Number.isFinite(hello.clockMs)) clockEstimator.observe(hello.clockMs, clockStart, performance.timeOrigin + performance.now());
    sink.clock(clockEstimator.snapshot()); browserAudio.clock(clockEstimator.snapshot());
    for (const [mode, timing] of mediaTimings) { timing.reset(); timing.mode(mode); }
    mediaTiming = timingFor('carplay');
    rtcAudio = createRtcAudioSource(connected.audio);
    sink.open(id, connected.video, abort.signal);
    browserAudio.attach(abort.signal, hello);
    let busy = false;
    const clockTimer = setInterval(async () => {
      if (busy || abort.signal.aborted) return;
      busy = true;
      try {
        for (let probe = 0; probe < 3; probe++) {
          const start = performance.timeOrigin + performance.now();
          const response = await connected.clock();
          clockEstimator.observe(response.clockMs, start, performance.timeOrigin + performance.now());
        }
        if (!abort.signal.aborted && id === streamId) {
          const estimate = clockEstimator.snapshot();
          if (estimate) { sink?.clock(estimate); browserAudio.clock(estimate); }
        }
      } catch (_) { /* Expired samples remain unavailable rather than inventing a source clock. */ }
      finally { busy = false; }
    }, 5000);
    abort.signal.addEventListener('abort', () => clearInterval(clockTimer), { once: true });
    if (hello.status) applyStatus(hello.status);
    reportAppearance(); phase = 'waiting'; lastViewport = ''; scheduleViewport(); render();
  } catch (error) {
    if (id !== streamId || abort.signal.aborted || !active) return;
    error.rtcReason = rtcFailureReason(error);
    if (!error.rtcDiagnostic && rtcProgress) error.rtcDiagnostic = rtcProgress;
    if (error.status === 401) stop('badCode');
    else if (error.status === 409) stop('replaced');
    else { lastError = error; scheduleRetry(error.status === 429 ? 30000 : backoffDelay(attempt++)); }
  }
}

function streamEnded(reason, error = null) {
  sink?.stop();
  videoAbort?.abort();
  live = false;
  releaseTouches();
  if (reason === 'replaced') {
    stop('replaced');
    return;
  }
  lastError = error;
  scheduleRetry(backoffDelay(attempt++));
}

function scheduleRetry(delay) {
  phase = 'retry';
  retryAt = Date.now() + delay;
  clearTimeout(retryTimer);
  clearInterval(retryCountdownTimer);
  retryCountdownTimer = setInterval(render, 1000);
  retryTimer = setTimeout(() => {
    reconnects++;
    connectVideo();
  }, delay);
  render();
}

async function postControl(q, events) {
  if (!rtc) throw new Error('RTC control is connecting');
  const outgoing = locationEvents(events);
  if (outgoing.some(event => event.k === 't')) sink?.touch?.();
  return rtc.control(q, outgoing);
}

function applyStatus(next) {
  browserLocation.update(next.location);
  airplayTrust.update(next.airplayTrust);
  if (next.debugSession !== status?.debugSession) browserAudio.debug(false);
  browserAudio.status(next);
  airplayControls.update(next.airplay);
  if (Number.isSafeInteger(next.portalRevision)) {
    if (portalRevision !== null && next.portalRevision !== portalRevision) showPortal();
    portalRevision = next.portalRevision;
  }
  status = next;
  if (!next.fit || Date.now() - fitRequestedAt > 15000) fitRequestedAt = 0;
  render();
}

function controlFailed(error) {
  if (error.status === 401) stop('badCode');
  else if (error.status === 409) stop('replaced');
}

function onVideoMessage(message) {
  if (!active || message.id !== streamId) return;
  if (message.type === 'media-ready') {
    mediaTiming.observe('video', message.source, message.ready);
    return;
  }
  if (message.type === 'alive' && message.id === streamId) attempt = 0;
  else if (message.type === 'config') {
    mediaTiming = timingFor(message.config.mode);
    sink?.delay?.(mediaTiming.plans());
    // Audio has its own ordered per-type reset/epoch. Its HTTP response may deliver
    // the new producer's PCM before this config, so video cannot clear that audio.
    if (config?.epoch !== message.config.epoch) videoStats = {};
    config = message.config;
    unsupported = null;
  } else if (message.type === 'idle') {
    config = null;
    live = false;
    unsupported = null;
    videoStats = {};
  } else if (message.type === 'unsupported') {
    unsupported = message.reason === 'hdr' ? 'hdr' : message.codec;
    live = false;
  } else if (message.type === 'decoded') {
    if (message.epoch !== config?.epoch) return;
    mediaTiming.started();
    live = true;
    outbox?.push({ k: 'dec', ep: message.epoch }, 'latest'); // repeated if its POST fails: the phone's connection proof
    keepScreenOn();
  } else if (message.type === 'keyframe') outbox?.push({ k: 'kf' }, 'latest');
  else if (message.type === 'end' && message.id === streamId) streamEnded(message.reason);
  else if (message.type === 'stats') videoStats = performanceStats({ ...message.stats,
    streamGeneration: message.id, transferDroppedFrames: message.stats.transferDroppedFrames ?? 0 });
  render();
}

function render() {
  $('disconnect').hidden = !active;
  $('stats-toggle').setAttribute('aria-checked', String(statsVisible));
  $('fit').hidden = !(active && status?.fit === true);
  $('fit').disabled = fitRequestedAt > 0;
  $('fit').textContent = t(fitRequestedAt ? 'fitPending' : 'fit');
  const text = statusText();
  const inlineNotice = !active && ['badCode', 'invalidCode', 'invalidHost'].includes(notice?.key);
  let problem = !active && notice && notice.key !== 'stopped' && !inlineNotice
    ? { id: notice.key, text: t(notice.key, ...notice.args) } : null;
  if (active && unsupported) {
    const key = unsupported === 'hdr' ? 'unsupportedHdr' : /^(hvc1|hev1)\b/.test(unsupported) ? 'unsupportedHevc' : 'unsupported';
    problem = { id: `codec:${unsupported}`, text: t(key, codecName(unsupported)) };
  }
  browserNotice.update(problem);
  $('message').textContent = inlineNotice ? t(notice.key, ...notice.args) : '';
  $('status').textContent = text;
  $('status').hidden = Boolean($('message').textContent);
  renderReconnect({ active, live: live || airplayControls.videoActive(), phase: airplayControls.videoActive() ? 'waiting' : phase, pending: !airplayControls.videoActive() && fitRequestedAt > 0, text });
  $('connect').textContent = t(active ? 'resume' : 'connect');
  $('code').disabled = active;
  $('host').disabled = active;
  $('stats').hidden = !(active && live && statsVisible && !stage.hidden);
  if (active && statsVisible) {
    renderStats();
  }
}

function renderStats() {
  $('stats').textContent = formatPerformanceMonitor(codecName(config?.codec ?? videoStats.codec ?? '—'), videoStats);
}

function rtcStageText(stage) {
  const key = { 'local-ice': 'rtcLocalIce', pairing: 'rtcPairing', 'remote-ice': 'rtcRemoteIce',
    'dc-auth': 'rtcAuth', connected: 'rtcConnected' }[stage];
  return t(key ?? 'connecting');
}

function rtcCandidateText(value) {
  if (!value || !Number.isInteger(value.localCandidates) || !Number.isInteger(value.remoteCandidates)) return '';
  const pieces = [t('rtcCandidates', value.localCandidates, value.remoteCandidates)];
  const categories = [['UdpCandidates', 'UDP'], ['TcpCandidates', 'TCP'], ['PrivateIpv4Candidates', t('rtcPrivateIpv4')],
    ['CgnatIpv4Candidates', t('rtcCgnatIpv4')], ['LinkLocalCandidates', t('rtcLinkLocal')], ['Ipv6Candidates', 'IPv6'], ['MdnsCandidates', 'mDNS']];
  for (const [prefix, key] of [['local', 'rtcBrowserClasses'], ['remote', 'rtcAndroidClasses']]) {
    const nonzero = categories.filter(([field]) => value[prefix + field] > 0)
      .map(([field, label]) => `${label}:${value[prefix + field]}`);
    if (nonzero.length) pieces.push(t(key, nonzero.join(', ')));
  }
  if (value.iceState || value.connectionState) pieces.push(t('rtcStates', value.iceState ?? '—', value.connectionState ?? '—',
    value.videoChannelState ?? '—', value.audioChannelState ?? '—', value.controlChannelState ?? '—'));
  if (['remote-ice', 'dc-auth', 'connected'].includes(value.stage) && value.remoteCandidates === 0) pieces.push(t('rtcAndroidNoCandidates'));
  return pieces.join(' ');
}

function rtcRetryText(error, seconds) {
  const failure = rtcFailureSummary(error);
  let key = { fetch: 'rtcFetch', 'missing-interface': 'rtcMissingInterface', 'android-signaling': 'rtcAndroidSignaling',
    pairing: 'rtcPairingFailed', 'bad-response': 'rtcBadResponse', ice: 'rtcIceFailed', unsupported: 'rtcUnsupported' }[failure.reason];
  if (failure.reason === 'timeout') key = { 'local-ice': 'rtcLocalTimeout', pairing: 'rtcPairingTimeout',
    'remote-ice': 'rtcRemoteTimeout', 'dc-auth': 'rtcAuthTimeout' }[failure.stage];
  const detail = t('rtcRetryDetail', t(key ?? 'rtcConnectionFailed'), rtcStageText(failure.stage), seconds);
  const candidates = rtcCandidateText(failure);
  return candidates ? `${detail} ${candidates}` : detail;
}

function statusText() {
  if (!active) {
    if (notice?.key === 'noVideo') return t('pictureUnavailable');
    if (notice && !['badCode', 'invalidCode', 'invalidHost'].includes(notice.key)) return t('stopped');
    return t(link.code ? 'ready' : 'enterCode');
  }
  if (unsupported) return t('pictureUnavailable');
  if (phase === 'connecting') {
    if (!rtcProgress) return `${PAGE_VERSION} · ${t('connecting')}`;
    const text = rtcStageText(rtcProgress.stage), candidates = rtcCandidateText(rtcProgress);
    return `${PAGE_VERSION} · ${candidates ? `${text} ${candidates}` : text}`;
  }
  if (phase === 'retry') {
    const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    if (lastError?.status !== 429 && (lastError?.rtcReason || lastError?.rtcDiagnostic)) return `${PAGE_VERSION} · ${rtcRetryText(lastError, seconds)}`;
    return `${PAGE_VERSION} · ${t(lastError?.status === 429 ? 'throttled' : lastError ? 'unreachable' : 'lost', seconds)}`;
  }
  const playback = status?.airplay;
  if (playback?.kind === 'audio') return t('airPlayAudio');
  if (playback?.resource && playback.outputAllowed !== false) {
    if (playback.kind === 'photo') return t('airPlayPhoto');
    if (playback.buffering) return t('airPlayBuffering');
    if (playback.ready) return t(playback.playing ? 'airPlayPlaying' : 'airPlayPaused');
    return t('waitingVideo');
  }
  if (live) return t('streaming', codecName(config?.codec), Math.round(videoStats.decodedFps ?? 0));
  const source = config?.mode?.startsWith('airplay') ? 'airplay' : status?.videoSource;
  if (source === 'airplay') return t('waitingVideo');
  if (source === 'carplay' || config?.mode === 'carplay') return t('waitingFrame');
  const receiver = status?.receivers?.carplay;
  const key = {
    ready: 'waitingPhone', waiting: 'waitingPhone', searching: 'waitingPhone',
    preparing: 'carPlayPreparing', connecting: 'phoneConnecting', connected: 'waitingFrame',
    disabled: 'carPlayDisabled', failed: 'carPlayFailed', recovering: 'carPlayRecovering', stopping: 'carPlayStopping',
    blocked: 'carPlayBlocked',
  }[receiver?.state];
  // Older apps report only session availability, which cannot establish a receiver phase.
  return t(key ?? 'waitingSource');
}

function pageStats() {
  return {
    themeDark: appearance.matches,
    link: { path: videoPath.path, fallback: videoPath.reason, codecs: probedCodecs, phase, attempt, reconnects, live, unsupported,
      connection: rtcProgress, failure: lastError ? rtcFailureSummary(lastError) : null },
    video: videoStats,
    sender: safeSenderDiagnostics(status?.phone?.rtc),
    audio: browserAudio.stats(),
    control: outbox?.stats() ?? null,
    transport: rtc ? { ...rtc.stats(), audioPlayback: rtcAudio?.stats() } : null,
  };
}

/** Full diagnostics remain available to tools; never include the pairing code or the session id. */
function snapshot() {
  const { phone = null, ...rest } = status ?? {};
  if (rest.airplay) { const { directUrl, ...airplay } = rest.airplay; rest.airplay = airplay; }
  return { page: pageStats(), status: status ? rest : null, phone };
}
Object.defineProperty(window, 'tiplayStats', { configurable: true, get: () => JSON.parse(JSON.stringify(snapshot())) });

// Touch: one overlay element over the picture, which keeps the aspect of the negotiated CarPlay canvas.
function cancelMove() {
  movePending = false; moveGeneration++;
}

function releaseTouches() {
  cancelMove();
  const lifted = slots.releaseAll();
  if (lifted.length) outbox?.push({ k: 't', p: lifted });
}

/** Returns true when the pointer took a slot. */
function pointerDown(pointerId, clientX, clientY) {
  if (!live || !config || !outbox) return false;
  const point = mapPoint(clientX, clientY, touch.getBoundingClientRect(), config.width, config.height);
  if (!point || !slots.down(pointerId, point)) return false;
  cancelMove();
  outbox.push({ k: 't', p: slots.contacts() });
  return true;
}

function pointerMove(pointerId, clientX, clientY) {
  if (!slots.has(pointerId) || !config) return;
  const point = mapPoint(clientX, clientY, touch.getBoundingClientRect(), config.width, config.height, true);
  if (!point) return;
  slots.move(pointerId, point);
  if (movePending) return;
  movePending = true;
  const generation = moveGeneration;
  queueMicrotask(() => {
    if (!movePending || generation !== moveGeneration) return;
    movePending = false;
    if (slots.size) outbox?.push({ k: 't', p: slots.contacts() }, 'move');
  });
}

function pointerUp(pointerId) {
  const contacts = slots.up(pointerId);
  if (!contacts) return;
  cancelMove();
  outbox?.push({ k: 't', p: contacts });
}

touch.addEventListener('contextmenu', event => event.preventDefault());
if (window.PointerEvent) {
  touch.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!pointerDown(event.pointerId, event.clientX, event.clientY)) return;
    event.preventDefault();
    touch.setPointerCapture(event.pointerId);
  });
  touch.addEventListener('pointermove', event => pointerMove(event.pointerId, event.clientX, event.clientY));
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) touch.addEventListener(type, event => pointerUp(event.pointerId));
} else {
  const each = (event, handle) => {
    event.preventDefault();
    for (const contact of event.changedTouches) handle(contact.identifier, contact.clientX, contact.clientY);
  };
  touch.addEventListener('touchstart', event => each(event, pointerDown), { passive: false });
  touch.addEventListener('touchmove', event => each(event, pointerMove), { passive: false });
  for (const type of ['touchend', 'touchcancel']) touch.addEventListener(type, event => each(event, pointerUp));
}
window.addEventListener('blur', releaseTouches);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseTouches();
  else keepScreenOn();
});

// Viewport: the canvas backing store follows at once; reports share the next frame and omit duplicate sizes.
function resizeCanvas() {
  if (stage.hidden) return;
  const rect = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  sink?.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr));
}

function scheduleViewport() {
  if (stage.hidden || !outbox || viewportFrame !== null) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = null;
    if (stage.hidden || !outbox) return;
    const rect = stage.getBoundingClientRect();
    const viewport = viewportFor(rect.width, rect.height, window.devicePixelRatio || 1);
    if (!viewport || `${viewport.w}x${viewport.h}` === lastViewport) return;
    lastViewport = `${viewport.w}x${viewport.h}`;
    outbox.push({ k: 'vp', ...viewport }, 'latest');
    const reporting = outbox, size = lastViewport;
    void Promise.all([probeMirrorCapabilities(viewport.w, viewport.h), probeMirrorAudioFormats()]).then(([caps, audioFormats]) => {
      if (outbox === reporting && lastViewport === size && !stage.hidden) reporting.push({ k: 'vp', ...viewport, caps: { ...caps, audioFormats } }, 'latest');
    });
  }); // Coalesce layout notifications without waiting for a quiet period during a resize.
}

function cancelViewport() {
  if (viewportFrame !== null) cancelAnimationFrame(viewportFrame);
  viewportFrame = null;
}

const onResize = () => {
  resizeCanvas();
  scheduleViewport();
};
new ResizeObserver(onResize).observe(stage);
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);

function keepScreenOn() {
  if (!active || wakeLock || document.hidden || !navigator.wakeLock) return;
  wakeLock = navigator.wakeLock.request('screen').then(lock => {
    lock.addEventListener('release', () => { wakeLock = null; });
    return lock;
  }, () => {
    wakeLock = null; // refused (no user activation yet, or a policy); the next decoded epoch asks again
  });
}

$('link-form').addEventListener('submit', event => {
  event.preventDefault();
  if (active) { resumeCarPlay(); return; }
  const code = $('code').value.trim(), host = normalizeHost($('host').value.trim() || DEFAULT_HOST);
  if (!isCode(code)) {
    stop('invalidCode');
    $('code').focus();
    return;
  }
  if (!host) {
    stop('invalidHost');
    $('host').focus();
    return;
  }
  link = { host, code };
  $('host').value = host;
  saveLink();
  showLink();
  start();
});
$('disconnect').addEventListener('click', () => {
  sendBye();
  stop('stopped');
});
$('fit').addEventListener('click', () => {
  if (!outbox) return;
  fitRequestedAt = Date.now();
  outbox.push({ k: 'fit' });
  render();
});
$('stats-toggle').addEventListener('click', () => {
  statsVisible = !statsVisible;
  try { localStorage.setItem(STATS_KEY, statsVisible ? '1' : '0'); } catch (_) {}
  render();
});

window.addEventListener('pagehide', event => {
  resumeOnShow = active;
  if (active) sendBye();
  stop();
  if (!event.persisted) {
    browserAudio.dispose();
    if (sink) sink.dispose();
    else pathReady.then(() => sink?.dispose());
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted && resumeOnShow) start();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('sw.js', import.meta.url)).catch(() => {});

$('code').value = link.code ?? '';
$('host').value = link.host;
if (link.code) start();
else render();
pathReady.then(() => {
  if (videoPath.path !== 'none') {
    resizeCanvas(); // a start before the sink existed could not size the canvas, which then stays at 300 × 150
    return;
  }
  $('connect').disabled = true;
  stop('noVideo', videoPath.reason);
});
