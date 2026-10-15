// SPDX-License-Identifier: GPL-3.0-only
import {
  WATCH_OPTIONS, createCollector, createEventQueue, eventFactory, geolocationErrorData,
  normalizeEndpoint, parseConnection, positionData, uploadErrorData,
} from './helpers.js';

const $ = id => document.getElementById(id);
const connection = parseConnection(location.search, location.hash);
const random = new Uint8Array(16);
crypto.getRandomValues(random);
const clientId = Array.from(random, value => value.toString(16).padStart(2, '0')).join('');
const makeEvent = eventFactory({ clientId });
const evidence = [], recent = [], permissionStates = {};
const MAX_EVIDENCE = 20000;
let collector = null, queue = null, collectorConfig = null, watchId = null, monitoring = false;
let androidStatus = null, lastBrowserFix = null, browserFixes = 0, geolocationErrors = 0;
let statusInFlight = false, statusTimer = null, lastUploadError = null, lastStatusError = null;
let evidenceFull = false, queueFull = false;
let permissionChecks = [];
let permissionQueryGeneration = 0;

$('host').value = connection.host || '';
$('token').value = connection.token || '';

function text(id, value, state = '') {
  $(id).textContent = value;
  $(id).classList.toggle('error', state === 'error');
  $(id).classList.toggle('okay', state === 'okay');
}

function environment() {
  const policy = document.permissionsPolicy || document.featurePolicy;
  function policyAllows(name) {
    try { return policy?.allowsFeature(name) ?? null; } catch (_) { return null; }
  }
  const network = navigator.connection;
  return {
    page: `${location.origin}${location.pathname}`, secureContext: window.isSecureContext,
    geolocationAvailable: !!navigator.geolocation, permissionsApiAvailable: !!navigator.permissions?.query,
    userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language,
    visibility: document.visibilityState, online: navigator.onLine,
    permissions: { ...permissionStates }, policy: { geolocation: policyAllows('geolocation') },
    timeOriginMs: performance.timeOrigin ?? null,
    network: network ? { effectiveType: network.effectiveType ?? null, type: network.type ?? null, downlink: network.downlink ?? null, rtt: network.rtt ?? null, saveData: network.saveData ?? null } : null,
    screen: { width: screen.width, height: screen.height, pixelRatio: window.devicePixelRatio },
    watchOptions: WATCH_OPTIONS,
  };
}

function renderEnvironment() {
  const data = environment();
  text('capabilities', `安全上下文：${data.secureContext ? '是' : '否'} · 定位 API：${data.geolocationAvailable ? '可用' : '不可用'} · 页面：${data.visibility} · 网络：${data.online ? '在线' : '离线'}`);
  text('permissions', `定位权限：${permissionStates.geolocation || '尚未查询'} · 本地网络权限：${permissionStates['local-network-access'] || '尚未查询'}`);
  text('environment', JSON.stringify(data, null, 2));
}

function renderQueue() {
  const stats = queue?.stats() || { pending: 0, uploaded: 0, failures: 0 };
  text('pending', stats.pending);
  text('uploaded', stats.uploaded);
  text('upload-errors', stats.failures);
  const locked = monitoring || stats.pending > 0 || stats.inFlight;
  $('host').disabled = locked;
  $('token').disabled = locked;
  $('start').disabled = monitoring || evidenceFull || queueFull;
  $('stop').disabled = !monitoring;
  $('download').disabled = !collector;
}

function renderFixAges() {
  if (lastBrowserFix) {
    const age = Number.isFinite(lastBrowserFix.timestamp) ? `${Math.round(Date.now() - lastBrowserFix.timestamp)} ms` : '未知';
    text('web-fix-age', `网页原始定位距当前网页时钟：${age}；本页接收时钟：${lastBrowserFix.receivedWallTimeMs} ms。`);
  }
  if (androidStatus?.lastAndroidFix) {
    const fix = androidStatus.lastAndroidFix;
    const age = Number.isFinite(fix.timestampMs) && Number.isFinite(androidStatus.serverWallTimeMs)
      ? `${Math.round(androidStatus.serverWallTimeMs - fix.timestampMs)} ms` : '未知';
    text('android-fix-age', `读取状态时，安卓原始定位距手机时钟：${age}。网页读取状态并不表示手机刚产生定位。`);
  }
}

