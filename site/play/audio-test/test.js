// SPDX-License-Identifier: GPL-3.0-only
import { createVideoPlayer } from '../videojs-player.js';

const $ = id => document.getElementById(id);
const records = [];
let context = null, player = null, source = null, analyser = null, data = null;
let countdown = null, poll = null, run = 0, current = null;
const log = (event, fields = {}) => {
  records.push({ time: new Date().toISOString(), run, event, ...fields });
  $('log').textContent = records.map(record => JSON.stringify(record)).join('\n');
};
const contextState = () => {
  $('context').textContent = context ? `#1 · ${context.state}` : '尚未创建';
};
function retire() {
  clearInterval(countdown); countdown = null;
  clearInterval(poll); poll = null;
  source?.disconnect(); analyser?.disconnect(); source = analyser = data = null;
  player?.dispose(); player = null;
  $('player-layer').hidden = true;
  $('placeholder').hidden = false;
}
$('unlock').addEventListener('click', async () => {
  try {
    context ??= new AudioContext({ latencyHint: 'interactive' });
    context.onstatechange = () => { contextState(); log('context-state', { state: context.state }); };
    await context.resume();
    const tone = context.createOscillator(), gain = context.createGain();
    tone.frequency.value = 660; gain.gain.value = 0.08;
    tone.connect(gain).connect(context.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(); tone.stop(context.currentTime + 0.2);
    contextState(); log('unlock', { state: context.state, contextId: 1 });
    $('start').disabled = context.state !== 'running';
    $('countdown').textContent = '选择对照后开始。等待 8 秒期间不要触碰页面。';
  } catch (error) { log('unlock-error', { name: error.name, message: error.message }); contextState(); }
});

async function startVideo(mode, token) {
  if (run !== token) return;
  countdown = null;
  $('countdown').textContent = '正在自动开始，请观察画面和声音；暂时不要触碰页面。';
  $('player-layer').hidden = false; $('placeholder').hidden = true;
  player = createVideoPlayer($('player-layer'), { hls: false, lang: 'zh', stopText: '结束测试', stop: () => {
    log('stop'); retire(); $('start').disabled = false;
  } });
  const opened = player, video = player.video;
  const shared = mode !== 'native';
  if (shared) {
    try {
      source = context.createMediaElementSource(video);
      analyser = context.createAnalyser(); analyser.fftSize = 2048;
      data = new Float32Array(analyser.fftSize);
      source.connect(analyser).connect(context.destination);
    } catch (error) {
      log('connect-error', { name: error.name, message: error.message });
      $('play-result').textContent = '无法接入 Web Audio'; retire(); $('start').disabled = false; return;
    }
  }
  video.muted = mode === 'shared-muted';
  log('video-created', { mode, contextId: shared ? 1 : null, contextState: context.state,
    muted: video.muted, userActivation: navigator.userActivation?.isActive ?? null });
  for (const event of ['loadedmetadata', 'play', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'error']) {
    video.addEventListener(event, () => {
      if (player !== opened) return;
      log(event, { position: video.currentTime, paused: video.paused, contextState: context.state });
      if (event === 'ended' || event === 'error') $('start').disabled = false;
    });
  }
  video.addEventListener('loadedmetadata', async () => {
    if (player !== opened) return;
    try {
      await video.play();
      if (player !== opened) return;
      $('play-result').textContent = '成功'; current.playResult = 'success'; log('autoplay-success');
    } catch (error) {
      if (player !== opened) return;
      $('play-result').textContent = error.name; current.playResult = error.name;
      log('autoplay-rejected', { name: error.name, message: error.message });
      $('start').disabled = false;
      $('countdown').textContent = '自动播放被拒绝。可先记录结果，再用视频播放按钮验证手动播放。';
    }
  }, { once: true });
  player.source('sample.mp4', 'video/mp4');
  poll = setInterval(() => {
    if (player !== opened) return;
    contextState(); $('progress').textContent = `${video.currentTime.toFixed(1)} 秒 · ${video.paused ? '暂停' : '播放'}`;
    if (analyser) {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
      current.maxRms = Math.max(current.maxRms, rms);
      $('signal').textContent = rms > 0.0001 ? `有信号 · ${rms.toFixed(4)}` : '无信号';
    } else $('signal').textContent = '原生路径 · 不测量';
  }, 150);
}
$('start').addEventListener('click', () => {
  retire(); run++;
  const token = run, mode = $('mode').value;
  current = { run, mode, contextId: 1, maxRms: 0, heard: null, playResult: null };
  $('start').disabled = true; $('play-result').textContent = '等待启动'; $('signal').textContent = '—'; $('progress').textContent = '—';
  log('scheduled', { mode, delaySeconds: 8 });
  let remaining = 8;
  $('countdown').textContent = `${remaining} 秒后自动开始，等待期间不要触碰页面。`;
  countdown = setInterval(() => {
    remaining--;
    $('countdown').textContent = `${remaining} 秒后自动开始，等待期间不要触碰页面。`;
    if (remaining === 0) { clearInterval(countdown); startVideo(mode, token); }
  }, 1000);
});
for (const [id, heard] of [['heard', true], ['silent', false]]) $(id).addEventListener('click', () => {
  if (!current) return;
  current.heard = heard; log('observation', { ...current, contextState: context.state });
  $('copy-result').textContent = heard ? '已记录：听到了声音。' : '已记录：没有声音。';
});
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify({ userAgent: navigator.userAgent, records, latest: current }, null, 2));
    $('copy-result').textContent = '已复制，可把测试记录发给我。';
  } catch (_) { $('copy-result').textContent = '无法自动复制，可展开下方测试记录。'; }
});
log('page-loaded', { userAgent: navigator.userAgent });
window.addEventListener('pagehide', () => { retire(); context?.close(); });
