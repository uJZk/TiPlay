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
    let releases = 0, resizes = 0, viewportCancellations = 0;
    const stage = { hidden: false }, panel = { hidden: true };
    const $ = () => panel;
    const releaseTouches = () => releases++;
    const cancelViewport = () => viewportCancellations++;
    const onResize = () => resizes++;
    const render = () => {};
    const browserLocation = { update() {} };
    const browserAudio = { status() {} }, airplayControls = { update() {} };
    const trustUpdates = [];
    let trustPrompt = null;
    const airplayTrust = { update(prompt) { trustUpdates.push(prompt); trustPrompt = prompt ?? null; } };
    ${functions}
    return { applyStatus, resumeCarPlay, stage, panel,
      trustUpdates, trustPrompt: () => trustPrompt,
      state: () => ({ active, releases, resizes, viewportCancellations }) };
  `)();
}

test('TiPlay icon returns to the portal once and keeps the session available to resume', () => {
  const p = page();
  p.applyStatus({ portalRevision: 7 });
  assert.equal(p.stage.hidden, false, 'initial status establishes a baseline');
  p.applyStatus({ portalRevision: 8 });
  assert.equal(p.stage.hidden, true);
  assert.equal(p.panel.hidden, false);
  assert.deepEqual(p.state(), { active: true, releases: 1, resizes: 0, viewportCancellations: 1 });
  p.resumeCarPlay();
  assert.equal(p.stage.hidden, false);
  assert.equal(p.panel.hidden, true);
  p.applyStatus({ portalRevision: 8 });
  assert.deepEqual(p.state(), { active: true, releases: 1, resizes: 1, viewportCancellations: 1 });
  p.applyStatus({ portalRevision: 9 });
  assert.equal(p.stage.hidden, true);
  assert.equal(p.state().viewportCancellations, 2, 'each portal entry cancels any pending viewport report');
});

test('older phone status without portal notifications keeps the display open', () => {
  const p = page();
  p.applyStatus({ state: 'streaming' });
  assert.equal(p.stage.hidden, false);
  assert.equal(p.state().releases, 0);
  assert.equal(p.state().viewportCancellations, 0);
});

test('first-use AirPlay consent remains available on the paired portal and clears with server cancellation', () => {
  const p = page();
  const prompt = { id: 'approval-1', name: 'iPhone', verified: true, remainingMillis: 5000 };
  p.applyStatus({ portalRevision: 7, airplayTrust: prompt });
  assert.equal(p.trustPrompt(), prompt);
  p.applyStatus({ portalRevision: 8, airplayTrust: prompt });
  assert.equal(p.stage.hidden, true);
  assert.equal(p.panel.hidden, false);
  assert.equal(p.trustPrompt(), prompt, 'returning to settings retains the paired channel needed for approval');
  const countdown = { ...prompt, remainingMillis: 2500 };
  p.applyStatus({ portalRevision: 8, airplayTrust: countdown });
  assert.equal(p.trustPrompt(), countdown, 'portal status polls continue updating the live approval');
  p.applyStatus({ portalRevision: 8, airplayTrust: null });
  assert.equal(p.trustPrompt(), null);
  assert.deepEqual(p.trustUpdates, [prompt, prompt, countdown, null]);
});
