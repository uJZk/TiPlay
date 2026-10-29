/*! SPDX-License-Identifier: GPL-3.0-only
 * Adapted from WheelPlay (https://github.com/fython/wheelplay), GPL-3.0-only,
 * common/src/main/assets/web/app.js at commit c1bd077 (pointer handling, viewport report, reconnect loop, stats getter).
 * Modified for TiPlay, 2026-10. Source code: https://github.com/uJZk/TiPlay
 *
 * TiPlay browser link: native WebRTC video frames are rendered directly to Canvas;
 * independent audio and control retain their own transport and timing. */
import {
  DEFAULT_HOST, abortable, addressSpaceFor, backoffDelay, createControlOutbox, createTouchSlots,
  isCode, linkFromAddress, linkLocation, mapPoint, newSessionId, normalizeHost,
  viewportFor,
} from './link.js';
import { APP_VERSION } from './app-version.js';
import { createLocationNotice } from './location-notice.js';
import { createBrowserLocation, locationEvents } from './geolocation.js';
import { followAppearance } from './appearance.js';
import { probeMirrorAudioFormats } from './airplay-capabilities.js';
import { createReconnectOverlay } from './reconnect.js';
import { pumpChunkStream, createFrameDelivery } from './transport.js';
import { createRtcMediaTransport } from './webrtc-transport.js';
import { createRtcTrackReader, createRtcVideoPipeline, rtcVideoCodecs, phoneSupportsRtcVideo,
  probeRtcMirrorCapabilities as probeMirrorCapabilities } from './rtc-video.js';
import { authenticateRtcOffer } from './rtc-pairing.js';
import { rtcFailureSummary } from './rtc-diagnostics.js';
import { createVideoDiagnosticTracker, safeSenderDiagnostics, decoderStatsMatch, decoderStatsSnapshot } from './video-diagnostics.js';
import { formatPerformanceMonitor, performanceStats } from './fps-window.js';
import { createClockEstimator } from './clock-sync.js';
import { createMediaTiming } from './media-timing.js';
import { createBrowserAudio } from './audio.js';
import { createAirPlayControls } from './airplay-controls.js';
import { createAirPlayTrustNotification } from './airplay-trust.js';
import { createBrowserNotice } from './browser-notice.js';
import { carPlayRunning, createReceiverNoticeTracker, videoProblemFor, videoReadyFor, videoSourceFor } from './receiver-presentation.js';
import { browserDiagnosticEvents, createFaultDiagnosticReporter, PAGE_VERSION } from './browser-diagnostics.js';

