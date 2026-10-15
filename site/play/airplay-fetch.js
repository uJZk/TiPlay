// SPDX-License-Identifier: GPL-3.0-only
/** Abort a hung header/body read, preserve caller cancellation, and never cache sliding manifests. */
export async function fetchMediaResource(fetcher, url, init = {}, { signal, deadline = 15000 } = {}) {
  const controller = new AbortController();
  const signals = [init.signal, signal].filter(Boolean);
  const abort = event => controller.abort(event?.target?.reason);
  for (const parent of signals) {
    if (parent.aborted) abort({ target: parent });
    else parent.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException('Media resource timed out.', 'TimeoutError')), deadline);
  const cleanup = () => {
    clearTimeout(timer); for (const parent of signals) parent.removeEventListener('abort', abort);
  };
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.body) { cleanup(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(stream) {
        try {
          const result = await reader.read();
          if (result.done) { cleanup(); stream.close(); } else stream.enqueue(result.value);
        } catch (cause) { cleanup(); stream.error(cause); }
      },
      async cancel(reason) { cleanup(); await reader.cancel(reason); },
    });
    const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    // Pathed HLS sources resolve segment URLs against the final manifest URL after redirects.
    Object.defineProperties(result, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
    return result;
  } catch (cause) { cleanup(); throw cause; }
}
