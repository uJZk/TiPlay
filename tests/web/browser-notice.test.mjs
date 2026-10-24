import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserNotice } from '../../site/play/browser-notice.js';

function fixture() {
  const nodes = Object.fromEntries(['heading', 'message', 'close'].map(key => [key, {
    textContent: '', addEventListener(_, fn) { this.click = fn; },
  }]));
  const root = { hidden: true, querySelector(selector) { return nodes[selector.match(/data-browser-(\w+)/)[1]]; } };
  return { root, nodes, notice: createBrowserNotice(root, 'zh') };
}

test('browser errors persist and closing them survives repeated status polls', () => {
  const f = fixture();
  const problem = { id: 'codec:hvc1', text: 'This browser cannot decode HEVC.' };
  f.notice.update(problem);
  assert.equal(f.root.hidden, false);
  assert.equal(f.nodes.message.textContent, problem.text);
  assert.equal(f.nodes.close.textContent, '关闭');
  f.notice.update(null);
  assert.equal(f.root.hidden, false, 'successful polls do not erase the explanation');
  f.nodes.close.click();
  for (let i = 0; i < 100; i++) f.notice.update(problem);
  assert.equal(f.root.hidden, true);
  f.notice.update({ id: 'protocol', text: 'Update the app.' });
  assert.equal(f.root.hidden, false, 'a different error can appear');
});

test('starting an explicit new connection resets dismissed errors', () => {
  const f = fixture();
  const problem = { id: 'protocol', text: 'Update the app.' };
  f.notice.update(problem);
  f.nodes.close.click();
  f.notice.reset();
  assert.equal(f.root.hidden, true);
  f.notice.update(problem);
  assert.equal(f.root.hidden, false);
});

test('a new casting attempt can retire its old fault without clearing a different important error', () => {
  const f = fixture();
  f.notice.update({ id: 'airplay:1:playback-failed', text: 'Try casting again.' });
  f.notice.reset('airplay:1:playback-failed');
  assert.equal(f.root.hidden, true);
  f.notice.update({ id: 'protocol', text: 'Update the app.' });
  f.notice.reset('airplay:1:playback-failed');
  assert.equal(f.root.hidden, false);
  assert.equal(f.nodes.message.textContent, 'Update the app.');
});
