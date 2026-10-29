import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEmbeddedCaptionParser, extractCaptionTriples, CAPTION_LIMITS } from '../../site/play/vendor/captions/parser.js';

const triple = (a, b, time = 1, type = 0) => ({ type, a, b, time });
const epb = bytes => {
  const result = []; let zeros = 0;
  for (const byte of bytes) { if (zeros >= 2 && byte <= 3) { result.push(3); zeros = 0; } result.push(byte); zeros = byte === 0 ? zeros + 1 : 0; }
  return result;
};
function packet(triples, { hevc = false, size = 4, annexb = true, valid = true } = {}) {
  const payload = [181, 0, 49, 71, 65, 57, 52, 3, 64 | triples.length, 255,
    ...triples.flatMap(value => [(valid ? 4 : 0) | value.type, value.a, value.b])];
  const nal = [...(hevc ? [78, 1] : [6]), ...epb([4, payload.length, ...payload, 128])];
  return new Uint8Array(annexb ? [0, 0, 0, 1, ...nal] :
    [...Array.from({ length: size }, (_, index) => Math.floor(nal.length / 256 ** (size - index - 1)) & 255), ...nal]);
}
function digital(block, { service = 1, sequence = 0, time = 1 } = {}) {
  const bytes = [...(service < 7 ? [(service << 5) | block.length] : [224 | block.length, service]), ...block];
  if (bytes.length % 2 === 0) bytes.push(0);
  const result = [triple(sequence << 6 | (bytes.length + 1) / 2, bytes[0], time, 3)];
  for (let index = 1; index < bytes.length; index += 2) result.push(triple(bytes[index], bytes[index + 1], time, 2));
  return result;
}
const define = (text, visible = true) => [152, visible ? 32 : 0, 0, 0, 0, 0, 0, ...new TextEncoder().encode(text)];
function parser() { const updates = []; return { updates, decoder: createEmbeddedCaptionParser({ onUpdate: value => updates.push(value) }) }; }

test('AVC and HEVC SEI extraction supports explicit Annex B and NAL length sizes without editing input', () => {
  for (const hevc of [false, true]) for (const annexb of [false, true]) for (const size of [1, 2, 3, 4]) {
    const input = packet([triple(20, 32), triple(0, 0, 2, 2)], { hevc, annexb, size });
    const copy = input.slice();
    assert.deepEqual(extractCaptionTriples(input, { ptsSeconds: 4.5, codec: hevc ? 'hvc1.1.6' : 'avc1.64002a',
      format: annexb ? 'annexb' : 'length-prefixed', configuration: { nalLengthSize: size } }),
    [triple(20, 32, 4.5), triple(0, 0, 4.5, 2)]);
    assert.deepEqual(input, copy);
  }
});

test('decoder configuration supplies NAL length size and non-caption/invalid input creates no triples', () => {
  assert.equal(extractCaptionTriples(packet([triple(20, 32)], { annexb: false, size: 2 }), {
    ptsSeconds: 0, codec: 'avc', format: 'length-prefixed', configuration: new Uint8Array([1, 0, 0, 0, 1]) }).length, 1);
  for (const options of [{ ptsSeconds: NaN }, { ptsSeconds: 1, codec: 'av1' }, { ptsSeconds: 1, configuration: { nalLengthSize: 8 }, format: 'length-prefixed' }])
    assert.deepEqual(extractCaptionTriples(packet([triple(20, 32)]), options), []);
  assert.deepEqual(extractCaptionTriples(packet([triple(20, 32)], { valid: false }), { ptsSeconds: 1 }), []);
  assert.deepEqual(extractCaptionTriples(new Uint8Array([0, 0, 0, 30, 6, 4]), { ptsSeconds: 1 }), []);
  assert.deepEqual(extractCaptionTriples(new Uint8Array(CAPTION_LIMITS.packetBytes + 1), { ptsSeconds: 1 }), []);
  const oversizedSei = new Uint8Array(CAPTION_LIMITS.seiBytes + 5); oversizedSei.set([0, 0, 0, 1, 6]);
  assert.deepEqual(extractCaptionTriples(oversizedSei, { ptsSeconds: 1 }), []);
  assert.deepEqual(extractCaptionTriples(new Uint8Array([0, 0, 1, 101, 1, 2]), { ptsSeconds: 1 }), []);
});

test('608 pop-on uses display changes, ignores repeated EOC, and emits explicit clear at source PTS', () => {
  const { updates, decoder } = parser();
  decoder.pushTriples([triple(20, 32, 1), triple(200, 201, 1.1)]);
  assert.deepEqual(updates, []);
  decoder.pushTriples([triple(20, 47, 2), triple(20, 47, 2.1)]);
  assert.deepEqual(updates, [{ service: 'CC1', text: 'HI', time: 2 }]);
  decoder.pushTriples([triple(20, 44, 3)]);
  assert.deepEqual(updates.at(-1), { service: 'CC1', text: '', time: 3 });
});