const STRINGS = {
  en: {
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
    rtcMissingInterface: 'Android has no WebRTC pairing interface. Check that TiPlay is up to date.',
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
    diagnostics: 'Diagnostics',
    diagnosticsHelp: 'Connection details for troubleshooting. These do not change playback or enable Android Debug mode.',
    diagnosticsEmpty: 'No connection details yet.',
    retryNetwork: 'Cannot reach Android. Check its address and allow local-network access. Retrying in {0} s…',
    retryUpdate: 'Update TiPlay on Android and reload this page. Retrying in {0} s…',
    retryAndroid: 'Android is not ready. Open TiPlay on the phone. Retrying in {0} s…',
    retryPairing: 'Pairing could not be verified. Check the current code in TiPlay. Retrying in {0} s…',
    retryConnection: 'Cannot connect. Keep both devices on the same network. Retrying in {0} s…',
    stats: 'Performance monitor',
    statsLabel: 'Performance monitor: codec, current FPS, current Delta, dropped frames',
    fit: 'Apply and reconnect',
    fitPending: 'Reconnecting…',
    source: 'TiPlay',
    enterCode: 'Enter the pairing code to connect.',
    ready: 'Ready to connect.',
    stopped: 'Disconnected.',
    connecting: 'Connecting to the Android device…',
    unreachable: 'The Android device does not answer. Retrying in {0} s…',
    lost: 'Connection lost. Retrying in {0} s…',
    throttled: 'Too many wrong pairing codes. Retrying in {0} s…',
    waitingPhone: 'Connected to Android. Waiting for iOS…',
    phoneConnecting: 'CarPlay is connecting…',
    waitingVideo: 'Waiting for the AirPlay picture…',
    preparingVideo: 'Preparing video…',
    preparingPhoto: 'Preparing photo…',
    waitingFrame: 'Waiting for the CarPlay picture…',
    waitingSource: 'Connected to the Android device. Waiting for a projection…',
    carPlayPreparing: 'CarPlay is preparing…',
    carPlayDisabled: 'CarPlay is disabled.',
    carPlayFailed: 'CarPlay connection failed.',
    carPlayRecovering: 'CarPlay is reconnecting…',
    carPlayStopping: 'CarPlay is disconnecting…',
    carPlayBlocked: 'CarPlay is waiting for setup or permission.',
    carPlaySuspended: 'CarPlay is waiting for AirPlay to finish.',
    airPlayPermission: 'Allow local-network access for TiPlay on the Android device.',
    airPlayFailed: 'AirPlay could not continue.',
    airPlayFailureHelp: 'AirPlay stopped unexpectedly. Check that AirPlay is enabled in TiPlay on Android, then try casting again from your iPhone.',
    pictureUnavailable: 'Picture unavailable.',
    airPlayPaused: 'Video is paused.',
    airPlayBuffering: 'Video is buffering…',
    badCode: 'The pairing code is wrong. Check it in TiPlay on the Android device.',
    replaced: 'Another browser took over the display. Connect again to take it back.',
    protocol: 'TiPlay on the Android device does not match this page. Update the app.',
    unsupportedTransport: 'This browser cannot connect to TiPlay. Use a current browser with WebRTC support.',
    directConnectionUnavailable: 'The browser could not open a local connection. Allow local-network access and check that both devices use the same network.',
    unsupported: 'This browser cannot decode {0}.',
    unsupportedHevc: 'This browser cannot decode this HEVC stream. Reconnect to report decoder support again.',
    unsupportedHdr: 'AirPlay mirroring requires SDR video; this source sends HDR.',
    rtcVideoCodecFailed: 'The video format exceeds the receive capabilities negotiated for this connection. Reconnect, or check Diagnostics for details.',
    rtcVideoFailureDetail: 'Video failure: {0}',
    noVideo: 'This browser cannot show the live picture ({0}). Open this page over HTTPS in a browser that supports live video.',
    invalidCode: 'Enter the 4-digit pairing code.',
    invalidHost: 'Enter an IPv4 address with port, for example 169.254.111.111:8080.',
  },
  zh: {
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
    rtcMissingInterface: '安卓端缺少 WebRTC 配对接口，请确认 TiPlay 已更新。',
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
    diagnostics: '诊断',
    diagnosticsHelp: '排查问题时查看连接详情。此处不会改变播放或开启安卓端 Debug 模式。',
    diagnosticsEmpty: '暂无连接诊断。',
    retryNetwork: '无法访问安卓端，请检查地址并允许本地网络访问。{0} 秒后重试…',
    retryUpdate: '请更新安卓端 TiPlay 并重新加载本页。{0} 秒后重试…',
    retryAndroid: '安卓端尚未就绪，请在手机上打开 TiPlay。{0} 秒后重试…',
    retryPairing: '配对验证未通过，请检查 TiPlay 当前显示的配对码。{0} 秒后重试…',
    retryConnection: '暂时无法连接，请确认两台设备连接同一网络。{0} 秒后重试…',
    stats: '性能监视器',
    statsLabel: '性能监视器：编码、当前 FPS、当前 Delta、丢帧计数',
    fit: '应用并重新连接',
    fitPending: '正在重新连接…',
    source: 'TiPlay',
    enterCode: '输入配对码后连接。',
    ready: '可以连接。',
    stopped: '已断开。',
    connecting: '正在连接安卓端…',
    unreachable: '安卓端没有响应，{0} 秒后重试…',
    lost: '连接中断，{0} 秒后重试…',
    throttled: '配对码错误次数过多，{0} 秒后重试…',
    waitingPhone: '已连接安卓端，等待 iOS…',
    phoneConnecting: 'CarPlay 正在连接…',
    waitingVideo: '正在等待 AirPlay 画面…',
    preparingVideo: '正在准备视频…',
    preparingPhoto: '正在准备照片…',
    waitingFrame: '正在等待 CarPlay 画面…',
    waitingSource: '已连接安卓端，等待投屏…',
    carPlayPreparing: 'CarPlay 正在准备…',
    carPlayDisabled: 'CarPlay 已禁用。',
    carPlayFailed: 'CarPlay 连接失败。',
    carPlayRecovering: 'CarPlay 正在重新连接…',
    carPlayStopping: 'CarPlay 正在断开连接…',
    carPlayBlocked: 'CarPlay 等待设置或授权。',
    carPlaySuspended: 'CarPlay 等待投屏结束。',
    airPlayPermission: '请在安卓端授予 TiPlay 本地网络访问权限。',
    airPlayFailed: 'AirPlay 暂时无法继续。',
    airPlayFailureHelp: 'AirPlay 意外中断。请确认安卓端 TiPlay 已开启 AirPlay，然后从 iPhone 重新投屏。',
    pictureUnavailable: '画面暂不可用。',
    airPlayPaused: '视频已暂停。',
    airPlayBuffering: '视频正在缓冲…',
    badCode: '配对码不正确，请在安卓端上的 TiPlay 中核对。',
    replaced: '另一个浏览器接管了画面。再次连接即可收回。',
    protocol: '安卓端上的 TiPlay 与本页不匹配，请更新应用。',
    unsupportedTransport: '此浏览器无法连接 TiPlay，请使用支持 WebRTC 的新版浏览器。',
    directConnectionUnavailable: '浏览器无法建立本地连接。请允许访问本地网络，并检查两台设备是否连接同一网络。',
    unsupported: '此浏览器无法解码 {0}。',
    unsupportedHevc: '此浏览器无法解码此 HEVC 视频流，请重新连接以再次汇报解码能力。',
    unsupportedHdr: 'AirPlay 镜像需要 SDR 视频，当前来源发送的是 HDR。',
    rtcVideoCodecFailed: '视频格式超出本次连接协商的接收能力。请重新连接，或在“诊断”中查看详情。',
    rtcVideoFailureDetail: '视频错误：{0}',
    noVideo: '此浏览器无法显示实时画面（{0}）。请使用支持实时视频的新版浏览器通过 HTTPS 打开本页。',
    invalidCode: '请输入 4 位配对码。',
    invalidHost: '请输入带端口的 IPv4 地址，例如 169.254.111.111:8080。',
  },
};
const lang = /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
const t = (key, ...args) => (STRINGS[lang][key] ?? STRINGS.en[key]).replace(/\{(\d)\}/g, (_, index) => args[index]);
const CODEC_NAMES = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', vp8: 'VP8', vp09: 'VP9', av01: 'AV1' };
const LINK_KEY = 'tiplay.link', STATS_KEY = 'tiplay.stats';
const $ = id => document.getElementById(id);
const browserNotice = createBrowserNotice($('browser-notice'), lang);
const receiverNotices = createReceiverNoticeTracker();
const stage = $('stage'), touch = $('touch');
const codecName = codec => CODEC_NAMES[String(codec).split('.')[0]] ?? codec;
const renderReconnect = createReconnectOverlay({
  overlay: $('reconnect'), message: $('reconnect-message'), settings: $('reconnect-settings'),
  panel: $('panel'), stage, onSettings: showPortal,
});

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
$('stats').setAttribute('aria-label', t('statsLabel'));
$('page-version').textContent = `TiPlay ${APP_VERSION}`;

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
let retryCountdownTimer = null, rtcMedia = null, rtcProgress = null, resourceToken = null;
let videoRestart = null;
let currentVideoGeneration = 1;
let controlClock = null;
const controlWaiters = new Set(), videoDiagnosticTracker = createVideoDiagnosticTracker();
let config = null, live = false, status = null, unsupported = null, videoStats = {}, videoError = null;
let receiverFailure = false, videoNoticeId = null;
let outbox = null, heartbeatTimer = null, statsTimer = null, viewportFrame = null, lastViewport = '';
let terminalDiagnosticId = null;
const faultDiagnostics = createFaultDiagnosticReporter({ emit: event => outbox?.push(event, 'fault') });
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
  onEvidence: evidence => {
    if (!status?.debug || !status.debugSession || !outbox || outbox.stats().pending > 0) return false;
    const event = { k: 'audio-evidence', d: status.debugSession, v: { ...evidence, pageVersion: PAGE_VERSION } };
    const limit = Math.min(64 * 1024, pageStats().transport?.controlMessageLimitBytes || 64 * 1024);
    if (new TextEncoder().encode(JSON.stringify(event)).byteLength > limit / 4) return false;
    return outbox.push(event, 'latest');
  },
  onMode: mode => {
    const timing = timingFor(mode);
    if (!config) { mediaTiming = timing; sink?.delay?.(timing.plans()); }
  },
  onTiming: (source, mode) => timingFor(mode).observe('audio', source),
  onQueued: mode => timingFor(mode).started(),
  onAudioReference: reference => sink?.audio(reference),
  onSourceDeadline: ({ first }) => {
    // Cumulative rejected blocks remain visible in the regular five-second report.
    // Only a new source identity/reason requests an immediate, compact fault event.
    if (first) faultDiagnostics.report(browserDiagnosticEvents(pageStats(), appearance.matches)[0]);
  },
  fetchPhone: phoneFetch, credentials: () => ({ code: resourceToken, session }),
});
mediaTiming = timingFor('carplay');
// Pairing, touching CarPlay and using page controls already provide activation.
// Resume playback on ordinary page gestures when autoplay is restricted.
document.addEventListener('pointerdown', () => browserAudio.gesture(), { capture: true, passive: true });
document.addEventListener('keydown', () => browserAudio.gesture(), { capture: true });
const airplayControls = createAirPlayControls($('stage'), event => outbox?.push(event), lang, { fetchPhone: phoneFetch, credentials: () => ({ code: resourceToken, session }), host: () => link.host });
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
const codecsReady = pathReady.then(() => {
  const codecs = videoPath.rtcTrack ? rtcVideoCodecs() : [];
  probedCodecs = [codecs.some(codec => /\/H264$/i.test(codec.mimeType)) ? 'avc1' : null,
    codecs.some(codec => /\/(H265|HEVC)$/i.test(codec.mimeType)) ? 'hvc1' : null].filter(Boolean).join(',');
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

/** Starts the Canvas worker and probes its track processor, or returns null if workers fail. */
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
      resolve({ worker, trackProcessor: data.trackProcessor === true });
    };
  });
}

