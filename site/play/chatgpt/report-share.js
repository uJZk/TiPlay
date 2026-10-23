/*! SPDX-License-Identifier: GPL-3.0-only */
import { VERSION, PHASES } from './analysis.js?v=2';

export const MAX_SHARE_URL = 1900;
const MAX_JSON = 8192, MAX_FRAGMENT = 1900;
const CAP_KEYS = ['samples', 'reports', 'probes', 'events', 'load'];
const COMPLETIONS = ['已完成', '已提前停止', '启动失败', '工作线程失败', '页面已离开'];
// Stable schema 2 order. n = nullable finite scalar, c = count, i = nullable
// count, b = boolean. Null evidence is never encoded as a zero measurement.
export const PHASE_FIELDS = [
  ['segmentStartMs','n'], ['segmentEndMs','n'], ['selectedSamples','c'], ['excludedSamples','c'], ['segments','c'], ['lifecycleComplete','b'],
  ['getterSpanMs','n'], ['getterProgressMs','n'], ['getterDifferenceMs','n'],
  ['actualFrameDelta','i'], ['processedMs','n'], ['minimumSpanMs','n'], ['maximumSpanMs','n'],
  ['frameDifferenceLowerMs','n'], ['frameDifferenceUpperMs','n'], ['frameCoordinateProgressMs','n'], ['generationChanges','i'], ['discontinuities','i'],
  ['probes','c'], ['probeRttP95Ms','n'], ['probeRttMaxMs','n'], ['sampleIntervalP95Ms','n'],
  ['zeroContextPairs','c'], ['multi128FramePairs','c'], ['backwardsContextPairs','c'], ['backwardsPerformancePairs','c'],
  ['nativeSpanMs','n'], ['nativeDifferenceMs','n'], ['nativeValidSamples','c'], ['dateSpanMs','n'], ['dateDifferenceMs','n'], ['dateSamples','c'],
  ['loadTasks','c'], ['loadP95Ms','n'], ['rendererState','c'], ['rendererSamples','c'], ['underrunEventsDelta','n'],
  ['underrunDurationDeltaMs','n'], ['renderTotalDurationDeltaMs','n'], ['rendererRegressed','b'], ['reportCount','c'], ['reportReceiptIntervalP95Ms','n'],
  ['baseLatencyMinMs','n'], ['baseLatencyMaxMs','n'], ['outputLatencyMinMs','n'], ['outputLatencyMaxMs','n'],
];
const RENDER_STATES = ['unavailable', 'available', 'invalid', 'failed'];
const round = (value, places = 3) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
const assert = (condition, message = '摘要格式无效。') => { if (!condition) throw new Error(message); };
const text = (value, maximum) => typeof value === 'string' && value.length <= maximum;
const exactArray = (value, length) => Array.isArray(value) && value.length === length;
const scalar = (value, type) => type === 'b' ? typeof value === 'boolean'
  : type === 'c' ? count(value) : type === 'i' ? value === null || count(value) : value === null || number(value);
const endpoint = (phase, field, key) => round(phase[field]?.[key]);