test('608 fields/channels stay distinct and roll-up carries displayed rows', () => {
  const { updates, decoder } = parser();
  decoder.pushTriples([triple(20, 37), triple(65, 66, 2), triple(20, 45, 3), triple(67, 68, 4)]);
  assert.match(updates.at(-1).text, /AB\nCD/);
  decoder.pushTriples([triple(28, 32, 5), triple(88, 89, 5.1), triple(28, 47, 6),
    triple(20, 32, 7, 1), triple(77, 78, 7.1, 1), triple(20, 47, 8, 1)]);
  assert.ok(updates.some(value => value.service === 'CC2' && value.text === 'XY'));
  assert.ok(updates.some(value => value.service === 'CC3' && value.text === 'MN'));
});

test('708 service/window assembly handles hide, sequence loss, extended service and reset', () => {
  const { updates, decoder } = parser();
  decoder.pushTriples(digital(define('HI')));
  assert.deepEqual(updates.at(-1), { service: 'SERVICE1', text: 'HI', time: 1 });
  decoder.pushTriples(digital([138, 1], { sequence: 1, time: 2 }));
  assert.deepEqual(updates.at(-1), { service: 'SERVICE1', text: '', time: 2 });
  decoder.pushTriples(digital([137, 1], { sequence: 2, time: 3 }));
  assert.equal(updates.at(-1).text, 'HI');
  decoder.pushTriples(digital(define('NEW'), { sequence: 0, time: 4 }));
  assert.deepEqual(updates.slice(-2), [{ service: 'SERVICE1', text: '', time: 4 }, { service: 'SERVICE1', text: 'NEW', time: 4 }]);
  decoder.pushTriples(digital(define('EXT'), { service: 42, sequence: 1, time: 5 }));
  assert.equal(updates.at(-1).service, 'SERVICE42');
  decoder.pushTriples([triple(128 | 5, 255, 5.5, 3)]);
  decoder.pushTriples(digital(define('AFTER LOSS'), { sequence: 3, time: 5.7 }));
  assert.ok(updates.some(value => value.service === 'SERVICE42' && value.text === '' && value.time === 5.7));
  decoder.reset(); const count = updates.length;
  decoder.pushTriples(digital([137, 1], { sequence: 0, time: 6 }));
  assert.equal(updates.length, count);
});

test('708 contiguous replacement of an unfinished packet clears old displayed state', () => {
  const { updates, decoder } = parser();
  decoder.pushTriples(digital(define('OLD'), { sequence: 0 }));
  decoder.pushTriples([triple(1 << 6 | 5, 255, 2, 3)]);
  decoder.pushTriples(digital([137, 1], { sequence: 2, time: 3 }));
  assert.deepEqual(updates.at(-1), { service: 'SERVICE1', text: '', time: 3 });
  assert.equal(updates.filter(value => value.text === 'OLD').length, 1);
  decoder.pushTriples(digital(define('NEW'), { sequence: 3, time: 4 }));
  assert.deepEqual(updates.at(-1), { service: 'SERVICE1', text: 'NEW', time: 4 });
});

test('no caption evidence and malformed DTVCC do not discover services; parser has bounded state', () => {
  const { updates, decoder } = parser();
  decoder.push(new Uint8Array([0, 0, 1, 101, 0]), { ptsSeconds: 1, codec: 'avc' });
  decoder.pushTriples([triple(0, 0), triple(5, 255, 2, 3)]);
  decoder.pushTriples(Array(CAPTION_LIMITS.triples + 1).fill(triple(65, 66)));
  decoder.pushTriples([{ type: 0, a: -1, b: 0, time: 1 }, { type: 0, a: 20, b: 32, time: Infinity }]);
  assert.deepEqual(updates, []);
  decoder.reset();
  for (let service = 1; service <= 12; service++) decoder.pushTriples(digital(define('OK'), { service, sequence: (service - 1) & 3, time: service }));
  assert.equal(new Set(updates.map(value => value.service)).size, CAPTION_LIMITS.services708);
});

test('generated parser and extractor retain matching hashes and pinned dependency sources', async () => {
  const root = new URL('../../site/play/vendor/captions/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('artifacts.json', root), 'utf8'));
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(new URL(artifact.path, root));
    assert.equal(bytes.length, artifact.bytes, artifact.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.path);
  }
  assert.equal(manifest.dependency.version, '1.6.19');
  const archive = await readFile(new URL('source/hls.js-1.6.19.tgz', root));
  assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), manifest.dependency.integrity);
});
