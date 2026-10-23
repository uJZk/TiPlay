/*! SPDX-License-Identifier: GPL-3.0-only */
export const VERSION = 'clock-lab-v2';
export const PHASES = ['正常', '主线程负载', '恢复'];
export const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const interrupts = event => (event.kind === 'visibility' && event.visible === false)
  || (event.kind === 'state' && event.state !== 'running') || event.kind === 'pagehide';
function foregroundSegments(rows, events) {
  const segments = []; let segment = [];
  for (const row of rows) {
    if (!row.visible || row.state !== 'running') { if (segment.length) segments.push(segment); segment = []; continue; }
    if (segment.length && events.some(event => interrupts(event) && event.p > segment.at(-1).p && event.p <= row.p)) {
      segments.push(segment); segment = [];
    }
    segment.push(row);
  }
  if (segment.length) segments.push(segment);
  return segments;
}
const endpoints = (rows, field, time = 'p') => {
  const selected = rows.filter(row => finite(row[field]) && finite(row[time]));
  if (selected.length < 2) return null;
  const first = selected[0], last = selected.at(-1), spanMs = last[time] - first[time];
  return spanMs > 0 ? { spanMs, progressMs: last[field] - first[field], differenceMs: last[field] - first[field] - spanMs,
    ratePpm: ((last[field] - first[field]) / spanMs - 1) * 1e6 } : null;
};
export function phaseSummary(result, phase) {
  const all = result.samples.filter(row => row.phase === phase);
  const segments = foregroundSegments(all, result.events);
  // Do not join samples on opposite sides of a hidden/suspended interval. Use
  // the longest uninterrupted foreground run for comparable endpoint rates.
  const rows = segments.sort((a, b) => (b.at(-1).p - b[0].p) - (a.at(-1).p - a[0].p))[0] || [];
  const pairs = rows.slice(1).map((row, index) => ({ dp: row.p - rows[index].p, dc: row.c - rows[index].c }));
  const q = result.rate > 0 ? 128000 / result.rate : null;
  const probes = result.probes.filter(row => row.phase === phase && row.visible && row.running
    && row.phaseAtReceive === phase && row.send >= (rows[0]?.p ?? Infinity)
    && row.receive <= (rows.at(-1)?.p ?? -Infinity) && row.receive >= row.send && finite(row.frame));
  // A sample's process event occurs somewhere inside its own send/receive
  // interval. Report bounds, never label message arrival a process timestamp.
  let frames = null;
  if (probes.length >= 2) {
    const first = probes[0], last = probes.at(-1), minimumSpanMs = last.send - first.receive,
      maximumSpanMs = last.receive - first.send;
    const noBoundary = !result.events.some(event => event.p >= first.send && event.p <= last.receive && interrupts(event));
    if (minimumSpanMs > 0 && noBoundary) {
      const processedMs = (last.totalFrames - first.totalFrames) * 1000 / result.rate;
      frames = { actualFrameDelta: last.totalFrames - first.totalFrames, processedMs, minimumSpanMs, maximumSpanMs,
        differenceRangeMs: [processedMs - maximumSpanMs, processedMs - minimumSpanMs],
        effectiveRatePpmRange: [(processedMs / maximumSpanMs - 1) * 1e6, (processedMs / minimumSpanMs - 1) * 1e6],
        frameCoordinateProgressMs: (last.frame - first.frame) * 1000 / result.rate,
        generationChanges: last.generation - first.generation,
        discontinuities: last.discontinuities - first.discontinuities };
    }
  }
  const dates = rows.filter(row => finite(row.date));
  const dateCompared = dates.length > 1 ? { spanMs: dates.at(-1).p - dates[0].p,
    dateMinusPerformanceMs: dates.at(-1).date - dates[0].date - (dates.at(-1).p - dates[0].p) } : null;
  const lifecycleComplete = !(result.caps.events > 0);
  const range = key => { const values = rows.map(row => row[key]).filter(finite); return values.length ? [Math.min(...values),Math.max(...values)] : [null,null]; };
  const nativeRows = rows.filter(row => row.nativeFresh && row.nativeP >= rows[0].p && row.nativeP <= rows.at(-1).p);
  const reports = result.reports.filter(row => row.phase === phase && row.visible
    && row.receive >= (rows[0]?.p ?? Infinity) && row.receive <= (rows.at(-1)?.p ?? -Infinity));
  const rendererRows = rows.filter(row => row.renderer), available = rendererRows.filter(row => row.renderer.state === 'available');
  let renderer = { state: rendererRows.at(-1)?.renderer.state || 'unavailable', samples: available.length,
    underrunEventsDelta: null, underrunDurationDeltaMs: null, totalDurationDeltaMs: null, regressed: false };
  if (available.length >= 2) {
    const first = available[0].renderer, last = available.at(-1).renderer;
    renderer = { ...renderer, underrunEventsDelta: last.underrunEvents - first.underrunEvents,
      underrunDurationDeltaMs: last.underrunDurationMs - first.underrunDurationMs,
      totalDurationDeltaMs: last.totalDurationMs - first.totalDurationMs,
      regressed: last.underrunEvents < first.underrunEvents || last.underrunDurationMs < first.underrunDurationMs || last.totalDurationMs < first.totalDurationMs };
  }
  return { phase, name: PHASES[phase], samples: rows.length, excludedSamples: all.length - rows.length,
    segmentStartMs: rows[0]?.p ?? null, segmentEndMs: rows.at(-1)?.p ?? null,
    lifecycleComplete,
    foregroundSegments: segments.length, endpointSelection: 'longest uninterrupted visible/running segment',
    requestedIntervalMs: 4, actualIntervalP50Ms: percentile(pairs.map(pair => pair.dp), .5),
    actualIntervalP95Ms: percentile(pairs.map(pair => pair.dp), .95), zeroContextPairs: pairs.filter(pair => pair.dc === 0).length,
    multi128FramePairs: q === null ? null : pairs.filter(pair => pair.dc > q * 1.5).length,
    backwardsContextPairs: pairs.filter(pair => pair.dc < 0).length,
    backwardsPerformancePairs: pairs.filter(pair => pair.dp < 0).length,
    getter: lifecycleComplete ? endpoints(rows, 'c') : null, nativeTimestamp: lifecycleComplete ? endpoints(nativeRows, 'nativeC', 'nativeP') : null,
    nativeValidSamples: nativeRows.length, dateSamples: dates.length,
    probes: probes.length, probeRoundTripP95Ms: percentile(probes.map(row => row.receive - row.send), .95),
    probeRoundTripMaxMs: probes.length ? Math.max(...probes.map(row => row.receive - row.send)) : null,
    frames: lifecycleComplete ? frames : null, dateCompared, renderer,
    reportCount: reports.length, reportReceiptIntervalP95Ms: percentile(reports.slice(1).map((row, index) => row.receive - reports[index].receive), .95),
    contextBaseLatencyRangeMs: range('baseLatencyMs'), contextOutputLatencyRangeMs: range('outputLatencyMs'),
    loadTasks: result.load.filter(row => row.phase === phase).length,
    loadDurationP95Ms: percentile(result.load.filter(row => row.phase === phase).map(row => row.durationMs), .95) };
}
export function summarize(result) {
  return { phases: PHASES.map((_, phase) => phaseSummary(result, phase)),
    stateChanges: result.events.filter(event => event.kind === 'state'),
    visibilityChanges: result.events.filter(event => event.kind === 'visibility'),
    marks: result.events.filter(event => event.kind === 'pop'),
    caps: result.caps, sampleCount: result.samples.length, workletReportCount: result.reports.length,
    epochRoundingErrorMaxMs: result.samples.reduce((maximum, row) => Math.max(maximum, Math.abs(row.epochErrorMs)), 0),
    timerQuantizationUncertaintyBounded: false,
    physicalOutputMeasured: false, limits: ['Worklet send/receive bounds describe processing throughput, not physical oscillator or speaker timing.',
      'Recorded timer intervals do not include an authoritative bound for browser timer coarsening or jitter.',
      'Main-thread load does not reproduce all decode/GPU/system workloads.', 'A finite, foreground sample does not exclude rare device stalls.'] };
}
