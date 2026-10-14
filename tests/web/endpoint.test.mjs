import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function applyStatus(');
const apply = source.slice(start, source.indexOf('\n}', start) + 2);

test('legacy endpoint status cannot change the browser address or reconnect it', () => {
  let link = { host: '169.254.111.111:8080', code: '1234' };
  let status, portalRevision = null, fitRequestedAt = 0;
  const effects = [];
  const browserAudio = { status() {} }, airplayControls = { update() {} };
  const render = () => {}, showPortal = () => effects.push('portal');
  const applyStatus = eval(`(${apply})`);
  applyStatus({ endpoint: '100.70.1.2:9000', fit: false });
  assert.deepEqual(link, { host: '169.254.111.111:8080', code: '1234' });
  assert.deepEqual(effects, []);
  assert.equal(status.endpoint, '100.70.1.2:9000');
});
