// SPDX-License-Identifier: GPL-3.0-only
// Real WebCrypto/BC-vector pairing over HTTP, followed by the shared genuine TDR1 integration harness.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { listen, closeServer } from './resources.mjs';
import { installSrpFixture } from './srp-fixture.mjs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const root = resolve(fileURLToPath(new URL('../../site/play/', import.meta.url)));
const code = '2718', requests = [];
let phone, browser, client;
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/test/vector') {
      const bytes = await readFile(new URL('../web/fixtures/rtc-srp.json', import.meta.url));
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(bytes); return;
    }
    if (pathname === '/rtc/pair/start' || pathname === '/rtc/pair/finish') {
      let body = ''; for await (const bytes of request) { body += bytes; if (body.length > 128 * 1024) throw new Error('Oversized offer'); }
      const parsed = JSON.parse(body);
      requests.push({ path: request.url, fields: Object.keys(parsed).sort(), exposedCode: 'c' in parsed || 'code' in parsed });
      const answer = await phone.evaluate(async ({ path, body }) => {
        if (path.endsWith('/start')) return globalThis.__srpFixture.start(body);
        const checked = await globalThis.__srpFixture.verify(body);
        if (checked.status !== 200) return checked;
        return globalThis.__srpFixture.bind(body, { session: 177, sdp: 'v=0\r\na=fingerprint:sha-256 PHONE\r\n' });
      }, { path: pathname, body: parsed });
      assert.equal('resourceToken' in answer.body, false, 'pairing HTTP never exposes resource bearer');
      response.writeHead(answer.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(answer.body)); return;
    }
    if (pathname === '/test/pairing-mode') {
      let mode = ''; for await (const bytes of request) mode += bytes;
      await phone.evaluate(mode => { globalThis.__srpFixture.mode = mode; }, mode);
      response.writeHead(204); response.end(); return;
    }
    if (pathname === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>SRP check</title>');
    const path = resolve(root, pathname.slice(1));
    if (!path.startsWith(root + sep) || !path.endsWith('.js')) return response.writeHead(404).end();
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(bytes);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
try {
  await listen(server, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox', '--no-proxy-server', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const context = await browser.newContext(), pageErrors = [];
  phone = await context.newPage(); phone.on('pageerror', error => pageErrors.push(error.message));
  await phone.goto(origin); await installSrpFixture(phone);
  client = await context.newPage(); client.on('pageerror', error => pageErrors.push(error.message)); await client.goto(origin);
  const pairingResult = await client.evaluate(async code => {
    const { authenticateRtcOffer, pairingRoutines, pairingTranscript } = await import('/rtc-pairing.js');
    const { SRPClientSession } = await import('/vendor/tssrp6a/session-client.js');
    const { bigIntToArrayBuffer } = await import('/vendor/tssrp6a/utils.js');
    const vector = await (await fetch('/test/vector')).json(), routines = pairingRoutines();
    routines.generatePrivateValue = () => BigInt('0x' + vector.a);
    const proof = await (await new SRPClientSession(routines).step1('TiPlay browser', vector.code))
      .step2(BigInt('0x' + vector.salt), BigInt('0x' + vector.B));
    if (proof.A.toString(16) !== vector.A || proof.M1.toString(16) !== vector.M1 || proof.S.toString(16) !== vector.S) throw new Error('BC 1.79 cross-language vector mismatch');
    await proof.step3(BigInt('0x' + vector.M2));
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    const keyBytes = await routines.hashPadded(bigIntToArrayBuffer(proof.S));
    if (hex(keyBytes) !== vector.K) throw new Error('BC 1.79 shared key mismatch');
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const binding = hex(await crypto.subtle.sign('HMAC', key, pairingTranscript(['TiPlay-RTC-SRP6a-v1', vector.id,
      vector.session, vector.A, vector.B, vector.salt, vector.offer, vector.sdp, vector.rtcSession])));
    if (binding !== vector.binding) throw new Error('BC 1.79 transcript binding mismatch');
    const cases = [];
    for (const mode of ['success', 'proof', 'binding', 'offer', 'answer', 'session', 'wrong-code']) {
      await fetch('/test/pairing-mode', { method: 'POST', body: mode });
      let accepted = false, status = null;
      try {
        const answer = await authenticateRtcOffer({ fetchPhone: (path, options) => fetch(path, options), session: 'pairing-probe-session',
          code: mode === 'wrong-code' ? '0000' : code, offer: 'v=0\r\na=fingerprint:sha-256 CLIENT\r\n' });
        accepted = answer.session === 177;
      } catch (error) { status = error.status || error.message; }
      if (accepted !== (mode === 'success')) throw new Error('Pairing case ' + mode + ' did not fail closed');
      cases.push({ mode, accepted, status });
    }
    await fetch('/test/pairing-mode', { method: 'POST', body: 'success' });
    return { passed: true, bouncyCastle179Vector: true, cases, engine: 'Chromium native WebCrypto + production SRP6a helper' };
  }, code);
  assert.equal(requests.length, 14);
  assert.equal(requests.some(request => request.exposedCode || request.path.includes(code)), false);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ pairing: pairingResult, sctpConnected: false, androidNativeMeasured: false, physicalOutputMeasured: false }, null, 2));

} finally {
  await browser?.close(); await closeServer(server);
}
if (!process.argv.includes('--pairing-only')) await import('./webrtc.mjs');