function record(type, data, upload = true) {
  if (evidence.length >= MAX_EVIDENCE) {
    evidenceFull = true;
    stopWatch(false);
    text('action-status', '本页日志达到上限，已停止网页定位。请导出 JSON 后刷新页面继续。', 'error');
    renderQueue();
    return null;
  }
  const event = makeEvent(type, data);
  evidence.push(event);
  recent.push(`${new Date(event.clientWallTimeMs).toISOString()} ${type}\n${JSON.stringify(data)}`);
  if (recent.length > 15) recent.shift();
  text('recent-events', recent.slice().reverse().join('\n\n'));
  if (upload && queue && !queue.push(event)) {
    queueFull = true;
    stopWatch(false);
    text('action-status', '待上传日志达到上限，已停止网页定位。请恢复手机连接并导出本页 JSON。', 'error');
  }
  renderQueue();
  return event;
}

function connectionErrorText(error) {
  const data = uploadErrorData(error);
  if (data.category === 'authentication') return '手机令牌不匹配：请重新打开手机提供的链接。';
  if (data.category === 'network_or_browser_policy') return '手机连接失败；浏览器未说明是网络、混合内容、CORS 还是本地网络权限限制。请检查热点并允许本地网络访问。';
  return data.message;
}

function setupCollector() {
  const host = normalizeEndpoint($('host').value), token = $('token').value.trim();
  if (!host || !/^[a-zA-Z0-9_-]{16,128}$/.test(token)) {
    text('action-status', '请输入手机显示的 IPv4 地址和会话令牌，或打开手机提供的完整链接。', 'error');
    return false;
  }
  if (collectorConfig?.host === host && collectorConfig.token === token) return true;
  if (queue?.stats().pending || queue?.stats().inFlight) {
    text('action-status', '先把待发送事件上传或导出；当前会话仍有未确认事件。', 'error');
    return false;
  }
  collectorConfig = { host, token };
  collector = createCollector(collectorConfig);
  lastUploadError = null;
  lastStatusError = null;
  androidStatus = null;
  queue = createEventQueue({
    send: events => collector.send(events), onChange: renderQueue,
    onError(error, retry) {
      text('upload-status', `${connectionErrorText(error)} ${retry.delayMs / 1000} 秒后重试；事件保留在本页。`, 'error');
      const data = uploadErrorData(error), key = JSON.stringify(data);
      if (key !== lastUploadError) {
        lastUploadError = key;
        record('upload_error', { ...data, retryDelayMs: retry.delayMs });
      }
      scheduleStatus();
    },
    onAck(delivered) {
      if (lastUploadError) {
        lastUploadError = null;
        record('upload_recovered', { acknowledged: delivered.length });
      }
      text('upload-status', '手机已确认接收事件。', 'okay');
      if (queueFull && queue.stats().pending < 512) {
        queueFull = false;
        text('action-status', '待发送队列已恢复。可再次开始网页定位；本页 JSON 保留此前所有事件。');
      }
    },
  });
  record('connection_config', { host });
  return true;
}

function scheduleStatus() {
  if (statusTimer !== null) return;
  if (!monitoring && !queue?.stats().pending) return;
  statusTimer = setTimeout(() => { statusTimer = null; pollStatus(); }, 3000);
}

