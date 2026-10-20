import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, webcrypto } from 'node:crypto';
// Upstream browser ESM crypto adapter selects window.crypto, just as it does in the page.
globalThis.window = { crypto: webcrypto };
const { authenticateRtcOffer, pairingRoutines, pairingTranscript } = await import('../../site/play/rtc-pairing.js');
const { SRPClientSession } = await import('../../site/play/vendor/tssrp6a/session-client.js');
const { SRPServerSession } = await import('../../site/play/vendor/tssrp6a/session-server.js');
const { bigIntToArrayBuffer } = await import('../../site/play/vendor/tssrp6a/utils.js');
const vector = JSON.parse(await readFile(new URL('./fixtures/rtc-srp.json', import.meta.url), 'utf8'));

test('vendored SRP client matches real Bouncy Castle 1.79 proof and shared-key vector', async () => {
  const routines = pairingRoutines(); routines.generatePrivateValue = () => BigInt(`0x${vector.a}`);
  const proof = await (await new SRPClientSession(routines).step1('TiPlay browser', vector.code))
    .step2(BigInt(`0x${vector.salt}`), BigInt(`0x${vector.B}`));
  assert.equal(proof.A.toString(16), vector.A);
  assert.equal(proof.M1.toString(16), vector.M1);
  assert.equal(proof.S.toString(16), vector.S);
  await proof.step3(BigInt(`0x${vector.M2}`));
  const key = Buffer.from(await routines.hashPadded(bigIntToArrayBuffer(proof.S)));
  assert.equal(key.toString('hex'), vector.K);
  const transcript = pairingTranscript(['TiPlay-RTC-SRP6a-v1', vector.id, vector.session, vector.A, vector.B, vector.salt, vector.offer, vector.sdp, vector.rtcSession]);
  assert.equal(createHmac('sha256', key).update(transcript).digest('hex'), vector.binding);
});

async function exchange({ changed = null, clientCode = vector.code } = {}) {
  const routines = pairingRoutines(), salt = BigInt(`0x${vector.salt}`);
  const verifier = routines.computeVerifier(await routines.computeX('TiPlay browser', salt, vector.code));
  const server = await new SRPServerSession(routines).step1('TiPlay browser', salt, verifier);
  const requests = [];
  const fetchPhone = async (path, options) => {
    const body = JSON.parse(options.body); requests.push({ path, body });
    if (path.endsWith('/start')) return { ok: true, json: async () => ({ id: vector.id, salt: vector.salt, B: server.B.toString(16) }) };
    let M2;
    try { M2 = await server.step2(BigInt(`0x${body.A}`), BigInt(`0x${body.M1}`)); }
    catch (_) { return { ok: false, status: 401, json: async () => ({ error: 'Pairing code did not match' }) }; }
    const secret = await server.sessionKey(BigInt(`0x${body.A}`));
    const key = Buffer.from(await routines.hashPadded(bigIntToArrayBuffer(secret)));
    const answer = { M2: M2.toString(16), sdp: vector.sdp, session: vector.rtcSession, epoch: vector.rtcSession, type: 'answer', fragmentBytes: 16384, transport: 'webrtc-datachannel-v1' };
    answer.binding = createHmac('sha256', key).update(pairingTranscript(['TiPlay-RTC-SRP6a-v1', vector.id, vector.session,
      body.A, server.B.toString(16), vector.salt, body.offer, answer.sdp, answer.session])).digest('hex');
    if (changed === 'sdp') answer.sdp += 'changed';
    if (changed === 'offer') answer.binding = createHmac('sha256', key).update(pairingTranscript(['TiPlay-RTC-SRP6a-v1', vector.id,
      vector.session, body.A, server.B.toString(16), vector.salt, body.offer + 'changed', answer.sdp, answer.session])).digest('hex');
    if (changed === 'session') answer.session++;
    if (changed === 'proof') answer.M2 = '1';
    return { ok: true, json: async () => answer };
  };
  const result = await authenticateRtcOffer({ fetchPhone, session: vector.session, code: clientCode, offer: vector.offer });
  return { result, requests };
}

test('four-digit pairing authenticates SDP without exposing a password or reusable hash on HTTP', async () => {
  const { result, requests } = await exchange();
  assert.deepEqual(result, { sdp: vector.sdp, session: vector.rtcSession, epoch: vector.rtcSession, type: 'answer', fragmentBytes: 16384, transport: 'webrtc-datachannel-v1' });
  assert.deepEqual(Object.keys(requests[0].body), ['s']);
  assert.deepEqual(Object.keys(requests[1].body), ['id', 's', 'A', 'M1', 'offer']);
  assert.equal(JSON.stringify(requests).includes(`"${vector.code}"`), false);
});

test('wrong password, forged server proof and SDP/session transcript splice all fail closed', async () => {
  await assert.rejects(exchange({ clientCode: '0000' }), error => error.status === 401);
  for (const changed of ['sdp', 'offer', 'session']) await assert.rejects(exchange({ changed }), /verification failed/);
  await assert.rejects(exchange({ changed: 'proof' }), /Bad server credentials/);
});


test('HTTP interface failures keep their status even when the server returns HTML', async () => {
  for (const status of [404, 503]) {
    await assert.rejects(authenticateRtcOffer({ session: vector.session, code: vector.code, offer: vector.offer,
      fetchPhone: async () => ({ ok: false, status, json: async () => { throw new SyntaxError('HTML error'); } }),
    }), error => error.status === status);
  }
});

test('network fetch failure is distinct from PAKE evidence rejection', async () => {
  await assert.rejects(authenticateRtcOffer({ session: vector.session, code: vector.code, offer: vector.offer,
    fetchPhone: async () => { throw new TypeError('Failed to fetch'); },
  }), error => error.rtcReason === 'fetch');
  await assert.rejects(exchange({ changed: 'proof' }), error => error.rtcReason === 'pairing');
});
