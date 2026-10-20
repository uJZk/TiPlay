// SPDX-License-Identifier: GPL-3.0-only
// Real browser/WebCrypto SRP server fixture using the production BC-compatible routines.
export async function installSrpFixture(page, { code = '2718', moduleBase = '/' } = {}) {
  await page.evaluate(async ({ code, moduleBase }) => {
    const base = new URL(moduleBase, location.href);
    const { pairingRoutines, pairingTranscript } = await import(new URL('rtc-pairing.js', base).href);
    const { SRPServerSession } = await import(new URL('vendor/tssrp6a/session-server.js', base).href);
    const { bigIntToArrayBuffer } = await import(new URL('vendor/tssrp6a/utils.js', base).href);
    const pending = new Map(), verified = new Map();
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    const refused = () => ({ status: 401, body: { error: 'code' } });
    globalThis.__srpFixture = {
      mode: 'success',
      async start(body) {
        if (typeof body.s !== 'string' || pending.size >= 32) return refused();
        const routines = pairingRoutines(), saltBytes = crypto.getRandomValues(new Uint8Array(32)); saltBytes[0] |= 1;
        const salt = hex(saltBytes), id = hex(crypto.getRandomValues(new Uint8Array(16)));
        const saltValue = BigInt(`0x${salt}`);
        const verifier = routines.computeVerifier(await routines.computeX('TiPlay browser', saltValue, code));
        const server = await new SRPServerSession(routines).step1('TiPlay browser', saltValue, verifier);
        const B = server.B.toString(16);
        pending.set(id, { routines, server, salt, B, session: body.s, expires: performance.now() + 30000 });
        return { status: 200, body: { id, salt, B } };
      },
      async verify(body) {
        const state = pending.get(body.id); pending.delete(body.id);
        if (!state || state.expires < performance.now() || state.session !== body.s) return refused();
        try {
          const M2 = await state.server.step2(BigInt(`0x${body.A}`), BigInt(`0x${body.M1}`));
          const secret = await state.server.sessionKey(BigInt(`0x${body.A}`));
          const keyBytes = await state.routines.hashPadded(bigIntToArrayBuffer(secret));
          const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          verified.set(body.id, { ...state, M2: M2.toString(16), key });
          return { status: 200, body: { verified: true } };
        } catch (_) { return refused(); }
      },
      async bind(body, answer) {
        const state = verified.get(body.id); verified.delete(body.id);
        if (!state) return refused();
        const result = { ...answer, session: answer.session ?? answer.epoch, M2: state.M2 };
        const offer = this.mode === 'offer' ? body.offer + 'tampered' : body.offer;
        result.binding = hex(await crypto.subtle.sign('HMAC', state.key, pairingTranscript([
          'TiPlay-RTC-SRP6a-v1', body.id, body.s, body.A, state.B, state.salt, offer, result.sdp, result.session,
        ])));
        if (this.mode === 'proof') result.M2 = '1';
        if (this.mode === 'binding') result.binding = '00'.repeat(32);
        if (this.mode === 'answer') result.sdp += 'tampered';
        if (this.mode === 'session') result.session++;
        return { status: 200, body: result };
      },
    };
  }, { code, moduleBase });
}