async function setUpVideo() {
  const mainProcessor = typeof globalThis.MediaStreamTrackProcessor === 'function';
  const started = window.isSecureContext === true ? await startWorker() : null;
  const rtcTrack = window.isSecureContext === true && (mainProcessor || started?.trackProcessor) && rtcVideoCodecs().length > 0
    && typeof globalThis.RTCPeerConnection?.prototype?.addTransceiver === 'function'
    && typeof globalThis.RTCRtpTransceiver?.prototype?.setCodecPreferences === 'function';
  const workerPath = Boolean(started && rtcTrack);
  videoPath = { path: rtcTrack ? workerPath ? 'rtc-worker' : 'rtc-main' : 'rtc-unavailable',
    decode: 'native-webrtc', draw: workerPath && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' ? 'worker' : 'main',
    rtcTrack: Boolean(rtcTrack), reason: rtcTrack ? null : 'Native WebRTC video track processing is unavailable.' };
  if (started && !workerPath) started.worker.terminate();
  const canvas = $('screen');
  if (workerPath) {
    const { worker } = started;
    let presenter = null, activeTrack = null, trackId = null, generation = 1, generationReady = null;
    const trackDelivery = createFrameDelivery(message => {
      try { worker.postMessage({ type: 'rtc-frame', ...message, generation: message.config.videoGeneration }, [message.frame]); }
      catch (error) { sink.failVideo('rtc-video-frame-transfer-failed'); throw error; }
    });
    const trackReader = createRtcTrackReader({
      present: frame => trackDelivery.present(frame, { videoGeneration: generation }, trackId, null),
      onError: () => sink.failVideo('rtc-video-track-ended'),
    });
    if (videoPath.draw === 'worker') {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
    } else presenter = (await import('./video.js')).createFramePresenter(canvas, {
      onFirstPresent: config => onVideoMessage({ type: 'decoded', id: config.streamId, epoch: config.epoch, videoGeneration: config.videoGeneration }),
    });
    worker.onmessage = ({ data }) => {
      if (data.type === 'frame') {
        try {
          if (active && data.id === streamId && data.config.videoGeneration === generation) presenter.present(data.frame, data.config, null);
          else data.frame.close();
        } finally { worker.postMessage({ type: 'frame-ack', frameId: data.frameId }); }
      } else if (data.type === 'rtc-frame-ack') trackDelivery.acknowledge(data.frameId);
      else if (data.type === 'video-generation-ready') {
        if (generationReady?.id === data.id && generationReady.generation === data.generation) { clearTimeout(generationReady.timer); generationReady.resolve(); generationReady = null; }
      }
      else if (data.type === 'stats') onVideoMessage({ type: 'stats', id: data.id, stats: { ...data.stats, ...presenter?.stats() } });
      else {
        if (data.id === streamId && ['config', 'idle', 'video-error'].includes(data.type)) presenter?.close();
        if (data.id === streamId && data.type === 'video-error') { trackReader.stop(); trackDelivery.stop(); }
        onVideoMessage(data);
      }
    };
    worker.onerror = () => onVideoMessage({ type: 'video-error', id: trackId, reason: 'rtc-video-worker-failed' });
    sink = {
      clock() {}, audio() {},
      open(id, body, signal) {
        trackReader.stop(); trackDelivery.stop(); activeTrack = null; trackId = id; generation = 1;
        if (streamsTransferable()) worker.postMessage({ type: 'stream', id, stream: body }, [body]);
        else { const channel = new MessageChannel(); worker.postMessage({ type: 'feed', id, port: channel.port2 }, [channel.port2]); pumpChunkStream(body, channel.port1, signal); }
      },
      resetGeneration(id, next) {
        trackReader.stop(); trackDelivery.stop(); presenter?.close(); activeTrack = null; generation = next;
        return new Promise((resolve, reject) => {
          if (generationReady) { clearTimeout(generationReady.timer); generationReady.reject(Error('Video generation replaced.')); }
          const timer = setTimeout(() => { generationReady = null; reject(Error('Video generation preparation timed out.')); }, 3000);
          generationReady = { id, generation: next, resolve, reject, timer };
          worker.postMessage({ type: 'video-generation', id, generation: next });
        });
      },
      track(id, track, next = generation) {
        if (!track || trackId !== id || generation !== next || activeTrack === track) return;
        activeTrack = track;
        if (mainProcessor) trackReader.read(track).catch(() => sink.failVideo('rtc-video-processor-unavailable'));
        else { try { worker.postMessage({ type: 'rtc-track', id, track, generation }, [track]); } catch (_) { sink.failVideo('rtc-video-track-transfer-failed'); } }
      },
      failVideo(reason) { trackReader.stop(); trackDelivery.stop(); worker.postMessage({ type: 'video-error', id: trackId, reason }); },
      stop() {
        if (generationReady) { clearTimeout(generationReady.timer); generationReady.reject(Error('Video stopped.')); generationReady = null; }
        trackId = null; activeTrack = null; trackReader.stop(); trackDelivery.stop(); worker.postMessage({ type: 'stop' }); presenter?.close();
      },
      dispose() { this.stop(); trackReader.close(); trackDelivery.stop(); worker.postMessage({ type: 'dispose' }); presenter?.dispose(); },
      resize: (width, height) => presenter ? presenter.resize(width, height) : worker.postMessage({ type: 'resize', width, height }),
    };
  } else {
    const presenter = (await import('./video.js')).createFramePresenter(canvas, {
      onFirstPresent: config => onVideoMessage({ type: 'decoded', id: config.streamId, epoch: config.epoch, videoGeneration: config.videoGeneration }),
    });
    let activeTrack = null, trackId = null, generation = 1, timer = null;
    const pipeline = createRtcVideoPipeline({ post: message => {
      if (['config', 'idle', 'video-error'].includes(message.type)) presenter.close();
      if (message.type === 'video-error') trackReader.stop();
      onVideoMessage(message);
    }, present: (frame, config) => presenter.present(frame, config, null) });
    const trackReader = createRtcTrackReader({ present: frame => pipeline.trackFrame(frame, generation), onError: () => pipeline.fail('rtc-video-track-ended') });
    const stop = () => { clearInterval(timer); activeTrack = null; trackId = null; trackReader.stop(); pipeline.stop(); presenter.close(); };
    sink = {
      clock() {}, audio() {},
      open(id, body) { stop(); trackId = id; generation = 1; pipeline.read(id, body); timer = setInterval(() => onVideoMessage({ type: 'stats', id, stats: { ...pipeline.stats(), ...presenter.stats() } }), 1000); },
      resetGeneration(id, next) { trackReader.stop(); presenter.close(); activeTrack = null; pipeline.resetGeneration(next); generation = next; },
      track(id, track, next = generation) {
        if (!track || trackId !== id || generation !== next || activeTrack === track) return;
        activeTrack = track; trackReader.read(track).catch(() => pipeline.fail('rtc-video-processor-unavailable'));
      },
      failVideo: pipeline.fail, stop,
      dispose() { stop(); trackReader.close(); presenter.dispose(); }, resize: presenter.resize,
    };
  }
}

