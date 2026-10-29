// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDiagnosticLog } from '../../site/play/browser-diagnostic-log.js';

test('state changes are newest first, bounded, and repeated snapshots do not flood the log', () => {
  const log = createBrowserDiagnosticLog({ language: 'zh', limit: 3 });
  log.observe({ phase: 'connecting', stage: 'pairing' });
  log.observe({ phase: 'connecting', stage: 'pairing' });
  assert.equal(log.lines().length, 2);
  log.observe({ phase: 'waiting', stage: 'connected', source: 'carplay', live: true });
  assert.deepEqual(log.lines(), ['已收到画面', '已切换到 CarPlay', '媒体连接已建立']);
});

test('diagnostics accept only safe reason codes and note transitions and recovery', () => {
  const log = createBrowserDiagnosticLog();
  log.observe({ videoError: 'secret\nhttps://example.com/password' });
  assert.deepEqual(log.lines(), ['Video failure：rtc-video-failed']);
  log.observe({ videoError: null });
  assert.equal(log.lines()[0], 'Video error cleared');
  log.observeSummary({ 'video.errorReason': 'codec-profile-not-negotiated', 'audio.nativeAudio.state': 'failed', 'video.decodeErrors': 1 });
  log.observeSummary({ 'video.errorReason': 'codec-profile-not-negotiated', 'audio.nativeAudio.state': 'failed', 'video.decodeErrors': 1 });
  assert.equal(log.lines().filter(line => line === 'Video decode errors increased').length, 1);
  assert.ok(log.lines().includes('Audio connection failed'));
  assert.doesNotMatch(log.lines().join(' '), /secret|https|password/);
  log.observe({ videoError: '12345678-abcd-1234-abcd-123456789abc' });
  assert.doesNotMatch(log.lines().join(' '), /12345678/);
});

test('a sparse summary cannot clear a previously observed video failure', () => {
  const log = createBrowserDiagnosticLog();
  log.observe({ videoError: 'codec-profile-not-negotiated' });
  log.observeSummary({ 'link.connection.stage': 'connected' });
  assert.ok(!log.lines().includes('Video error cleared'));
});

test('counter reset and reconnection produce new events without periodic counter spam', () => {
  const log = createBrowserDiagnosticLog();
  log.observeSummary({ 'video.decodeErrors': 1 });
  log.observeSummary({ 'video.decodeErrors': 0 });
  log.observeSummary({ 'video.decodeErrors': 1 });
  assert.equal(log.lines().length, 2);
  log.observe({ phase: 'connecting', stage: 'pairing' });
  log.observe({ phase: 'retry', failure: 'timeout' });
  log.observe({ phase: 'connecting', stage: 'pairing' });
  assert.equal(log.lines().filter(line => line === 'Verifying pairing').length, 2);
});

test('foreground video preparation, buffering and return to CarPlay are distinct transitions', () => {
  const log = createBrowserDiagnosticLog({ language: 'zh' });
  log.observe({ source: 'video', playback: { ready: false, resource: 'https://secret.invalid/path' } });
  log.observe({ source: 'video', playback: { ready: true, buffering: true } });
  log.observe({ source: 'carplay', playback: null, live: true });
  assert.deepEqual(log.lines(), ['已收到画面', '已切换到 CarPlay', '视频正在缓冲', '正在准备视频', '已切换到视频']);
  assert.doesNotMatch(log.lines().join(' '), /secret|https/);
});

test('updating the log preserves an older reading position and otherwise stays at the top', () => {
  const log = createBrowserDiagnosticLog();
  let content = '', scrollHeight = 100;
  const element = { scrollTop: 40, get scrollHeight() { return scrollHeight; },
    get textContent() { return content; }, set textContent(value) { content = value; scrollHeight = 120; } };
  log.observe({ phase: 'connecting' }); log.render(element);
  assert.equal(element.scrollTop, 40);
  element.scrollTop = 0; log.observe({ phase: 'retry' }); log.render(element);
  assert.equal(element.scrollTop, 0);
});

test('reading position is retained when the bounded log replaces an old line', () => {
  const log = createBrowserDiagnosticLog({ limit: 2 });
  let content = '';
  const element = { scrollTop: 0, scrollHeight: 40,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ lineHeight: '20px' }) } },
    get textContent() { return content; }, set textContent(value) { content = value; } };
  log.observe({ phase: 'connecting' }); log.observe({ phase: 'retry' }); log.render(element);
  element.scrollTop = 10;
  log.observe({ phase: 'idle' }); log.render(element);
  assert.equal(element.scrollTop, 10);
});

test('folded diagnostics update without programmatically moving a non-top scroll position', () => {
  const log = createBrowserDiagnosticLog();
  let content = '', top = 12, writes = 0;
  const element = { get scrollTop() { return top; }, set scrollTop(value) { writes++; top = value; },
    get textContent() { return content; }, set textContent(value) { content = value; } };
  log.observe({ phase: 'connecting' }); log.render(element);
  assert.equal(writes, 0);
  assert.equal(top, 12);
  assert.equal(content, 'Connecting to Android');
});
