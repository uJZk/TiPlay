/*! SPDX-License-Identifier: GPL-3.0-only */
import { VERSION, PHASES, summarize } from './analysis.js';

const el = id => document.getElementById(id);
const limits = Object.freeze({ samples: 30000, reports: 4000, probes: 1000, events: 1000, load: 6000 });
let run = null, exported = null, sequence = 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (result, key, row) => {
  if (result[key].length < limits[key]) result[key].push(row);
  else result.caps[key] = (result.caps[key] || 0) + 1;
};
const relative = value => performance.now() - value.startedAt;
const phaseAt = (value, at) => Math.min(2, Math.max(0, Math.floor(at / value.phaseMs)));
const describeError = error => `${error?.name || 'Error'}: ${error?.message || String(error)}`;
function renderer(context) {
  try {
    const value = context.playbackStats;
    if (value == null) return { state: 'unavailable' };
    const events = value.underrunEvents, duration = value.underrunDuration, total = value.totalDuration;
    if (!Number.isSafeInteger(events) || events < 0 || ![duration, total].every(v => finite(v) && v >= 0)) return { state: 'invalid' };
    return { state: 'available', underrunEvents: events, underrunDurationMs: duration * 1000, totalDurationMs: total * 1000 };
  } catch (_) { return { state: 'failed' }; }
}
function event(kind, fields = {}) {
  if (!run) return;
  bounded(run.result, 'events', { p: relative(run), kind, ...fields });
}
function setBusy(busy) {
  el('start').disabled = busy; el('stop').disabled = !busy; el('mark').disabled = !busy;
  el('rate').disabled = busy; el('duration').disabled = busy;
}
function format(value, decimals = 2) { return finite(value) ? value.toFixed(decimals) : '不可用'; }
function renderSummary(result) {
  const summary = result.summary, target = el('results'); target.replaceChildren();
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const table = document.createElement('table'), head = document.createElement('thead'), hr = document.createElement('tr');
  for (const title of ['阶段', '前台读数跨度', 'currentTime − 计时', '处理帧进度 − 记录时基区间', '探针 P95 往返']) {
    const th = document.createElement('th'); th.textContent = title; hr.append(th);
  }
  head.append(hr); table.append(head); const body = document.createElement('tbody');
  for (const phase of summary.phases) {
    const row = document.createElement('tr'), range = phase.frames?.differenceRangeMs;
    const values = [phase.name, phase.getter ? `${format(phase.getter.spanMs / 1000, 1)} 秒` : '不足',
      phase.getter ? `${format(phase.getter.differenceMs)} ms` : '不足',
      range ? `[${format(range[0])}, ${format(range[1])}] ms` : '不足／暂停或后台', `${format(phase.probeRoundTripP95Ms)} ms`];
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    body.append(row);
  }
  table.append(body); wrap.append(table); target.append(wrap);
  const notes = [];
  for (const phase of summary.phases) {
    if (phase.samples < 2) continue;
    notes.push(`${phase.name}：重复读数 ${phase.zeroContextPairs} 对，多于 128 帧的推进 ${phase.multi128FramePairs} 对；实际采样间隔 P95 ${format(phase.actualIntervalP95Ms)} ms。`);
    if (phase.frames?.differenceRangeMs[1] < 0) notes.push(`${phase.name}：记录的帧进度区间位于零以下；浏览器计时粗化误差尚无可靠上界，不能单凭这个结果判定异常或物理时钟偏慢。`);
    if (phase.frames?.discontinuities) notes.push(`${phase.name}：观察到 ${phase.frames.discontinuities} 次真实帧坐标不连续，需结合导出记录。`);
  }
  if (summary.visibilityChanges.some(value => !value.visible)) notes.push('测试期间进入过后台；相关区间已单列或排除，不与前台直接比较。');
  if (result.caps.events) notes.push('状态事件记录已达上限，无法保证暂停/后台边界完整；本次进度结论已停用。');
  if (result.durationSeconds < 60 || result.elapsedMs < 60000) notes.push('本次不足 60 秒，适合检查功能和明显异常，不能排除低频偏差。');
  notes.push('区间依据 API 报告的发出/收到时基，未包含计时粗化的未知误差；微小负值不能证明异常。区间包含 0 或消息往返较大时，证据更弱。主线程负载与恢复差异只是这次受控对照。');
  notes.push(`状态：${result.completion}。浏览器报告采样率 ${result.rate} Hz；这不是扬声器或 DAC 采样率测量。`);
  for (const note of notes) { const p = document.createElement('p'); p.className = 'note'; p.textContent = note; target.append(p); }
}
function sample(value) {
  if (run !== value || value.stopping) return;
  const context = value.context, perf = performance.now(), p = perf - value.startedAt;
  const c = context.currentTime * 1000, phase = phaseAt(value, p);
  let native = null;
  try { native = context.getOutputTimestamp?.(); } catch (_) { value.result.nativeReadErrors++; }
  const after = performance.now(), nativeP = native?.performanceTime - value.startedAt;
  const nativeC = native?.contextTime * 1000;
  const row = { p, c, phase, visible: document.visibilityState === 'visible', state: context.state,
    readCostMs: after - perf, epochErrorMs: (performance.timeOrigin + perf - performance.timeOrigin) - perf,
    nativeP: finite(nativeP) ? nativeP : null, nativeC: finite(nativeC) ? nativeC : null,
    nativeAgeMs: finite(nativeP) ? p - nativeP : null,
    nativeFresh: !!native && native.performanceTime > 0 && finite(nativeC) && finite(nativeP)
      && nativeC >= 0 && nativeC <= c + 10 && p - nativeP >= -20 && p - nativeP <= 750 };
  if (p - value.lastSlowRead >= 500) {
    row.date = Date.now(); row.baseLatencyMs = finite(context.baseLatency) ? context.baseLatency * 1000 : null;
    row.outputLatencyMs = finite(context.outputLatency) ? context.outputLatency * 1000 : null;
    row.renderer = renderer(context); value.lastSlowRead = p;
  }
  bounded(value.result, 'samples', row);
  if (p - value.lastProbe >= 250 && value.pending.size < 4) {
    const probe = ++sequence;
    value.pending.set(probe, { send: performance.now() - value.startedAt, phase,
      visible: row.visible, running: row.state === 'running' });
    value.node.port.postMessage({ probe }); value.lastProbe = p;
  }
  // A dropped/coalesced reply never grows an unbounded pending map.
  for (const [probe, entry] of value.pending) if (p - entry.send > 1000) { value.pending.delete(probe); value.result.expiredProbes++; }
  if (p >= value.totalMs) { finish(value, '已完成'); return; }
  value.timer = setTimeout(() => sample(value), 4);
}
function animate(value) {
  if (run !== value || value.stopping) return;
  const p = relative(value), phase = phaseAt(value, p);
  if (phase === 1 && document.visibilityState === 'visible') {
    const started = performance.now(); let work = value.work;
    while (performance.now() - started < 6) work = Math.sqrt(work + 1.0001) % 127;
    value.work = work;
    bounded(value.result, 'load', { p, phase, durationMs: performance.now() - started });
  }
  if (p - value.lastUi >= 200) {
    el('phase').textContent = PHASES[phase]; el('elapsed').textContent = `${format(p / 1000, 1)} 秒`;
    el('progress').value = Math.min(value.totalMs, p) / 1000;
    value.lastUi = p;
  }
  value.raf = requestAnimationFrame(() => animate(value));
}
async function finish(value, completion, error = null) {
  if (value.stopping) return;
  value.stopping = true; clearTimeout(value.timer); clearTimeout(value.resumeTimeout); cancelAnimationFrame(value.raf);
  value.result.elapsedMs = relative(value); value.result.completion = completion;
  if (error) value.result.error = describeError(error);
  value.context.onstatechange = null;
  if (value.node) { value.node.port.onmessage = null; value.node.onprocessorerror = null;
    try { value.node.port.postMessage({ stop: true }); value.node.disconnect(); } catch (_) {} }
  try { await value.context.close(); } catch (_) {}
  value.pending.clear();
  if (run !== value) return;
  run = null; value.result.summary = summarize(value.result); exported = value.result;
  renderSummary(exported); setBusy(false); el('export').disabled = false;
  el('status').textContent = error ? `${completion}：${describeError(error)}` : `${completion}，可导出 JSON。`;
  window.__clockLabResult = exported;
}
async function start() {
  if (run) return;
  exported = null; el('export').disabled = true; el('status').textContent = '正在启动音频…'; setBusy(true);
  if (!window.isSecureContext || !window.AudioContext || !window.AudioWorkletNode) {
    el('status').textContent = '此浏览器不支持安全上下文中的 AudioWorklet。请使用本页 HTTPS 地址。'; setBusy(false); return;
  }
  let value;
  try {
    const requestedRate = Number(el('rate').value), durationSeconds = Number(el('duration').value);
    const context = new AudioContext({ latencyHint: 'interactive', ...(requestedRate ? { sampleRate: requestedRate } : {}) });
    const startedAt = performance.now();
    value = { context, startedAt, totalMs: durationSeconds * 1000, phaseMs: durationSeconds * 1000 / 3,
      timer: null, raf: null, pending: new Map(), lastProbe: -Infinity, lastSlowRead: -Infinity, lastUi: -Infinity,
      work: 1, stopping: false, result: { version: VERSION, durationSeconds, requestedRate, rate: context.sampleRate,
        timeOrigin: performance.timeOrigin, userAgent: navigator.userAgent, samples: [], reports: [], probes: [], events: [], load: [],
        caps: {}, nativeReadErrors: 0, expiredProbes: 0, physicalOutputMeasured: false,
        protocol: { requestedSampleIntervalMs: 4, workletReportIntervalMs: 40, probeIntervalMs: 250,
          loadPerAnimationFrameMs: 6, phaseNames: PHASES, limits } } };
    run = value; window.__clockLabResult = null;
    context.onstatechange = () => { if (run === value) event('state', { state: context.state }); };
    event('state', { state: context.state }); event('visibility', { visible: document.visibilityState === 'visible' });
    // Resume while the user's click is still active; load the external CSP-safe module in parallel.
    const resumed = context.resume();
    await context.audioWorklet.addModule(new URL('./probe-worklet.js', import.meta.url));
    if (run !== value || value.stopping) return;
    const node = new AudioWorkletNode(context, 'clock-probe', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    value.node = node;
    node.port.onmessage = ({ data }) => {
      if (run !== value || value.stopping) return;
      const receive = relative(value), phase = phaseAt(value, receive);
      if (data.report) {
        bounded(value.result, 'reports', { ...data, receive, phase, visible: document.visibilityState === 'visible' });
        el('quantum').textContent = `${data.minQuantum}–${data.maxQuantum} 帧`;
      }
      if (Number.isSafeInteger(data.probe)) {
        const pending = value.pending.get(data.probe);
        if (pending) { value.pending.delete(data.probe); bounded(value.result, 'probes', { ...data, ...pending,
          receive, phaseAtReceive: phase, visible: pending.visible && document.visibilityState === 'visible',
          running: pending.running && context.state === 'running' }); }
      }
    };
    node.onprocessorerror = () => { if (run === value) finish(value, '工作线程失败', new Error('AudioWorklet processor error')); };
    node.port.postMessage({ tone: el('tone').checked }); node.connect(context.destination);
    await Promise.race([resumed, new Promise((_, reject) => { value.resumeTimeout = setTimeout(() => reject(new Error('音频未能在 8 秒内启动，请再次点击开始')), 8000); })]);
    clearTimeout(value.resumeTimeout);
    if (run !== value || value.stopping) return;
    el('actual-rate').textContent = `${context.sampleRate} Hz`; el('progress').max = durationSeconds; el('progress').value = 0;
    el('status').textContent = '测试进行中，请保持页面在前台。';
    sample(value); animate(value);
  } catch (error) {
    if (value) { clearTimeout(value.resumeTimeout); await finish(value, '启动失败', error); }
    else { el('status').textContent = `启动失败：${describeError(error)}`; setBusy(false); }
  }
}
el('start').addEventListener('click', start);
el('stop').addEventListener('click', () => { if (run) finish(run, '已提前停止'); });
el('tone').addEventListener('change', () => { if (run?.node) { event('tone', { enabled: el('tone').checked }); run.node.port.postMessage({ tone: el('tone').checked }); } });
el('mark').addEventListener('click', () => { event('pop', { contextMs: run?.context.currentTime * 1000 }); el('status').textContent = '已记录这个时刻，测试继续。'; });
el('export').addEventListener('click', () => {
  if (!exported) return;
  const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `TiPlay-ChatGPT-clock-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => event('visibility', { visible: document.visibilityState === 'visible' }));
window.addEventListener('pagehide', () => { if (run) { event('pagehide'); finish(run, '页面已离开'); } });