export function buildReport(result) {
  const summary = result.summary;
  assert(summary && exactArray(summary.phases, 3), '测试结果尚未准备好。');
  const marks = summary.marks || [], chosen = marks.length <= 8 ? marks : [...marks.slice(0, 4), ...marks.slice(-4)];
  const states = summary.stateChanges || [], visibility = summary.visibilityChanges || [];
  const quantumMin = (result.reports || []).map(row => row.minQuantum ?? row.quantum).filter(count);
  const quantumMax = (result.reports || []).map(row => row.maxQuantum ?? row.quantum).filter(count);
  const ua = String(result.userAgent || ''), browser = /(?:Chrome|Chromium|CriOS|Firefox|Version)\/[\d.]+/.exec(ua)?.[0] || 'unknown';
  const platform = /Android|iPhone|iPad|Windows|Linux|Macintosh/.exec(ua)?.[0] || 'unknown';
  const caps = CAP_KEYS.map(key => result.caps?.[key] || 0);
  const attempts = key => count(result.eventAttempts?.[key]) ? result.eventAttempts[key]
    : caps[3] ? null : key === 'pop' ? marks.length : key === 'state' ? states.length : visibility.length;
  const wire = [2, VERSION, result.rate, result.requestedRate, result.durationSeconds, round(result.elapsedMs),
    COMPLETIONS.indexOf(result.completion), browser, platform, round(summary.epochRoundingErrorMaxMs, 6),
    quantumMin.length ? Math.min(...quantumMin) : null, quantumMax.length ? Math.max(...quantumMax) : null,
    result.expiredProbes, result.nativeReadErrors,
    [summary.sampleCount, summary.workletReportCount, states.length, visibility.length,
      states.filter(row => row.state !== 'running').length, visibility.filter(row => !row.visible).length, attempts('state'), attempts('visibility')],
    caps, [marks.length, attempts('pop'), marks.length - chosen.length, chosen.map(row => round(row.p))],
    summary.phases.map(phase => {
      const f = phase.frames, r = phase.renderer;
      const row = { segmentStartMs: round(phase.segmentStartMs), segmentEndMs: round(phase.segmentEndMs),
        selectedSamples: phase.samples, excludedSamples: phase.excludedSamples, segments: phase.foregroundSegments,
        lifecycleComplete: phase.lifecycleComplete, getterSpanMs: endpoint(phase,'getter','spanMs'),
        getterProgressMs: endpoint(phase,'getter','progressMs'), getterDifferenceMs: endpoint(phase,'getter','differenceMs'),
        actualFrameDelta: f ? (f.actualFrameDelta ?? Math.round(f.processedMs * result.rate / 1000)) : null,
        processedMs: round(f?.processedMs), minimumSpanMs: f ? Math.floor(f.minimumSpanMs * 1000) / 1000 : null,
        maximumSpanMs: f ? Math.ceil(f.maximumSpanMs * 1000) / 1000 : null,
        frameDifferenceLowerMs: f ? Math.floor(f.differenceRangeMs[0] * 1000) / 1000 : null,
        frameDifferenceUpperMs: f ? Math.ceil(f.differenceRangeMs[1] * 1000) / 1000 : null,
        frameCoordinateProgressMs: round(f?.frameCoordinateProgressMs), generationChanges: f?.generationChanges ?? null,
        discontinuities: f?.discontinuities ?? null, probes: phase.probes, probeRttP95Ms: round(phase.probeRoundTripP95Ms),
        probeRttMaxMs: round(phase.probeRoundTripMaxMs), sampleIntervalP95Ms: round(phase.actualIntervalP95Ms),
        zeroContextPairs: phase.zeroContextPairs, multi128FramePairs: phase.multi128FramePairs,
        backwardsContextPairs: phase.backwardsContextPairs, backwardsPerformancePairs: phase.backwardsPerformancePairs,
        nativeSpanMs: endpoint(phase,'nativeTimestamp','spanMs'), nativeDifferenceMs: endpoint(phase,'nativeTimestamp','differenceMs'),
        nativeValidSamples: phase.nativeValidSamples, dateSpanMs: endpoint(phase,'dateCompared','spanMs'),
        dateDifferenceMs: endpoint(phase,'dateCompared','dateMinusPerformanceMs'), dateSamples: phase.dateSamples,
        loadTasks: phase.loadTasks, loadP95Ms: round(phase.loadDurationP95Ms),
        rendererState: Math.max(0, RENDER_STATES.indexOf(r?.state)), rendererSamples: r?.samples ?? 0,
        underrunEventsDelta: round(r?.underrunEventsDelta), underrunDurationDeltaMs: round(r?.underrunDurationDeltaMs),
        renderTotalDurationDeltaMs: round(r?.totalDurationDeltaMs), rendererRegressed: r?.regressed === true,
        reportCount: phase.reportCount, reportReceiptIntervalP95Ms: round(phase.reportReceiptIntervalP95Ms),
        baseLatencyMinMs: round(phase.contextBaseLatencyRangeMs?.[0]), baseLatencyMaxMs: round(phase.contextBaseLatencyRangeMs?.[1]),
        outputLatencyMinMs: round(phase.contextOutputLatencyRangeMs?.[0]), outputLatencyMaxMs: round(phase.contextOutputLatencyRangeMs?.[1]) };
      return PHASE_FIELDS.map(([key]) => row[key]);
    }), [String(result.error || '').slice(0, 100), Math.max(0, String(result.error || '').length - 100)]];
  return readWire(wire);
}

