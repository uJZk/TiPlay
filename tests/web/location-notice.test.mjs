import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationNotice } from '../../site/play/location-notice.js';

function fixture(language = 'zh') {
  const nodes = Object.fromEntries(['heading', 'message', 'close'].map(key => [key, {
    textContent: '', addEventListener(_, fn) { this.click = fn; },
  }]));
  const root = { hidden: true, querySelector(selector) { return nodes[selector.match(/data-location-(\w+)/)[1]]; } };
  return { root, nodes, notice: createLocationNotice(root, language) };
}

test('permission guidance names both choices and remains until explicitly closed', () => {
  const f = fixture();
  f.notice.show('permission');
  assert.equal(f.root.hidden, false);
  assert.match(f.nodes.message.textContent, /浏览器设置.*允许定位/);
  assert.match(f.nodes.message.textContent, /安卓端.*高级设置.*禁用网页端定位/);
  assert.equal(f.nodes.close.textContent, '关闭');
  // Repeated status/error updates cannot remove or dismiss the card.
  for (let i = 0; i < 100; i++) f.notice.show('permission');
  assert.equal(f.root.hidden, false);
  f.nodes.close.click();
  assert.equal(f.root.hidden, true);
  f.notice.show('permission');
  assert.equal(f.root.hidden, true, 'heartbeats cannot reopen a dismissed warning');
});

test('HTTPS and unsupported-browser guidance shares the same persistent card', () => {
  const f = fixture('en');
  f.notice.show('insecure');
  assert.match(f.nodes.message.textContent, /HTTPS/);
  assert.match(f.nodes.message.textContent, /Disable browser location/);
  f.nodes.close.click();
  f.notice.show('unsupported');
  assert.equal(f.root.hidden, false);
  assert.match(f.nodes.message.textContent, /does not support/);
  f.nodes.close.click();
  f.notice.show('anything');
  assert.equal(f.root.hidden, true);
});
