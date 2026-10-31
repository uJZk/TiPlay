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
  assert.equal(log.lines().filter(line => line === 'Video decode errors increased：total 1').length, 1);
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

test('capabilities explain codec choice without exposing capability strings', () => {
  const log = createBrowserDiagnosticLog({ language: 'zh' });
  log.observe({ capability: { status: 'available', h264: true, hevc: false, detail: 'private-device' } });
  log.observe({ capability: { status: 'available', h264: true, hevc: false } });
  assert.deepEqual(log.lines(), ['浏览器 WebRTC 视频：H.264 支持，H.265 未报告']);
  log.observe({ capability: { status: 'query-failed', detail: 'secret exception' } });
  log.observe({ capability: { status: 'empty' } });
  log.observe({ capability: { status: 'api-unavailable' } });
  assert.deepEqual(log.lines().slice(0, 3), ['浏览器不提供 WebRTC 编码查询接口', '浏览器返回的 WebRTC 编码列表为空', '浏览器 WebRTC 编码查询失败']);
  assert.doesNotMatch(log.lines().join(' '), /private|secret/);
});

test('video format and numeric failures give useful bounded detail without raw input', () => {
  const log = createBrowserDiagnosticLog({ language: 'zh' });
  log.observe({ phase: 'retry', failure: 'timeout', videoConfig: { codec: 'avc1.64002a', width: 1920, height: 1080, url: 'https://secret.invalid' } });
  log.observe({ videoError: 'rtc-video-first-frame-timeout' });
  log.observe({ videoError: 'rtc-video-first-presentation-timeout' });
  log.observe({ videoError: 'video-source-configuration-invalid' });
  log.observeSummary({ 'video.decodeErrors': 2, 'video.droppedFrames': 5, 'transport.iceState': 'connected', 'transport.selectedProtocol': 'udp' });
  log.observeSummary({ 'video.decodeErrors': 4, 'video.droppedFrames': 5, 'transport.iceState': 'connected', 'transport.selectedProtocol': 'udp' });
  assert.ok(log.lines().includes('连接中断，正在重试（连接超时）'));
  assert.ok(log.lines().includes('视频格式：H.264，1920 × 1080'));
  assert.ok(log.lines().includes('视频错误：rtc-video-first-frame-timeout（等待首帧超时）'));
  assert.ok(log.lines().includes('视频错误：rtc-video-first-presentation-timeout（等待画面首次显示超时）'));
  assert.ok(log.lines().includes('视频错误：video-source-configuration-invalid（源视频配置无效）'));
  assert.ok(log.lines().includes('视频解码错误增加：累计 4（+2）'));
  assert.ok(log.lines().includes('网络传输：UDP'));
  assert.equal(log.lines().filter(line => line === '网络传输：UDP').length, 1);
  log.observeSummary({ 'link.failure.reason': 'ice', 'link.failure.localCandidates': 2, 'link.failure.remoteCandidates': 0 });
  assert.ok(log.lines().includes('连接失败：网络连接失败；浏览器候选 2，安卓端候选 0'));
  log.observe({ videoConfig: { codec: 'https://secret.invalid', width: 1, height: 1 } });
  assert.doesNotMatch(log.lines().join(' '), /https|secret/);
});

test('failure details come from the retired failure snapshot and can recur after reconnect', () => {
  const log = createBrowserDiagnosticLog({ language: 'zh' });
  const failure = { 'link.failure.reason': 'ice', 'link.failure.localCandidates': 2, 'link.failure.remoteCandidates': 0 };
  log.observeSummary(failure);
  log.observeSummary(failure);
  const message = '连接失败：网络连接失败；浏览器候选 2，安卓端候选 0';
  assert.equal(log.lines().filter(line => line === message).length, 1);
  // Successful flattened snapshots omit null fields; no explicit null is required.
  log.observeSummary({ 'link.connection.stage': 'connected' });
  log.observeSummary(failure);
  assert.equal(log.lines().filter(line => line === message).length, 2);
  log.observe({ phase: 'connecting' });
  log.observeSummary(failure);
  assert.equal(log.lines().filter(line => line === message).length, 3);
});

test('new video and connection owners report their own initial nonzero counters', () => {
  const log = createBrowserDiagnosticLog();
  log.observeSummary({ 'video.streamGeneration': 1, 'video.epoch': 1, 'video.decodeErrors': 8,
    'transport.generation': 1, 'transport.reassemblyErrors': 8, 'control.failures': 8 });
  log.observeSummary({ 'video.streamGeneration': 1, 'video.epoch': 2, 'video.decodeErrors': 1,
    'transport.generation': 1, 'transport.reassemblyErrors': 8, 'control.failures': 8 });
  assert.ok(log.lines().includes('Video decode errors increased：total 1'));
  log.observeSummary({ 'video.streamGeneration': 2, 'video.epoch': 1, 'video.decodeErrors': 1,
    'transport.generation': 2, 'transport.reassemblyErrors': 1, 'control.failures': 1 });
  assert.equal(log.lines().filter(line => line === 'Video decode errors increased：total 1').length, 2);
  assert.ok(log.lines().includes('Media reassembly errors increased：total 1'));
  assert.ok(log.lines().includes('Control request failures increased：total 1'));
  log.observe({ phase: 'connecting' });
  log.observeSummary({ 'video.decodeErrors': 1, 'transport.reassemblyErrors': 1, 'control.failures': 1 });
  assert.equal(log.lines().filter(line => line === 'Control request failures increased：total 1').length, 2);
  log.observeSummary({ 'link.reconnects': 1, 'video.streamGeneration': 1, 'video.epoch': 1, 'video.decodeErrors': 1 });
  log.observeSummary({ 'link.reconnects': 2, 'video.streamGeneration': 1, 'video.epoch': 1, 'video.decodeErrors': 1 });
  assert.equal(log.lines().filter(line => line === 'Video decode errors increased：total 1').length, 4);
});
