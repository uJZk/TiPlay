// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateCounts, rtcFailureReason, rtcFailureSummary } from '../../site/play/rtc-diagnostics.js';

test('candidate summaries retain only total and IPv4 link-local counts', () => {
  const sdp = 'v=0\r\na=ice-pwd:secret\r\na=candidate:1 1 udp 1 169.254.111.111 5555 typ host\r\n' +
    'a=candidate:2 1 udp 1 masked.local 6666 typ host\r\na=candidate:3 1 tcp 1 192.168.43.1 7777 typ host\r\n';
  assert.deepEqual(candidateCounts(sdp), { total: 3, linkLocal: 1 });
  assert.deepEqual(candidateCounts(), { total: 0, linkLocal: 0 });
});

test('failure summaries exclude exception details, SDP, passwords and session identifiers', () => {
  const failure = rtcFailureSummary({ message: 'native failure secret SDP 9876', rtcReason: 'timeout',
    rtcDiagnostic: { stage: 'remote-ice', localCandidates: 2, localLinkLocalCandidates: 1, remoteCandidates: 0,
      remoteLinkLocalCandidates: 0, iceState: 'checking', gatheringState: 'complete', connectionState: 'connecting',
      sdp: 'a=ice-pwd:secret', code: '9876', session: 'secret-session', remoteAddress: '192.168.43.1' } });
  assert.equal(failure.reason, 'timeout'); assert.equal(failure.stage, 'remote-ice'); assert.equal(failure.remoteCandidates, 0);
  assert.doesNotMatch(JSON.stringify(failure), /9876|secret|192\.168|ice-pwd|SDP/);
  assert.equal(rtcFailureReason({ status: 404 }), 'missing-interface');
  assert.equal(rtcFailureReason({ status: 503 }), 'android-signaling');
});

function pageText(language) {
  const source = readFileSync(new URL('../../site/play/app.js', import.meta.url), 'utf8');
  const strings = new Function(`return ${/const STRINGS = (\{[\s\S]*?\n\});/.exec(source)[1]}`)();
  const functions = ['rtcStageText', 'rtcCandidateText', 'rtcRetryText'].map(name =>
    new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source)[0]).join('\n');
  return new Function('STRINGS', 'lang', 'rtcFailureSummary', `
    const t = (key, ...args) => (STRINGS[lang][key] ?? STRINGS.en[key]).replace(/\\{(\\d)\\}/g, (_, index) => args[index]);
    ${functions}
    return { rtcRetryText, rtcStageText };
  `)(strings, language, rtcFailureSummary);
}

test('the page displays distinct HTTP, PAKE and answered-but-not-connected failures in English and Chinese', () => {
  for (const language of ['en', 'zh']) {
    const page = pageText(language);
    const diagnostic = { stage: 'remote-ice', localCandidates: 1, localLinkLocalCandidates: 1,
      remoteCandidates: 0, remoteLinkLocalCandidates: 0 };
    const timed = page.rtcRetryText({ rtcReason: 'timeout', rtcDiagnostic: diagnostic, message: 'secret 9876' }, 8);
    assert.match(timed, language === 'zh' ? /安卓端已验证.*超时/ : /Android was verified.*timed out/);
    assert.match(timed, /169\.254/); assert.match(timed, /8/); assert.doesNotMatch(timed, /secret|9876/);
    const absent = page.rtcRetryText({ status: 404, rtcDiagnostic: { stage: 'pairing' } }, 8);
    assert.match(absent, language === 'zh' ? /缺少 WebRTC 配对接口/ : /no WebRTC pairing interface/);
    const signaling = page.rtcRetryText({ status: 503, rtcDiagnostic: { stage: 'pairing' } }, 8);
    assert.match(signaling, language === 'zh' ? /未能准备 WebRTC/ : /could not prepare the WebRTC/);
    const fetch = page.rtcRetryText({ rtcReason: 'fetch', rtcDiagnostic: { stage: 'pairing' } }, 8);
    assert.match(fetch, /HTTP/);
    const proof = page.rtcRetryText({ rtcReason: 'pairing', rtcDiagnostic: { stage: 'pairing' } }, 8);
    assert.match(proof, language === 'zh' ? /配对校验未通过/ : /pairing verification failed/);
  }
});
