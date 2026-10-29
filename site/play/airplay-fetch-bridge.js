// SPDX-License-Identifier: GPL-3.0-only
// The IO Worker cannot fetch a private HTTP resource from an HTTPS document in
// Chromium, even when the same request is permitted on the document thread.
// Only the Android resource endpoint is bridged; AVPlayer still owns loading.
export function createAirPlayFetchBridge(origin, { fetchResource = globalThis.fetch, Channel = globalThis.BroadcastChannel } = {}) {
  if (typeof Channel !== 'function' || !globalThis.crypto?.randomUUID) return null;
  const endpoint = new URL(origin);
  if (endpoint.protocol !== 'http:') return null;
  const name = `tiplay-media-${crypto.randomUUID()}`;
  const channel = new Channel(name), requests = new Map();
  let disposed = false;
  const send = message => { if (!disposed) channel.postMessage(message); };
  const close = id => {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id); request.controller.abort();
    void request.reader?.cancel().catch(() => {});
  };
  channel.onmessage = ({ data }) => {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id;
    if (data.type === 'cancel') { close(id); return; }
    if (data.type === 'pull') {
      const request = requests.get(id);
      if (!request?.reader || request.pulling) return;
      request.pulling = true;
      void request.reader.read().then(({ value, done }) => {
        if (requests.get(id) !== request) return;
        request.pulling = false;
        if (done) { requests.delete(id); send({ id, type: 'end' }); }
        else send({ id, type: 'chunk', value });
      }, () => { if (requests.get(id) === request) { close(id); send({ id, type: 'error', name: 'NetworkError' }); } });
      return;
    }
    if (data.type !== 'request' || requests.has(id)) return;
    if (requests.size >= 32) { send({ id, type: 'error', name: 'NetworkError' }); return; }
    let target;
    try { target = new URL(data.url); } catch (_) { send({ id, type: 'error', name: 'SecurityError' }); return; }
    if (target.origin !== endpoint.origin || target.pathname !== '/airplay-resource' || target.username || target.password) {
      send({ id, type: 'error', name: 'SecurityError' }); return;
    }
    const headers = new Headers();
    if (typeof data.range === 'string' && /^bytes=\d+-\d*$/.test(data.range)) headers.set('Range', data.range);
    else if (data.range != null) { send({ id, type: 'error', name: 'SecurityError' }); return; }
    const request = { controller: new AbortController(), reader: null, pulling: false };
    requests.set(id, request);
    void Promise.resolve().then(() => fetchResource(target.href, { method: 'GET', headers, signal: request.controller.signal,
      cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit', redirect: data.proxyOnly ? 'error' : 'follow', targetAddressSpace: 'local' }))
      .then(response => {
        if (requests.get(id) !== request) { void response.body?.cancel(); return; }
        request.reader = response.body?.getReader() || null;
        send({ id, type: 'response', status: response.status, statusText: response.statusText, headers: [...response.headers],
          url: response.url, redirected: response.redirected, responseType: response.type, body: Boolean(request.reader) });
        if (!request.reader) requests.delete(id);
      }, error => { if (requests.get(id) === request) { requests.delete(id); send({ id, type: 'error', name: error?.name === 'AbortError' ? 'AbortError' : 'NetworkError' }); } });
  };
  return { name, dispose() { if (disposed) return; for (const id of requests.keys()) close(id); disposed = true; channel.close(); } };
}
