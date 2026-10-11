import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
const functions = ['showPortal', 'resumeCarPlay', 'applyStatus'].map(name => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}).join('\n');

function page() {
  return new Function(`
    let active = true, portalRevision = null, status = null, fitRequestedAt = 0;
    let releases = 0, resizes = 0;
    const stage = { hidden: false }, panel = { hidden: true };
    const $ = () => panel;
    const releaseTouches = () => releases++;
    const onResize = () => resizes++;
    const render = () => {};
    ${functions}
    return { applyStatus, resumeCarPlay, stage, panel,
      state: () => ({ active, releases, resizes }) };
  `)();
}

test('TiPlay icon returns to the portal once and keeps the session available to resume', () => {
  const p = page();
  p.applyStatus({ portalRevision: 7 });
  assert.equal(p.stage.hidden, false, 'initial status establishes a baseline');
  p.applyStatus({ portalRevision: 8 });
  assert.equal(p.stage.hidden, true);
  assert.equal(p.panel.hidden, false);
  assert.deepEqual(p.state(), { active: true, releases: 1, resizes: 0 });
  p.resumeCarPlay();
  assert.equal(p.stage.hidden, false);
  assert.equal(p.panel.hidden, true);
  p.applyStatus({ portalRevision: 8 });
  assert.deepEqual(p.state(), { active: true, releases: 1, resizes: 1 });
  p.applyStatus({ portalRevision: 9 });
  assert.equal(p.stage.hidden, true);
});

test('older phone status without portal notifications keeps the display open', () => {
  const p = page();
  p.applyStatus({ state: 'streaming' });
  assert.equal(p.stage.hidden, false);
  assert.equal(p.state().releases, 0);
});
