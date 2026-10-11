// SPDX-License-Identifier: GPL-3.0-only
// The page must read the golden stream that the phone-side WebVideoRecordsTest writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { HEADER_BYTES, RecordParser } from '../../site/play/link.js';

const fixtures = new URL('../../shared/src/test/resources/web/', import.meta.url);
const binary = new URL('records-v1.bin', fixtures), expectation = new URL('records-v1.json', fixtures);
const missing = [binary, expectation].filter(file => !existsSync(file)).map(file => file.pathname);
const skip = missing.length ? `fixture missing: ${missing.join(', ')}` : false;
const load = () => ({ bytes: new Uint8Array(readFileSync(binary)), golden: JSON.parse(readFileSync(expectation, 'utf8')) });
const base64 = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const fields = ({ payloadLength, kind, flags, codec, version, sequence, epoch, timestampUs, payload }) =>
  ({ payloadLength, kind, flags, codec, version, sequence, epoch, timestampUs, payload: base64(payload) });

test('golden records-v1.bin parses to records-v1.json', { skip }, () => {
  const { bytes, golden } = load();
  assert.equal(golden.headerSize, HEADER_BYTES);
  const expected = golden.records.map(({ name, offset, ...record }) => record);
  assert.deepEqual(new RecordParser().push(bytes).map(fields), expected);
  const parser = new RecordParser();
  const byteByByte = [];
  for (let i = 0; i < bytes.length; i++) byteByByte.push(...parser.push(bytes.subarray(i, i + 1)));
  assert.deepEqual(byteByByte.map(fields), expected);
  let offset = 0;
  for (const record of golden.records) {
    assert.equal(record.offset, offset, record.name);
    offset += HEADER_BYTES + record.payloadLength;
  }
  assert.equal(offset, bytes.length);
});