function phoneFetch(route, init = {}) {
  return fetch(`http://${link.host}${route}`, {
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', targetAddressSpace: addressSpaceFor(link.host), ...init,
  });
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
  resetReceiverPresentation();
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
  // Pairing and media authentication complete before any application control can be sent.
  statsTimer = setInterval(reportDiagnostics, 5000);
  resizeCanvas();
  scheduleViewport();
  keepScreenOn();
  connectVideo();
}

function stop(key = null, ...args) {
  cancelViewport();
  faultDiagnostics.reset();
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
  rtcMedia?.close();
  resourceToken = null; controlClock = null;
  for (const waiter of controlWaiters) waiter.reject(new Error('Browser control owner retired.')); controlWaiters.clear();
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
  rtcMedia?.bye().catch(() => {});
  if (resourceToken) phoneFetch('/bye', { method: 'POST', body: JSON.stringify({ c: resourceToken, s: session }), keepalive: true }).catch(() => {});
}

async function connectVideo() {
  const id = ++streamId;
  videoError = null; videoRestart = null;
  currentVideoGeneration = 1;
  faultDiagnostics.reset();
  rtcMedia?.close();
  rtcMedia = null; resourceToken = null; controlClock = null; rtcProgress = null;
  sink?.stop();
  clearTimeout(retryTimer);
  clearInterval(retryCountdownTimer);
  videoAbort?.abort();
  live = false;
  phase = 'connecting';
  render();
  const ownerSession = session;
  const abort = videoAbort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 40000); // includes direct ICE and both peers' candidate gathering
  try {
    const clockEstimator = createClockEstimator();
    await abortable(codecsReady, abort.signal);
    if (id !== streamId) return;
    if (!sink) {
      clearTimeout(timer);
      stop('noVideo', videoPath.reason);
      return;
    }
    // Source timing remains unknown until the authenticated channel provides a clock sample.
    sink.clock(null); browserAudio.clock(null);
    for (const [mode, timing] of mediaTimings) { timing.reset(); timing.mode(mode); }
    mediaTiming = timingFor('carplay');
    const useVideoTrack = videoPath.rtcTrack && await phoneSupportsRtcVideo(phoneFetch, abort.signal);
    if (id !== streamId || abort.signal.aborted) return;
    let opened = false;
    const media = rtcMedia = createRtcMediaTransport({
      signal: abort.signal,
      videoTrack: useVideoTrack,
      onVideoGeneration: generation => {
        if (id !== streamId || abort.signal.aborted) return;
        config = null; live = false; videoError = null; unsupported = null; videoStats = {};
        currentVideoGeneration = generation;
        return sink.resetGeneration(id, generation);
      },
      onVideoTrack: (track, generation) => { if (opened && id === streamId && !abort.signal.aborted) sink.track(id, track, generation); },
      onVideoError: reason => { if (opened && id === streamId && !abort.signal.aborted) sink.failVideo(reason); },
      credentials: () => ({ code: link.code, session: ownerSession }),
      exchange: offer => authenticateRtcOffer({ fetchPhone: phoneFetch, session: ownerSession, code: link.code, offer, signal: abort.signal }),
      onProgress: progress => { if (id === streamId && !abort.signal.aborted) { rtcProgress = progress; render(); } },
      onError: error => {
        if (!opened || abort.signal.aborted || id !== streamId) return;
        streamEnded(error.reason ?? 'transport-failed', error);
      },
    });
    await media.connect();
    clearTimeout(timer);
    if (id !== streamId || abort.signal.aborted) { media.close(); return; }
    opened = true;
    resetReceiverPresentation();
    lastError = null;
    resourceToken = media.resourceToken();
    const sample = media.clockSample();
    const clock = clockEstimator.observe(sample.serverMs, sample.started, sample.ended);
    sink.clock(clock); browserAudio.clock(clock);
    controlClock = { media, estimator: clockEstimator };
    sink.open(id, media.video, abort.signal);
    if (media.videoTrack?.()) sink.track(id, media.videoTrack());
    if (!useVideoTrack) sink.failVideo?.('rtc-video-unavailable');
    browserAudio.attach(abort.signal, media.hello(), () => media.openAudio(), {
      exchange: value => media.audioOffer(value), subscribe: listener => media.audioEvents(listener),
      ready: value => media.audioTrackReady(value),
    });
    if (!outbox) {
      outbox = createControlOutbox({ maxInFlight: 8, send: (q, events) => postControl(q, events, ownerSession), heldContacts: () => slots.contacts(), onStatus: applyStatus, onError: controlFailed });
      heartbeatTimer = setInterval(() => outbox?.heartbeat(), 400);
    }
    for (const waiter of controlWaiters) waiter.resolve(); controlWaiters.clear();
    outbox.heartbeat();
    reportAppearance();
    phase = 'waiting';
    // A phone that restarted while this page stayed open has forgotten the viewport; repeat it once per stream.
    lastViewport = '';
    scheduleViewport();
    render();
  } catch (error) {
    clearTimeout(timer);
    if (id !== streamId) return;
    abort.abort(); // Retire signaling fetches as well as the peer before starting another attempt.

    if (error.status === 401) stop('badCode');
    else if (error.status === 409) stop('replaced');
    else if (error.reason === 'webrtc-unavailable') stop('unsupportedTransport');
    else if (error.reason === 'unsupported-message-size') stop('protocol');
    else {
      lastError = error;
      reportDiagnostics();
      if (/^no-(local|remote)-(udp-)?candidates$/.test(error.reason ?? '')) browserNotice.update({ id: 'direct-connection', text: t('directConnectionUnavailable') });
      scheduleRetry(error.status === 429 ? 30000 : backoffDelay(attempt++));
    }
  }
}

