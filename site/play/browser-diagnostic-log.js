/*! SPDX-License-Identifier: GPL-3.0-only */

// This is a view of bounded, safe state transitions, not another telemetry stream.
export function createBrowserDiagnosticLog({ language = 'en', limit = 100 } = {}) {
  const zh = language === 'zh', entries = [], states = new Map(), counters = new Map();
  const say = (en, cn) => zh ? cn : en;
  // Only fixed protocol codes may reach the visible log; even a syntactically
  // valid arbitrary string could be an address, session identifier or token.
  const videoReasons = new Set(['rtc-video-failed', 'rtc-video-first-frame-timeout', 'rtc-video-codecs-unavailable',
    'rtc-video-track-ended', 'rtc-video-frame-transfer-failed', 'rtc-video-worker-failed', 'rtc-video-processor-unavailable',
    'rtc-video-track-transfer-failed', 'rtc-video-renegotiation-failed', 'rtc-video-unavailable',
    'codec-profile-not-negotiated', 'video-codec-not-negotiated', 'encoder-codec-mismatch', 'reordered-video-timestamp',
    'video-encoder-input-timeout', 'video-encoder-selection-timeout', 'video-encoder-start-timeout', 'video-ready-timeout',
    'encoded-video-rejected', 'native-buffer-not-preserved', 'pixel-adaptation-requested', 'pixel-conversion-requested']);
  const failureReasons = new Set(['fetch', 'missing-interface', 'android-signaling', 'pairing', 'bad-response', 'ice', 'unsupported', 'timeout']);
  const reason = (value, allowed) => typeof value === 'string' && allowed.has(value) ? value : null;
  const add = text => { entries.unshift(text.slice(0, 240)); if (entries.length > limit) entries.length = limit; };
  const change = (key, value, text) => {
    if (value == null || states.get(key) === value) return;
    states.set(key, value);
    if (text) add(text);
  };
  const stageText = {
    'local-ice': say('Checking browser connection', '正在检查浏览器连接'),
    pairing: say('Verifying pairing', '正在验证配对'),
    'remote-ice': say('Checking Android connection', '正在检查安卓端连接'),
    'dc-auth': say('Establishing media channels', '正在建立媒体通道'),
    connected: say('Media connection established', '媒体连接已建立'),
  };
  return {
    observe({ phase, stage, source, live, videoError, audioState, failure, playback } = {}) {
      if (['connecting', 'retry', 'idle'].includes(phase)) {
        if (states.get('phase') !== phase) states.delete('stage');
        change('phase', phase, {
        connecting: say('Connecting to Android', '正在连接安卓端'),
        retry: `${say('Connection interrupted; retrying', '连接中断，正在重试')}${reason(failure, failureReasons) ? ` (${reason(failure, failureReasons)})` : ''}`,
        idle: say('Disconnected', '已断开连接'),
        }[phase]);
      }
      else if (phase) change('phase', phase, null);
      if (stageText[stage]) change('stage', stage, stageText[stage]);
      if (['carplay', 'airplay', 'video'].includes(source)) change('source', source,
        source === 'carplay' ? say('CarPlay selected', '已切换到 CarPlay') :
          source === 'airplay' ? say('AirPlay selected', '已切换到 AirPlay') : say('Video selected', '已切换到视频'));
      else if (source === null) change('source', 'none', null);
      if (playback && typeof playback === 'object') {
        const state = playback.buffering ? 'buffering' : playback.ready ? playback.playing ? 'playing' : 'paused' : 'preparing';
        change('playback', state, {
          buffering: say('Video is buffering', '视频正在缓冲'),
          playing: say('Video is playing', '视频正在播放'),
          paused: say('Video is paused', '视频已暂停'),
          preparing: say('Preparing video', '正在准备视频'),
        }[state]);
      } else if (playback === null) change('playback', 'none', null);
      if (typeof live === 'boolean') change('live', live, live ? say('Picture received', '已收到画面') : null);
      if (videoError !== undefined) {
        const error = videoError ? reason(videoError, videoReasons) || 'rtc-video-failed' : null;
        change('video-error', error || 'none', error ? `${say('Video failure', '视频错误')}：${error}` :
          states.has('video-error') && states.get('video-error') !== 'none' ? say('Video error cleared', '视频错误已清除') : null);
      }
      if (['failed', 'connected'].includes(audioState)) change('audio', audioState,
        audioState === 'failed' ? say('Audio connection failed', '音频连接失败') : say('Audio connection restored', '音频连接已恢复'));
    },
    observeSummary(summary) {
      if (!summary || typeof summary !== 'object') return;
      const audio = summary['audio.nativeAudio.peerState'] === 'connected' ? 'connected' :
        summary['audio.nativeAudio.peerState'] === 'failed' || summary['audio.nativeAudio.state'] === 'failed' ? 'failed' : null;
      this.observe({ stage: summary['link.connection.stage'], videoError: summary['video.errorReason'], audioState: audio });
      for (const [key, en, cn] of [
        ['video.decodeErrors', 'Video decode errors increased', '视频解码错误增加'],
        ['transport.reassemblyErrors', 'Media reassembly errors increased', '媒体重组错误增加'],
        ['control.failures', 'Control request failures increased', '控制请求失败增加'],
      ]) {
        const count = summary[key];
        if (!Number.isSafeInteger(count) || count < 0) continue;
        const old = counters.get(key);
        if ((old == null && count > 0) || (old != null && count > old)) add(say(en, cn));
        counters.set(key, count);
      }
    },
    lines() { return entries.slice(); },
    render(element) {
      const text = entries.join('\n');
      if (element.textContent === text) return;
      const atTop = element.scrollTop <= 0;
      element.textContent = text;
      if (atTop) element.scrollTop = 0;
    },
  };
}
