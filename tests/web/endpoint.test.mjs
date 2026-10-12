import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeHost } from '../../site/play/link.js';

const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
const functions = ['migrateEndpoint', 'applyStatus'].map(name => {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');

function page(active = true) {
  return new Function('normalizeHost', 'active', `
    let link = { host: '169.254.111.111:8080', code: '1234' };
    const session = 'existing-session', outbox = { sequence: 42 };
    let streamId = 5, live = true, attempt = 3, status, fitRequestedAt = 0, portalRevision = null;
    const effects = [], field = {};
    const $ = () => field;
    const releaseTouches = () => effects.push('release');
    const saveLink = () => effects.push(['save', { ...link }]);
    const showLink = () => effects.push(['bookmark', link.host]);
    const videoAbort = { abort: () => effects.push(['abort', streamId]) };
    const sink = { stop: () => effects.push('stop-video') };
    const scheduleRetry = delay => effects.push(['retry', delay]);
    const render = () => {}, showPortal = () => {};
    const browserAudio = { status() {} }, airplayControls = { update() {} };
    ${functions}
    return { applyStatus, effects, field,
      state: () => ({ link, session, outbox, streamId, live, attempt, active }) };
  `)(normalizeHost, active);
}

test('authenticated endpoint changes move transports and saved bookmarks without ending the session', () => {
  const p = page();
  p.applyStatus({ endpoint: '169.254.111.112:9000' });
  assert.deepEqual(p.state(), {
    link: { host: '169.254.111.112:9000', code: '1234' }, session: 'existing-session',
    outbox: { sequence: 42 }, streamId: 6, live: false, attempt: 0, active: true,
  });
  assert.deepEqual(p.effects, ['release', ['save', { host: '169.254.111.112:9000', code: '1234' }],
    ['bookmark', '169.254.111.112:9000'], ['abort', 6], 'stop-video', ['retry', 1500]]);
  assert.equal(p.field.value, '169.254.111.112:9000');
  p.applyStatus({ endpoint: '169.254.111.112:9000' });
  assert.equal(p.effects.length, 6, 'a repeated announcement does not restart the migration');
});

test('invalid or absent announcements and announcements after Disconnect cannot change the target', () => {
  for (const endpoint of [undefined, 'invalid', 'https://example.test', '256.0.0.1:8080']) {
    const p = page();
    p.applyStatus({ endpoint });
    assert.deepEqual(p.effects, [], String(endpoint));
    assert.equal(p.state().link.host, '169.254.111.111:8080');
  }
  const p = page(false);
  p.applyStatus({ endpoint: '169.254.111.112:9000' });
  assert.deepEqual(p.effects, []);
  assert.equal(p.state().active, false);
});
