// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareSrpMath, SrpMath } from './libtommath/libtommath.js';

const bytes = await readFile(new URL('./libtommath/libtommath.wasm', import.meta.url));
const module = prepareSrpMath(await WebAssembly.compile(bytes));

test('the complete arithmetic library is exported with a fixed private heap', () => {
  const math = new SrpMath();
  try {
    assert.equal(math.api.memory.buffer.byteLength, 2 * 1024 * 1024);
    assert.throws(() => math.api.memory.grow(1), RangeError);
    for (const name of ['mp_exptmod', 'mp_prime_is_prime', 'mp_rand', 'mp_to_radix', 'mp_sqrt', 'mp_invmod'])
      assert.equal(typeof math.api[name], 'function', `${name} remains in the full library`);
    assert.ok(WebAssembly.Module.exports(module).length > 250);
    assert.deepEqual([...new Set(WebAssembly.Module.imports(module).map(value => value.module))], ['wasi_snapshot_preview1']);
  } finally { math.dispose(); }
});

test('genuine modular arithmetic preserves odd/even modulus, zero powers and bounded operands', () => {
  const math = new SrpMath();
  try {
    for (const modulus of [2n, 16n, 97n, 65537n]) for (const base of [0n, 1n, 19n, modulus * 2n + 1n])
      for (const exponent of [0n, 1n, 3n, 17n]) {
        assert.equal(math.modPow(base, exponent, modulus), base ** exponent % modulus);
        assert.ok(math.scratch.every(value => value === 0), 'hex scratch is erased after every operation');
      }
    for (const operands of [[-1n, 1n, 97n], [1n, -1n, 97n], [1n, 1n, 0n], [1n, 1n, 1n],
      [1, 1n, 97n], [1n << 2052n, 1n, 97n], [1n, 1n << 2052n, 97n], [1n, 1n, 1n << 2048n]])
      assert.throws(() => math.modPow(...operands), RangeError);
  } finally { math.dispose(); }
});

test('private heap is explicitly erased after disposal even when C free retains old limb bytes', () => {
  const math = new SrpMath(), heap = new Uint8Array(math.api.memory.buffer);
  math.modPow(123456789n, 1025n, (1n << 2048n) - 159n);
  assert.ok(heap.some(value => value !== 0));
  math.dispose(); math.dispose();
  assert.ok(heap.every(value => value === 0));
  assert.throws(() => math.modPow(2n, 17n, 97n), /disposed/);
  const replacement = new SrpMath();
  try { assert.equal(replacement.modPow(2n, 17n, 97n), 25n); }
  finally { replacement.dispose(); }
});

test('allocation failure clears scratch, frees partial MPI initialization and permits retry', () => {
  const math = new SrpMath(), pointers = [];
  try {
    for (const size of [1024, 16]) for (let count = 0; count < 10000; count++) {
      const pointer = math.api.malloc(size);
      if (!pointer) break;
      pointers.push(pointer);
    }
    assert.throws(() => math.modPow(2n, 17n, 97n), /arithmetic failed/);
    assert.ok(math.scratch.every(value => value === 0));
    for (const pointer of pointers.splice(0)) math.api.free(pointer);
    assert.equal(math.modPow(2n, 17n, 97n), 25n);
  } finally { math.dispose(); }
});

test('a hung module preparation expires and a later load retries the genuine module', async () => {
  const fresh = await import('./libtommath/libtommath.js?retry-test');
  const fetch = globalThis.fetch;
  let attempts = 0, signal;
  globalThis.fetch = (_url, options) => {
    attempts++; signal = options.signal;
    return attempts === 1 ? new Promise(() => {}) : Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
  };
  try {
    const pending = fresh.loadSrpMath({ timeoutMs: 5 });
    assert.equal(fresh.loadSrpMath(), pending, 'concurrent handshakes share one bounded preparation');
    await assert.rejects(pending, error => /preparation timed out/.test(error.message) && error.rtcReason === 'timeout');
    assert.equal(signal.aborted, true);
    const loaded = await fresh.loadSrpMath();
    assert.ok(loaded instanceof WebAssembly.Module); assert.equal(attempts, 2);
    const math = new fresh.SrpMath();
    try { assert.equal(math.modPow(2n, 17n, 97n), 25n); }
    finally { math.dispose(); }
  } finally { globalThis.fetch = fetch; }
});

test('an unavailable browser arithmetic asset stays a retryable connection failure', async () => {
  const fresh = await import('./libtommath/libtommath.js?http-failure-test');
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try { await assert.rejects(fresh.loadSrpMath(), error => error.rtcReason === 'connection'); }
  finally { globalThis.fetch = fetch; }
});

test('the benchmark candidate preserves real Bouncy Castle proof, key and transcript vectors', async () => {
  globalThis.window = { crypto };
  const { BrowserSrpRoutines, pairingTranscript } = await import('../../../site/play/rtc-pairing.js');
  const { SRPParameters } = await import('../../../site/play/vendor/tssrp6a/parameters.js');
  const { SRPClientSession } = await import('../../../site/play/vendor/tssrp6a/session-client.js');
  const { bigIntToArrayBuffer } = await import('../../../site/play/vendor/tssrp6a/utils.js');
  const { createCandidateRoutines } = await import('./candidate.js');
  const vector = JSON.parse(await readFile(new URL('../../web/fixtures/rtc-srp.json', import.meta.url), 'utf8'));
  const routines = createCandidateRoutines(BrowserSrpRoutines,
    new SRPParameters(SRPParameters.PrimeGroup[2048], SRPParameters.H.SHA256));
  try {
    routines.generatePrivateValue = () => BigInt('0x' + vector.a);
    const proof = await (await new SRPClientSession(routines).step1('TiPlay browser', vector.code))
      .step2(BigInt('0x' + vector.salt), BigInt('0x' + vector.B));
    assert.equal(proof.A.toString(16), vector.A); assert.equal(proof.M1.toString(16), vector.M1);
    assert.equal(proof.S.toString(16), vector.S); await proof.step3(BigInt('0x' + vector.M2));
    const keyBytes = await routines.hashPadded(bigIntToArrayBuffer(proof.S));
    assert.equal(Buffer.from(keyBytes).toString('hex'), vector.K);
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const transcript = pairingTranscript(['TiPlay-RTC-SRP6a-v1', vector.id, vector.session, vector.A,
      vector.B, vector.salt, vector.offer, vector.sdp, vector.rtcSession]);
    assert.equal(Buffer.from(await crypto.subtle.sign('HMAC', key, transcript)).toString('hex'), vector.binding);
  } finally { routines.dispose(); }
});