async function pollStatus() {
  if (!collector || statusInFlight) return;
  const usedCollector = collector;
  statusInFlight = true;
  const startedWall = Date.now(), startedMono = performance.now();
  try {
    const status = await usedCollector.request('/status');
    if (collector !== usedCollector) return;
    androidStatus = status;
    if (lastStatusError) {
      lastStatusError = null;
      record('connection_recovered', { sessionId: status.sessionId ?? null });
    }
    text('phone-status', status.running ? `手机采集中 · ${status.sessionId || ''}` : '手机服务已停止', status.running ? 'okay' : 'error');
    text('android-count', status.androidFixes ?? '—');
    text('phone-web-count', status.browserFixes ?? '—');
    text('android-fix', status.lastAndroidFix ? JSON.stringify(status.lastAndroidFix, null, 2) : '手机尚未收到定位；查看手机诊断和权限。');
    text('phone-diagnostics', JSON.stringify(status, null, 2));
    const rtt = performance.now() - startedMono;
    if (Number.isFinite(status.serverWallTimeMs)) {
      const difference = status.serverWallTimeMs - (startedWall + rtt / 2);
      text('clock-status', `手机时钟 − 网页时钟 ≈ ${Math.round(difference)} ms；往返 ${Math.round(rtt)} ms，估计不确定度至少 ±${Math.ceil(rtt / 2)} ms。原始传感器时间不作修正。`);
    } else {
      text('clock-status', `手机请求往返 ${Math.round(rtt)} ms；没有服务器时钟字段，无法估计时钟差。原始传感器时间分别保留。`);
    }
  } catch (error) {
    if (collector !== usedCollector) return;
    text('phone-status', connectionErrorText(error), 'error');
    const data = uploadErrorData(error), key = JSON.stringify(data);
    if (key !== lastStatusError) {
      lastStatusError = key;
      record('connection_error', data);
    }
  } finally {
    statusInFlight = false;
    renderFixAges();
    scheduleStatus();
  }
}

async function queryPermissions() {
  const generation = ++permissionQueryGeneration;
  for (const permission of permissionChecks) permission.onchange = null;
  permissionChecks = [];
  for (const name of ['geolocation', 'local-network-access']) {
    try {
      if (!navigator.permissions?.query) throw new Error('浏览器没有 Permissions API');
      const permission = await navigator.permissions.query({ name });
      if (generation !== permissionQueryGeneration) return;
      permissionStates[name] = permission.state;
      permissionChecks.push(permission);
      record('permission', { permission: name, state: permission.state });
      permission.onchange = () => {
        permissionStates[name] = permission.state;
        record('permission', { permission: name, state: permission.state });
        renderEnvironment();
      };
    } catch (error) {
      if (generation !== permissionQueryGeneration) return;
      permissionStates[name] = '无法查询';
      record('permission_query_error', { permission: name, name: error.name, message: error.message });
    }
    renderEnvironment();
  }
}

function beginWatch() {
  if (!window.isSecureContext || !navigator.geolocation) {
    const error = { code: null, reason: !window.isSecureContext ? 'insecure_context' : 'api_unavailable', message: !window.isSecureContext ? '页面不是安全上下文' : '浏览器没有 Geolocation API' };
    geolocationErrors++;
    record('geolocation_error', error);
    text('geo-errors', geolocationErrors);
    text('geo-status', error.message, 'error');
    return;
  }
  text('geo-status', '正在请求浏览器定位权限，等待原始定位…');
  try {
    watchId = navigator.geolocation.watchPosition(position => {
      if (!monitoring) return;
      lastBrowserFix = { ...positionData(position), receivedWallTimeMs: Date.now(), receivedMonotonicMs: performance.now() };
      browserFixes++;
      record('position', lastBrowserFix);
      text('web-count', browserFixes);
      text('web-fix', JSON.stringify(lastBrowserFix, null, 2));
      renderFixAges();
      text('geo-status', `已收到定位 · 精度 ${lastBrowserFix.coords.accuracy ?? '未知'} m`, 'okay');
    }, error => {
      if (!monitoring) return;
      const data = geolocationErrorData(error);
      geolocationErrors++;
      record('geolocation_error', data);
      text('geo-errors', geolocationErrors);
      const label = ({ 1: '定位权限被拒绝', 2: '暂时无法获得定位', 3: '定位等待超时' })[data.code] || '定位错误';
      text('geo-status', `${label}（${data.code ?? '未知'}）：${data.message}。定位监听仍保持。`, 'error');
      renderEnvironment();
    }, WATCH_OPTIONS);
  } catch (error) {
    geolocationErrors++;
    record('geolocation_error', geolocationErrorData(error));
    text('geo-errors', geolocationErrors);
    text('geo-status', `调用定位 API 失败：${error.name}: ${error.message}`, 'error');
  }
}

