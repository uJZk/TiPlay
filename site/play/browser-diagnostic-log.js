/*! SPDX-License-Identifier: GPL-3.0-only */

// This is a view of bounded, safe state transitions, not another telemetry stream.
export function createBrowserDiagnosticLog({ language = 'en', limit = 100 } = {}) {
  const zh = language === 'zh', entries = [], states = new Map(), counters = new Map();
  const scopes = { video: {}, connection: {} };
  const say = (en, cn) => zh ? cn : en;
  // Only fixed protocol codes may reach the visible log; even a syntactically
  // valid arbitrary string could be an address, session identifier or token.
  const videoReasons = new Set(['rtc-video-failed', 'rtc-video-first-frame-timeout', 'rtc-video-first-presentation-timeout', 'rtc-video-codecs-unavailable',
    'rtc-video-track-ended', 'rtc-video-frame-transfer-failed', 'rtc-video-worker-failed', 'rtc-video-processor-unavailable',
    'rtc-video-track-transfer-failed', 'rtc-video-renegotiation-failed', 'rtc-video-unavailable',
    'video-source-configuration-invalid',
    'codec-profile-not-negotiated', 'video-codec-not-negotiated', 'encoder-codec-mismatch', 'reordered-video-timestamp',
    'video-encoder-input-timeout', 'video-encoder-selection-timeout', 'video-encoder-start-timeout', 'video-ready-timeout',
    'encoded-video-rejected', 'native-buffer-not-preserved', 'pixel-adaptation-requested', 'pixel-conversion-requested']);
  const failureReasons = new Set(['fetch', 'missing-interface', 'android-signaling', 'pairing', 'bad-response', 'ice', 'unsupported', 'timeout', 'connection', 'throttled', 'bad-code', 'replaced']);
  const reason = (value, allowed) => typeof value === 'string' && allowed.has(value) ? value : null;
  const failureText = {
    fetch: say('cannot reach Android', '无法访问安卓端'), 'missing-interface': say('browser API unavailable', '浏览器接口不可用'),
    'android-signaling': say('Android signaling failed', '安卓端信令失败'), pairing: say('pairing verification failed', '配对验证失败'),
    'bad-response': say('invalid Android response', '安卓端响应无效'), ice: say('network connection failed', '网络连接失败'),
    unsupported: say('browser feature unavailable', '浏览器能力不足'), timeout: say('connection timed out', '连接超时'),
    connection: say('connection could not be established', '无法建立连接'), throttled: say('connection requests are rate limited', '连接请求过于频繁'),
    'bad-code': say('pairing code was rejected', '配对码被拒绝'), replaced: say('connection was replaced', '连接已被替换'),
  };
  const videoText = {
    'rtc-video-first-frame-timeout': say('first frame timed out', '等待首帧超时'),
    'rtc-video-first-presentation-timeout': say('first Canvas presentation timed out', '等待画面首次显示超时'),
    'video-source-configuration-invalid': say('source video configuration is invalid', '源视频配置无效'),
    'rtc-video-codecs-unavailable': say('no supported WebRTC video codec', '没有可用的 WebRTC 视频编码'),
    'codec-profile-not-negotiated': say('video codec profile was not negotiated', '视频编码配置未协商成功'),
    'video-codec-not-negotiated': say('video codec was not negotiated', '视频编码未协商成功'),
    'rtc-video-renegotiation-failed': say('video renegotiation failed', '视频重新协商失败'),
    'video-ready-timeout': say('video readiness timed out', '等待视频就绪超时'),
    'rtc-video-track-ended': say('video track ended', '视频轨道已结束'),
    'rtc-video-processor-unavailable': say('video frame reader unavailable', '视频画面读取接口不可用'),
  };
  const codecName = value => {
    const codec = typeof value === 'string' ? value.toLowerCase().split('.')[0] : '';
    return ({ avc1: 'H.264', avc3: 'H.264', h264: 'H.264', hvc1: 'H.265', hev1: 'H.265', h265: 'H.265', hevc: 'H.265' })[codec] || null;
  };
  const add = text => { entries.unshift(text.slice(0, 240)); if (entries.length > limit) entries.length = limit; };
  const change = (key, value, text) => {
    if (value == null || states.get(key) === value) return;
    states.set(key, value);
    if (text) add(text);
  };
  const resetCounters = prefix => {
    for (const key of counters.keys()) if (key.startsWith(prefix)) counters.delete(key);
  };
  const resetConnection = () => {
    counters.clear(); scopes.video = {}; scopes.connection = {};
    states.delete('failure-detail'); states.delete('ice'); states.delete('protocol');
  };
  const observeScope = (scope, summary, keys, prefixes) => {
    const stored = scopes[scope];
    let changed = false;
    for (const key of keys) {
      const value = summary[key];
      if (!Number.isSafeInteger(value) || value < 0) continue;
      if (stored[key] !== undefined && stored[key] !== value) changed = true;
      stored[key] = value;
    }
    if (changed) for (const prefix of prefixes) resetCounters(prefix);
    return changed;
  };
  const stageText = {
    'local-ice': say('Checking browser connection', '正在检查浏览器连接'),
    pairing: say('Verifying pairing', '正在验证配对'),
    'remote-ice': say('Checking Android connection', '正在检查安卓端连接'),
    'dc-auth': say('Establishing media channels', '正在建立媒体通道'),
    connected: say('Media connection established', '媒体连接已建立'),
  };
  return {
    observe({ phase, stage, source, live, videoError, audioState, failure, playback, capability, videoConfig } = {}) {
      if (['connecting', 'retry', 'idle'].includes(phase)) {
        if (states.get('phase') !== phase) {
          states.delete('stage');
          if (phase === 'connecting') resetConnection();
        }
        change('phase', phase, {
        connecting: say('Connecting to Android', '正在连接安卓端'),
        retry: `${say('Connection interrupted; retrying', '连接中断，正在重试')}${reason(failure, failureReasons) ? `（${failureText[failure]}）` : ''}`,
        idle: say('Disconnected', '已断开连接'),
        }[phase]);
      }
      else if (phase) change('phase', phase, null);
      if (stageText[stage]) change('stage', stage, stageText[stage]);
      if (['carplay', 'airplay', 'video'].includes(source)) change('source', source,
        source === 'carplay' ? say('CarPlay selected', '已切换到 CarPlay') :
          source === 'airplay' ? say('AirPlay selected', '已切换到 AirPlay') : say('Video selected', '已切换到视频'));
      else if (source === null) change('source', 'none', null);
      if (capability && typeof capability === 'object') {
        if (['available', 'api-unavailable', 'query-failed', 'empty'].includes(capability.status)) {
          const value = capability.status === 'available' && typeof capability.h264 === 'boolean' && typeof capability.hevc === 'boolean'
            ? `${capability.status}:${capability.h264}:${capability.hevc}` : capability.status;
          const capabilityText = capability.status === 'available' && typeof capability.h264 === 'boolean' && typeof capability.hevc === 'boolean'
            ? `${say('Browser WebRTC video', '浏览器 WebRTC 视频')}：H.264 ${capability.h264 ? say('supported', '支持') : say('not reported', '未报告')}，H.265 ${capability.hevc ? say('supported', '支持') : say('not reported', '未报告')}`
            : ({ 'api-unavailable': say('Browser WebRTC codec query is unavailable', '浏览器不提供 WebRTC 编码查询接口'),
              'query-failed': say('Browser WebRTC codec query failed', '浏览器 WebRTC 编码查询失败'),
              empty: say('Browser returned an empty WebRTC codec list', '浏览器返回的 WebRTC 编码列表为空') })[capability.status];
          change('capability', value, capabilityText);
        }
      }
      const config = videoConfig;
      if (config && typeof config === 'object') {
        const codec = codecName(config.codec), width = config.width, height = config.height;
        if (codec && Number.isInteger(width) && width > 0 && width <= 8192 && Number.isInteger(height) && height > 0 && height <= 8192)
          change('video-format', `${codec}:${width}:${height}`, `${say('Video format', '视频格式')}：${codec}，${width} × ${height}`);
      } else if (config === null) change('video-format', 'none', null);
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
        change('video-error', error || 'none', error ? `${say('Video failure', '视频错误')}：${error}${videoText[error] ? `（${videoText[error]}）` : ''}` :
          states.has('video-error') && states.get('video-error') !== 'none' ? say('Video error cleared', '视频错误已清除') : null);
      }
      if (['failed', 'connected'].includes(audioState)) change('audio', audioState,
        audioState === 'failed' ? say('Audio connection failed', '音频连接失败') : say('Audio connection restored', '音频连接已恢复'));
    },
    observeSummary(summary) {
      if (!summary || typeof summary !== 'object') return;
      if (observeScope('connection', summary, ['transport.generation', 'link.reconnects'], ['transport.', 'control.'])) {
        resetCounters('video.'); scopes.video = {};
        states.delete('failure-detail');
      }
      observeScope('video', summary, ['video.streamGeneration', 'video.epoch'], ['video.']);
      const audio = summary['audio.nativeAudio.peerState'] === 'connected' ? 'connected' :
        summary['audio.nativeAudio.peerState'] === 'failed' || summary['audio.nativeAudio.state'] === 'failed' ? 'failed' : null;
      this.observe({ stage: summary['link.connection.stage'], videoError: summary['video.errorReason'], audioState: audio });
      const failure = reason(summary['link.failure.reason'], failureReasons);
      if (failure) {
        const local = summary['link.failure.localCandidates'], remote = summary['link.failure.remoteCandidates'];
        const countsKnown = [local, remote].every(value => Number.isInteger(value) && value >= 0 && value <= 1024);
        const counts = countsKnown ? `；${say('browser candidates', '浏览器候选')} ${local}，${say('Android candidates', '安卓端候选')} ${remote}` : '';
        change('failure-detail', `${failure}:${counts}`, `${say('Connection failure', '连接失败')}：${failureText[failure]}${counts}`);
      } else if (summary['link.connection.stage'] === 'connected') states.delete('failure-detail');
      const iceState = summary['transport.iceState'];
      if (['checking', 'connected', 'completed', 'disconnected', 'failed'].includes(iceState)) {
        const stateText = {
          checking: say('checking network route', '正在检查网络路径'), connected: say('network route connected', '网络路径已连接'),
          completed: say('network route established', '网络路径已建立'), disconnected: say('network route disconnected', '网络路径已断开'),
          failed: say('network route failed', '网络路径连接失败'),
        };
        change('ice', iceState, `${say('WebRTC', 'WebRTC')}：${stateText[iceState]}`);
      }
      const protocol = summary['transport.selectedProtocol'];
      if (['udp', 'tcp'].includes(protocol)) change('protocol', protocol, `${say('Network transport', '网络传输')}：${protocol.toUpperCase()}`);
      for (const [key, en, cn] of [
        ['video.decodeErrors', 'Video decode errors increased', '视频解码错误增加'],
        ['video.decodeStalls', 'Video decode stalls increased', '视频解码停顿增加'],
        ['video.droppedFrames', 'Video dropped frames increased', '视频丢帧增加'],
        ['transport.reassemblyErrors', 'Media reassembly errors increased', '媒体重组错误增加'],
        ['control.failures', 'Control request failures increased', '控制请求失败增加'],
      ]) {
        const count = summary[key];
        if (!Number.isSafeInteger(count) || count < 0) continue;
        const old = counters.get(key);
        if ((old == null && count > 0) || (old != null && count > old))
          add(`${say(en, cn)}：${say('total', '累计')} ${count}${old != null && count > old ? `（+${count - old}）` : ''}`);
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