function readWire(wire) {
  assert(exactArray(wire, 19) && wire[0] === 2 && wire[1] === VERSION, '不支持此摘要版本。');
  for (const at of [2,3,4,5,12,13]) assert(number(wire[at]) && wire[at] >= 0);
  assert(wire[2] >= 8000 && wire[2] <= 1000000 && (wire[3] === 0 || wire[3] >= 8000));
  assert(Number.isInteger(wire[6]) && wire[6] >= 0 && wire[6] < COMPLETIONS.length);
  assert(text(wire[7],48) && text(wire[8],24));
  assert(wire[9] === null || number(wire[9]) && wire[9] >= 0);
  for (const at of [10,11]) assert(wire[at] === null || count(wire[at]) && wire[at] > 0);
  assert(exactArray(wire[14],8) && wire[14].every((v,i) => i < 6 ? count(v) : v === null || count(v)));
  assert(exactArray(wire[15],5) && wire[15].every(count));
  const marks = wire[16];
  assert(exactArray(marks,4) && count(marks[0]) && (marks[1] === null || count(marks[1]) && marks[1] >= marks[0])
    && count(marks[2]) && Array.isArray(marks[3]) && marks[3].length <= 8
    && marks[3].every(value => number(value) && value >= 0) && marks[0] === marks[2] + marks[3].length);
  assert(exactArray(wire[17],3));
  const phases = wire[17].map((values, phase) => {
    assert(exactArray(values,PHASE_FIELDS.length));
    const row = { phase, name: PHASES[phase] };
    PHASE_FIELDS.forEach(([key,type],index) => { assert(scalar(values[index],type)); row[key] = values[index]; });
    assert(row.segmentStartMs === null && row.segmentEndMs === null || number(row.segmentStartMs) && number(row.segmentEndMs) && row.segmentStartMs >= 0 && row.segmentEndMs >= row.segmentStartMs);
    assert(row.rendererState < RENDER_STATES.length);
    assert(row.frameDifferenceLowerMs === null && row.frameDifferenceUpperMs === null
      || number(row.frameDifferenceLowerMs) && number(row.frameDifferenceUpperMs) && row.frameDifferenceLowerMs <= row.frameDifferenceUpperMs);
    if (!row.lifecycleComplete || wire[15][3]) assert(row.getterSpanMs === null && row.processedMs === null && row.frameDifferenceLowerMs === null);
    row.rendererState = RENDER_STATES[row.rendererState]; return row;
  });
  assert(exactArray(wire[18],2) && text(wire[18][0],100) && count(wire[18][1]));
  return { type: 'TiPlay-clock-summary', schemaVersion: 2, labVersion: wire[1], rawIncluded: false,
    actualRate: wire[2], requestedRate: wire[3], requestedDurationSeconds: wire[4], elapsedMs: wire[5],
    completion: COMPLETIONS[wire[6]], browser: wire[7], platform: wire[8], epochRoundingErrorMaxMs: wire[9],
    quantumMinFrames: wire[10], quantumMaxFrames: wire[11], expiredProbes: wire[12], nativeReadErrors: wire[13],
    source: Object.fromEntries(['samples','reports','recordedStateEvents','recordedVisibilityEvents','recordedNonRunningEvents','recordedHiddenEvents','stateEventAttempts','visibilityEventAttempts'].map((key,i) => [key,wire[14][i]])),
    caps: Object.fromEntries(CAP_KEYS.map((key,i) => [key,wire[15][i]])),
    marks: { recordedTotal: marks[0], attemptedTotal: marks[1], omittedRecorded: marks[2], timesMs: marks[3] },
    phases, error: wire[18][0], errorOmittedCharacters: wire[18][1],
    precision: { milliseconds: .001, epochMilliseconds: .000001, frameIntervals: 'rounded outwards' },
    reportTransportDelay: 'unknown; receipt intervals are not emission-to-receipt latency',
    timerQuantizationUncertaintyBounded: false, physicalOutputMeasured: false,
    _wire: wire };
}

export function summaryJson(report) { const { _wire, ...value } = report; return JSON.stringify(value,null,2) + '\n'; }
const base64 = bytes => {
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
export async function createReportUrl(report, baseUrl) {
  const bytes = new TextEncoder().encode(JSON.stringify(report._wire));
  assert(bytes.length <= MAX_JSON, '摘要超过安全上限，请拍照保存结果卡。');
  const url = new URL(baseUrl); url.search = '?v=2'; url.hash = `clock-report=2.j.${base64(bytes)}`;
  if (url.href.length <= MAX_SHARE_URL) return { url: url.href, encoding: 'json', bytes: bytes.length };
  // Native gzip is only an optional density improvement. The plain compact
  // schema works without it; no handwritten compressor or backend is used.
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    url.hash = `clock-report=2.g.${base64(compressed)}`;
    if (url.href.length <= MAX_SHARE_URL) return { url: url.href, encoding: 'gzip', bytes: bytes.length };
  }
  throw new Error('摘要过大，无法生成可靠二维码。请用手机拍照保存大字结果卡；完整记录仍留在车机。');
}
export async function readReportFragment(fragment) {
  assert(typeof fragment === 'string' && fragment.length <= MAX_FRAGMENT, '摘要链接过长。');
  const match = /^#clock-report=2\.([jg])\.([A-Za-z0-9_-]+)$/.exec(fragment);
  assert(match, '摘要链接格式或版本无效。');
  const payload = match[2].replaceAll('-','+').replaceAll('_','/');
  let bytes;
  try { bytes = Uint8Array.from(atob(payload), value => value.charCodeAt(0)); } catch (_) { throw new Error('摘要编码无效。'); }
  assert(bytes.length <= MAX_JSON, '摘要编码超过上限。');
  if (match[1] === 'g') {
    assert(typeof DecompressionStream === 'function', '此浏览器无法解压摘要，请改用较新的手机浏览器，或拍照保存车机结果卡。');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts = []; let length = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength;
        if (length > MAX_JSON) { await reader.cancel(); throw new Error('解压摘要超过安全上限。'); } parts.push(next.value); }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part,offset); offset += part.length; }
  }
  assert(bytes.length <= MAX_JSON);
  let parsed; try { parsed = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(bytes)); } catch (_) { throw new Error('摘要内容无效。'); }
  return readWire(parsed);
}