function stopWatch(log = true) {
  if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
  watchId = null;
  const wasMonitoring = monitoring;
  monitoring = false;
  if (log && wasMonitoring) record('stop', { browserFixes, geolocationErrors });
  if (wasMonitoring) text('geo-status', '网页定位已停止');
  renderQueue();
}

$('start').addEventListener('click', () => {
  if (monitoring || !setupCollector()) return;
  monitoring = true;
  record('environment', environment());
  record('start', { watchOptions: WATCH_OPTIONS });
  // Start both permission-sensitive operations directly from the click, without awaiting either.
  pollStatus();
  beginWatch();
  queue.enable();
  queryPermissions();
  text('action-status', '测试已开始。网页定位与手机连接会分别显示结果。');
  renderQueue();
});

$('stop').addEventListener('click', () => {
  stopWatch();
  queue?.retry();
  text('action-status', '网页定位已停止，待发送日志会继续重试上传。手机采集请在手机停止。');
});

$('retry').addEventListener('click', () => {
  if (!setupCollector()) return;
  // Record evidence before the first fetch, so a denied local-network prompt is still exportable.
  record('environment', environment());
  record('connection_retry', { host: collectorConfig.host });
  pollStatus();
  queue.enable();
  queue.retry();
  queryPermissions();
});

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

$('export').addEventListener('click', () => {
  const data = {
    format: 'tiplay-nav-test-browser-v1', exportedWallTimeMs: Date.now(), clientId,
    environment: environment(), host: collectorConfig?.host ?? normalizeEndpoint($('host').value),
    androidStatus, lastBrowserFix, events: evidence, pendingEvents: queue?.snapshot() || [],
    upload: queue?.stats() || null, limits: { maxEvidenceEvents: MAX_EVIDENCE, maxPendingEvents: 512, evidenceFull, queueFull },
  };
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), `tiplay-nav-browser-${clientId}.json`);
});

$('download').addEventListener('click', async () => {
  if (!collector) return;
  $('download').disabled = true;
  try {
    const result = await collector.request('/log', { download: true });
    const serverName = /filename="?([a-zA-Z0-9_.-]+)"?/.exec(result.disposition || '')?.[1];
    saveBlob(result.blob, serverName || 'tiplay-nav-test.ndjson');
    text('action-status', '已请求下载手机日志。若浏览器不支持下载，请从手机导出。');
  } catch (error) {
    record('log_download_error', uploadErrorData(error));
    text('action-status', `手机日志下载失败：${connectionErrorText(error)} 可先导出本页 JSON。`, 'error');
  } finally {
    renderQueue();
  }
});

for (const type of ['online', 'offline']) window.addEventListener(type, () => {
  record('network', { event: type, online: navigator.onLine });
  renderEnvironment();
  if (type === 'online') queue?.retry();
});
document.addEventListener('visibilitychange', () => {
  record('visibility', { state: document.visibilityState });
  renderEnvironment();
  if (document.visibilityState === 'visible') queue?.retry();
});
window.addEventListener('pagehide', () => {
  stopWatch();
  // An authenticated CORS upload cannot reliably complete during page teardown. No delivery claim is made.
});

renderEnvironment();
renderQueue();