function streamEnded(reason, error = null) {
  if (terminalDiagnosticId === streamId) return;
  terminalDiagnosticId = streamId;
  faultDiagnostics.reset();
  if (reason !== 'closed' && reason !== 'end') lastError = error ?? Object.assign(new Error(reason), { reason });
  try { reportDiagnostics('terminal'); } catch (_) {} // Evidence collection must not prevent media retirement.
  videoAbort?.abort();
  rtcMedia?.close();
  sink?.stop();
  live = false;
  releaseTouches();
  if (reason === 'replaced') {
    stop('replaced');
    return;
  }
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

async function postControl(q, events, ownerSession = session) {
  const assertOwner = () => { if (!active || session !== ownerSession) throw new Error('Browser control owner retired.'); };
  assertOwner();
  let media = rtcMedia;
  while (!media?.isConnected()) {
    await new Promise((resolve, reject) => controlWaiters.add({ resolve, reject }));
    assertOwner(); media = rtcMedia;
  }
  const started = performance.timeOrigin + performance.now();
  const result = await media.control(q, locationEvents(events));
  assertOwner();
  if (media === rtcMedia && controlClock?.media === media) {
    const clock = controlClock.estimator.observe(result.clockMs, started, performance.timeOrigin + performance.now());
    if (clock) { sink?.clock(clock); browserAudio.clock(clock); }
  }
  return result;
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
  updateReceiverNotice();
  if (!next.fit || Date.now() - fitRequestedAt > 15000) fitRequestedAt = 0;
  render();
}

function updateReceiverNotice() {
  const next = receiverNotices.observe(status, config);
  receiverFailure = next.failure;
  if (next.resetId) browserNotice.reset(next.resetId);
  if (next.noticeId) browserNotice.update({ id: next.noticeId, text: t('airPlayFailureHelp') });
}

function resetReceiverPresentation() {
  receiverNotices.reset();
  receiverFailure = false;
}

function controlFailed(error) {
  if (error.status === 401) stop('badCode');
  else if (error.status === 409) stop('replaced');
}

function onVideoMessage(message) {
  if (!active || message.id !== streamId) return;
  const generation = message.videoGeneration ?? message.config?.videoGeneration ?? message.stats?.videoGeneration;
  if (generation !== undefined && generation !== currentVideoGeneration) return;
  if (message.type === 'video-error') {
    live = false;
    if (message.stats && decoderStatsMatch(message.stats, streamId, config?.epoch)) videoStats = performanceStats(message.stats);
    if (message.reason === 'video-renegotiation-required' || message.reason === 'video-source-changed-reconnect-required') {
      const media = rtcMedia, id = streamId;
      if (!media || videoRestart?.media === media) return;
      videoError = null;
      const pending = videoRestart = { media };
      media.restartVideo().catch(error => {
        if (rtcMedia === media && id === streamId) {
          videoError = error.reason || 'rtc-video-renegotiation-failed';
          try { reportDiagnostics('fault'); } catch (_) {}
          render();
        }
      }).finally(() => { if (videoRestart === pending) videoRestart = null; });
    } else videoError = message.reason || 'rtc-video-failed';
    if (videoError) { try { reportDiagnostics('fault'); } catch (_) {} }
    render(); return;
  }

  if (message.type === 'media-ready') {
    mediaTiming.observe('video', message.source, message.ready);
    return;
  }
  if (message.type === 'alive' && message.id === streamId) attempt = 0;
  else if (message.type === 'config') {
    mediaTiming = timingFor(message.config.mode);
    sink?.delay?.(mediaTiming.plans());
    // Audio has its own ordered per-type reset/epoch. Its channel may deliver
    // the new producer's PCM before this config, so video cannot clear that audio.
    if (config?.epoch !== message.config.epoch || config?.mode !== message.config.mode) { videoStats = {}; live = false; }
    config = message.config;
    videoError = null;
    unsupported = null;
    updateReceiverNotice();
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
  else if (message.type === 'end' && message.id === streamId) {
    if (decoderStatsMatch(message.stats, streamId, config?.epoch)) videoStats = performanceStats({ ...videoStats, ...message.stats });
    streamEnded(message.reason);
  }
  else if (message.type === 'stats') {
    if (!decoderStatsMatch(message.stats, streamId, config?.epoch)) return;
    videoStats = performanceStats(message.stats);
  }
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
  const source = videoSourceFor(status, config), playback = status?.airplay;
  const pendingCast = !videoReadyFor(status, config, live) &&
    ((playback?.kind === 'video' && playback.outputAllowed !== false && playback.videoShown !== false)
      || (['video', 'loading'].includes(status?.receivers?.airplay?.state)
        && !(source === 'carplay' && playback?.videoShown === false)));
  const videoProblem = active && !pendingCast ? videoProblemFor(status, config, unsupported) : null;
  if (active && unsupported && !videoProblem) browserNotice.reset(`codec:${unsupported}`);
  if (videoProblem) {
    const key = videoProblem === 'hdr' ? 'unsupportedHdr' : /^(hvc1|hev1)\b/.test(videoProblem) ? 'unsupportedHevc' : 'unsupported';
    problem = { id: `codec:${videoProblem}`, text: t(key, codecName(videoProblem)) };
  }
  const currentVideoError = active && videoError && !pendingCast ? videoProblemFor(status, config, videoError) : null;
  const codecFailure = ['codec-profile-not-negotiated', 'video-codec-not-negotiated', 'encoder-codec-mismatch'].includes(currentVideoError);
  const nextVideoNoticeId = currentVideoError && (currentVideoError === 'hdr' || codecFailure)
    ? `rtc-video:${currentVideoError}` : null;
  if (videoNoticeId && videoNoticeId !== nextVideoNoticeId) browserNotice.reset(videoNoticeId);
  videoNoticeId = nextVideoNoticeId;
  if (videoNoticeId) problem = { id: videoNoticeId, text: t(currentVideoError === 'hdr' ? 'unsupportedHdr' : 'rtcVideoCodecFailed') };
  browserNotice.update(problem);
  $('message').textContent = inlineNotice ? t(notice.key, ...notice.args) : '';
  $('status').textContent = text;
  $('status').hidden = !text || Boolean($('message').textContent);
  airplayControls.setCarPlayRunning?.(carPlayRunning(status, config));
  const videoReady = videoReadyFor(status, config, live);
  renderReconnect({ active, live: videoReady || airplayControls.videoActive(), phase: airplayControls.videoActive() ? 'waiting' : phase, pending: !airplayControls.videoActive() && fitRequestedAt > 0, text });
  $('connect').textContent = t(active ? 'resume' : 'connect');
  $('code').disabled = active;
  $('host').disabled = active;
  $('stats').hidden = !(active && videoReady && statsVisible && !stage.hidden);
  if (active && statsVisible) {
    renderStats();
  }
  if ($('diagnostics').open) $('connection-details').textContent = connectionDetailsText();
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

function retryStatusText(error, seconds) {
  if (error?.status === 429) return t('throttled', seconds);
  if (/^no-(local|remote)-(udp-)?candidates$/.test(error?.reason ?? '')) return t('retryConnection', seconds);
  const key = { fetch: 'retryNetwork', 'missing-interface': 'retryUpdate', 'bad-response': 'retryUpdate',
    'android-signaling': 'retryAndroid', pairing: 'retryPairing', ice: 'retryConnection', timeout: 'retryConnection' }[rtcFailureSummary(error).reason];
  return t(key ?? (error ? 'unreachable' : 'lost'), seconds);
}

function connectionDetailsText() {
  const reason = typeof videoError === 'string' && /^[a-z0-9-]{1,100}$/.test(videoError) ? videoError : videoError ? 'rtc-video-failed' : null;
  const videoFailure = reason ? `\n${t('rtcVideoFailureDetail', reason)}` : '';
  if (phase === 'retry' && lastError) {
    return `${PAGE_VERSION}\n${rtcRetryText(lastError, Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)))}${videoFailure}`;
  }
  if (!rtcProgress) return `${PAGE_VERSION}\n${t('diagnosticsEmpty')}${videoFailure}`;
  const candidates = rtcCandidateText(rtcProgress);
  return `${PAGE_VERSION}\n${rtcStageText(rtcProgress.stage)}${candidates ? `\n${candidates}` : ''}${videoFailure}`;
}

function statusText() {
  if (!active) {
    if (notice?.key === 'noVideo') return t('pictureUnavailable');
    if (notice && !['badCode', 'invalidCode', 'invalidHost'].includes(notice.key)) return t('stopped');
    return t(link.code ? 'ready' : 'enterCode');
  }
  if (phase === 'connecting') return t('connecting');
  if (phase === 'retry') {
    const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    return retryStatusText(lastError, seconds);
  }
  const playback = status?.airplay;
  const receiver = status?.receivers?.carplay;
  const source = videoSourceFor(status, config);
  if (receiverFailure) return t('airPlayFailed');
  if (status?.receivers?.airplay?.state === 'permission' && (receiver?.state === 'suspended' || source === 'airplay')) return t('airPlayPermission');
  if (playback?.kind === 'audio' && source !== 'carplay') return '';
  if (playback?.kind !== 'audio' && playback?.resource && playback.outputAllowed !== false && playback.videoShown !== false) {
    if (playback.kind === 'photo') return '';
    if (playback.buffering) return t('airPlayBuffering');
    if (playback.ready) return playback.playing ? '' : t('airPlayPaused');
    return t('preparingVideo');
  }
  // A new cast can arrive before its resource or video track does. A retired
  // CarPlay fault must not replace the foreground preparation message.
  const airplayPreparing = (playback?.kind === 'video' && playback.outputAllowed !== false && playback.videoShown !== false)
    || (['video', 'loading'].includes(status?.receivers?.airplay?.state)
      && !(source === 'carplay' && playback?.videoShown === false));
  if (airplayPreparing && !videoReadyFor(status, config, live)) return t('preparingVideo');
  if (videoProblemFor(status, config, unsupported || videoError)) return t('pictureUnavailable');
  if (videoReadyFor(status, config, live)) return '';
  if (source === 'carplay' && (playback?.videoShown === false || playback?.kind === 'audio')) return t('waitingFrame');
  if (status?.receivers?.airplay?.state === 'photo') return t('preparingPhoto');
  if (['video', 'loading'].includes(status?.receivers?.airplay?.state)) return t('preparingVideo');
  if (status?.receivers?.airplay?.state === 'mirror') return t('waitingVideo');
  if (receiver?.state === 'suspended' && source !== 'airplay') return t('carPlaySuspended');
  if (source === 'airplay') return t('waitingVideo');
  if (source === 'carplay') return t('waitingFrame');
  const key = {
    ready: 'waitingPhone', waiting: 'waitingPhone', searching: 'waitingPhone',
    preparing: 'carPlayPreparing', connecting: 'phoneConnecting', connected: 'waitingFrame',
    disabled: 'carPlayDisabled', failed: 'carPlayFailed', recovering: 'carPlayRecovering', stopping: 'carPlayStopping',
    blocked: 'carPlayBlocked',
  }[receiver?.state];
  // Older apps report only session availability, which cannot establish a receiver phase.
  return t(key ?? 'waitingSource');
}

function reportDiagnostics(kind = 'latest') {
  for (const event of browserDiagnosticEvents(pageStats(), appearance.matches, status?.debug === true, status?.debugSession, videoDiagnosticTracker)) outbox?.push(event, event.k === 'st' ? kind : 'latest');
}

function pageStats() {
  const estimator = controlClock?.estimator.diagnostics();
  return {
    themeDark: appearance.matches,
    link: { path: videoPath.path, fallback: videoPath.reason, codecs: probedCodecs, phase, attempt, reconnects, live, unsupported, errorReason: lastError?.reason ?? lastError?.rtcReason ?? null, connection: rtcProgress, failure: lastError ? rtcFailureSummary(lastError) : null },
    transport: rtcMedia?.stats() ?? null,
    video: { ...decoderStatsSnapshot(videoStats), errorReason: typeof videoError === 'string' && /^[a-z0-9-]{1,100}$/.test(videoError) ? videoError : videoError ? 'rtc-video-failed' : null,
      clockEstimatorState: estimator?.clockEstimatorState,
      clockEstimatorObservationAgeMs: estimator?.clockEstimatorObservationAgeMs,
      clockEstimatorSelectedAgeMs: estimator?.clockEstimatorSelectedAgeMs },
    sender: safeSenderDiagnostics(status?.phone?.rtc),
    audio: browserAudio.stats(),
    control: outbox?.stats() ?? null,
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
  if (lifted.length) { outbox?.push({ k: 't', p: lifted }); setInteraction(false); }
}

// Touch is forwarded immediately without changing either media timeline.
function setInteraction(_active) {
  // Touch does not alter the independent live audio and video playback policies.
}

/** Returns true when the pointer took a slot. */
function pointerDown(pointerId, clientX, clientY) {
  if (!live || !config || !outbox) return false;
  const point = mapPoint(clientX, clientY, touch.getBoundingClientRect(), config.width, config.height);
  if (!point || !slots.down(pointerId, point)) return false;
  cancelMove();
  outbox.push({ k: 't', p: slots.contacts() });
  setInteraction(true);
  return true;
}

function pointerMove(pointerId, clientX, clientY) {
  if (!slots.has(pointerId) || !config) return;
  const point = mapPoint(clientX, clientY, touch.getBoundingClientRect(), config.width, config.height, true);
  if (!point) return;
  slots.move(pointerId, point);
  setInteraction(true);
  if (movePending) return;
  movePending = true;
  const generation = ++moveGeneration;
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
  setInteraction(slots.size > 0);
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
$('diagnostics').addEventListener('toggle', render);

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
