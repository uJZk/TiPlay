/*! SPDX-License-Identifier: GPL-3.0-only */
import { SRPParameters } from './vendor/tssrp6a/parameters.js';
import { SRPRoutines } from './vendor/tssrp6a/routines.js';
import { SRPClientSession } from './vendor/tssrp6a/session-client.js';
import { bigIntToArrayBuffer, arrayBufferToBigInt } from './vendor/tssrp6a/utils.js';

const IDENTITY = 'TiPlay browser', PROTOCOL = 'TiPlay-RTC-SRP6a-v1';
const utf8 = new TextEncoder();
const parameters = new SRPParameters(SRPParameters.PrimeGroup[2048], SRPParameters.H.SHA256);

/** Adapt the established Nimbus SRP6a routines to Bouncy Castle's padded evidence and identity hash. */
export class BrowserSrpRoutines extends SRPRoutines {
  computeIdentityHash(identity, password) { return this.hash(utf8.encode(`${identity}:${password}`)); }
  async computeClientEvidence(_identity, _salt, a, b, secret) {
    return arrayBufferToBigInt(await this.hashPadded(...[a, b, secret].map(bigIntToArrayBuffer)));
  }
  async computeServerEvidence(a, proof, secret) {
    return arrayBufferToBigInt(await this.hashPadded(...[a, proof, secret].map(bigIntToArrayBuffer)));
  }
  async computeU(a, b) {
    const value = await super.computeU(a, b);
    if (value === 0n) throw new Error('Invalid phone pairing challenge.');
    return value;
  }
}

export function pairingRoutines() { return new BrowserSrpRoutines(parameters); }

function number(value, maximum) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !/^[0-9a-f]+$/.test(value)) throw new Error('Invalid phone pairing challenge.');
  return BigInt(`0x${value}`);
}

/** Length-prefixed transcript prevents ambiguity and binds both complete SDP messages and the media session. */
export function pairingTranscript(fields) {
  const parts = fields.map(value => utf8.encode(String(value)));
  const output = new Uint8Array(parts.reduce((size, part) => size + 4 + part.length, 0));
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const part of parts) { view.setUint32(offset, part.length); offset += 4; output.set(part, offset); offset += part.length; }
  return output;
}

async function post(fetchPhone, path, payload, signal) {
  let response;
  try { response = await fetchPhone(path, { method: 'POST', body: JSON.stringify(payload), signal }); }
  catch (error) { if (!signal?.aborted) error.rtcReason = 'fetch'; throw error; }
  let result = null;
  try { result = await response.json(); } catch (_) { /* Keep an HTTP refusal's status even for an HTML error page. */ }
  if (!response.ok) throw Object.assign(new Error('Phone pairing request refused.'), { status: response.status });
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Object.assign(new Error('Invalid phone pairing response.'), { rtcReason: 'bad-response' });
  return result;
}

/** A mature SRP6a PAKE authenticates the phone and SDP using the existing four-digit code alone. */
async function verifyRtcOffer({ fetchPhone, session, code, offer, signal }) {
  if (!/^[0-9]{4}$/.test(code)) throw new Error('Enter the four-digit pairing code from TiPlay.');
  const routines = pairingRoutines();
  const step1 = await new SRPClientSession(routines).step1(IDENTITY, code);
  const challenge = await post(fetchPhone, '/rtc/pair/start', { s: session }, signal);
  if (!/^[0-9a-f]{32}$/.test(challenge.id)) throw new Error('Invalid phone pairing challenge.');
  const salt = number(challenge.salt, 64), b = number(challenge.B, 512);
  if (salt === 0n || b <= 0n || b >= parameters.primeGroup.N) throw new Error('Invalid phone pairing challenge.');
  const proof = await step1.step2(salt, b);
  const a = proof.A.toString(16), m1 = proof.M1.toString(16);
  const answer = await post(fetchPhone, '/rtc/pair/finish', { id: challenge.id, s: session, A: a, M1: m1, offer }, signal);
  await proof.step3(number(answer.M2, 64));
  if (typeof answer.sdp !== 'string' || answer.sdp.length > 256 * 1024 ||
      !Number.isInteger(answer.session) || answer.session <= 0 || answer.session > 0xffffffff ||
      typeof answer.binding !== 'string' || !/^[0-9a-f]{64}$/.test(answer.binding)) throw new Error('Invalid phone connection answer.');
  const keyBytes = await routines.hashPadded(bigIntToArrayBuffer(proof.S));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const binding = new Uint8Array(answer.binding.match(/../g).map(byte => parseInt(byte, 16)));
  const transcript = pairingTranscript([PROTOCOL, challenge.id, session, a, challenge.B, challenge.salt, offer, answer.sdp, answer.session]);
  if (!await crypto.subtle.verify('HMAC', key, binding, transcript)) throw new Error('Phone verification failed. Re-enter the pairing code.');
  return { sdp: answer.sdp, session: answer.session, epoch: answer.epoch, type: answer.type,
    transport: answer.transport, fragmentBytes: answer.fragmentBytes };
}

export async function authenticateRtcOffer(options) {
  try { return await verifyRtcOffer(options); }
  catch (error) {
    if (!error.rtcReason && error.status === undefined && error.name !== 'AbortError') error.rtcReason = 'pairing';
    throw error;
  }
}
