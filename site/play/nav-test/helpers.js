// SPDX-License-Identifier: GPL-3.0-only
// The probe keeps browser timestamps independent from Android and server receive timestamps.
export const WATCH_OPTIONS = Object.freeze({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });

export function normalizeEndpoint(value) {
  const match = /^(?:(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})|(localhost))(?::([1-9]\d{0,4}))?$/i.exec(String(value || '').trim());
  if (!match) return null;
  const port = match[6] === undefined ? 18080 : Number(match[6]);
  if (port > 65535) return null;
  if (match[5]) return `localhost:${port}`;
  const octets = match.slice(1, 5).map(Number);
  return octets.some(octet => octet > 255) ? null : `${octets.join('.')}:${port}`;
}

export function parseConnection(search, hash) {
  const token = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('c');
  return {
    host: normalizeEndpoint(new URLSearchParams(String(search || '').replace(/^\?/, '')).get('t')),
    token: /^[a-zA-Z0-9_-]{16,128}$/.test(token || '') ? token : null,
  };
}

export function addressSpaceFor(host) {
  const [a, b] = String(host).split(/[.:]/).map(Number);
  if (a === 127 || /^localhost(:|$)/i.test(host)) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)) return 'local';
  return undefined;
}

const finiteOrNull = value => Number.isFinite(value) ? value : null;

export function positionData(position) {
  const coords = position.coords || {};
  return {
    timestamp: finiteOrNull(position.timestamp),
    coords: Object.fromEntries(['latitude', 'longitude', 'accuracy', 'altitude', 'altitudeAccuracy', 'heading', 'speed']
      .map(key => [key, finiteOrNull(coords[key])])),
  };
}

export function geolocationErrorData(error) {
  const code = Number(error.code);
  return {
    code: Number.isFinite(code) ? code : null,
    reason: ({ 1: 'permission_denied', 2: 'position_unavailable', 3: 'timeout' })[code] || 'unknown',
    message: String(error.message || ''),
    name: String(error.name || 'GeolocationPositionError'),
  };
}

export function eventFactory({ clientId, wallTime = () => Date.now(), monotonicTime = () => performance.now() }) {
  let sequence = 0;
  return (type, data) => ({
    id: `${clientId}:${++sequence}`,
    source: 'browser', type, clientWallTimeMs: wallTime(), clientMonotonicMs: monotonicTime(), data,
  });
}

export class CollectorError extends Error {
  constructor(category, message, status = null) {
    super(message);
    this.name = 'CollectorError';
    this.category = category;
    this.status = status;
  }
}

// A rejected fetch does not reveal whether HTTP, CORS, local-network policy or routing blocked it.
export function uploadErrorData(error) {
  return {
    category: error.category || (error.name === 'AbortError' ? 'request_timeout' : 'network_or_browser_policy'),
    status: Number.isFinite(error.status) ? error.status : null,
    name: String(error.name || 'Error'), message: String(error.message || error),
  };
}

export function createCollector({ host, token, fetchImpl = (...args) => fetch(...args), timeoutMs = 10000 }) {
  if (!normalizeEndpoint(host) || !token) throw new CollectorError('configuration', '手机地址或会话令牌无效');
  const base = `http://${normalizeEndpoint(host)}`;
  const targetAddressSpace = addressSpaceFor(host);

  async function request(path, { events, download = false } = {}) {
    if (!['/status', '/events', '/log'].includes(path)) throw new CollectorError('configuration', '未知采集接口');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const headers = { 'X-Nav-Test-Token': token };
    const init = { method: events ? 'POST' : 'GET', headers, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal };
    if (targetAddressSpace) init.targetAddressSpace = targetAddressSpace;
    if (events) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ events });
    }
    try {
      const response = await fetchImpl(`${base}${path}`, init);
      if (!response.ok) throw new CollectorError(response.status === 401 ? 'authentication' : 'http', `手机接口返回 HTTP ${response.status}`, response.status);
      if (download) return { blob: await response.blob(), disposition: response.headers.get('Content-Disposition') };
      try { return await response.json(); }
      catch (error) {
        if (abort.signal.aborted || error.name === 'AbortError') throw error;
        throw new CollectorError('response_format', '手机接口没有返回有效 JSON');
      }
    } catch (error) {
      if (error instanceof CollectorError) throw error;
      if (abort.signal.aborted || error.name === 'AbortError') throw new CollectorError('request_timeout', '手机请求超过等待时间');
      throw new CollectorError('network_or_browser_policy', `${error.name || 'Error'}: ${error.message || error}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { request, send: events => request('/events', { events }) };
}

/** Exactly one batch is in flight. Lost acknowledgements replay the same IDs for server deduplication. */
export function createEventQueue({
  send, maxEvents = 512, batchSize = 32, onError = () => {}, onAck = () => {}, onChange = () => {},
  schedule = (callback, ms) => setTimeout(callback, ms), cancel = timer => clearTimeout(timer),
}) {
  const pending = [];
  let enabled = false, inFlight = false, timer = null, attempt = 0, uploaded = 0, failures = 0;

  function changed() { onChange(stats()); }
  function stats() { return { pending: pending.length, inFlight, uploaded, failures, retryScheduled: timer !== null }; }

  function retryLater(error) {
    failures++;
    const delayMs = Math.min(8000, 500 * 2 ** Math.min(attempt++, 4));
    timer = schedule(() => { timer = null; flush(); }, delayMs);
    onError(error, { delayMs, failures });
    changed();
  }

  function flush() {
    if (!enabled || inFlight || timer !== null || !pending.length) return;
    const batch = pending.slice(0, batchSize);
    inFlight = true;
    changed();
    Promise.resolve().then(() => send(batch)).then(result => {
      const ids = result?.acknowledged;
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new CollectorError('acknowledgement', '手机未返回有效的事件确认列表');
      const acknowledged = new Set(ids), delivered = batch.filter(event => acknowledged.has(event.id));
      // Only IDs from this in-flight batch can remove events, including when a new event arrives meanwhile.
      const deliveredIds = new Set(delivered.map(event => event.id));
      for (let index = pending.length - 1; index >= 0; index--) {
        if (deliveredIds.has(pending[index].id)) pending.splice(index, 1);
      }
      inFlight = false;
      uploaded += delivered.length;
      if (delivered.length !== batch.length) {
        retryLater(new CollectorError('acknowledgement', '手机尚未确认本批次全部事件'));
      } else {
        attempt = 0;
      }
      if (delivered.length) onAck(delivered);
      changed();
      flush();
    }).catch(error => {
      inFlight = false;
      retryLater(error);
    });
  }

  return {
    push(event) {
      if (pending.some(existing => existing.id === event.id)) return true;
      if (pending.length >= maxEvents) return false;
      pending.push(event);
      changed();
      flush();
      return true;
    },
    enable() { enabled = true; flush(); },
    retry() { if (timer !== null) cancel(timer); timer = null; flush(); changed(); },
    snapshot: () => pending.slice(), stats,
  };
}
