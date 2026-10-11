// SPDX-License-Identifier: GPL-3.0-only
/** Keep assertion evidence bounded. Overflow fails the run instead of silently hiding earlier errors. */
export class History extends Array {
  static get [Symbol.species]() { return Array; }
  constructor(limit = 20000) {
    super();
    this.limit = limit;
    this.total = 0;
  }
  push(...items) {
    this.total += items.length;
    super.push(...items.slice(0, Math.max(0, this.limit - this.length)));
    return this.length;
  }
  assertComplete() {
    if (this.total !== this.length) throw new Error(`test history exceeded ${this.limit} entries (${this.total} received)`);
  }
}

/** Install the error listener before listen: startup failure rejects and retires the server. */
export function listen(server, host) {
  return new Promise((resolve, reject) => {
    const failed = error => {
      server.closeAllConnections();
      server.close();
      reject(error);
    };
    server.once('error', failed);
    server.listen(0, host, () => {
      server.off('error', failed);
      resolve(server);
    });
  });
}

export async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
