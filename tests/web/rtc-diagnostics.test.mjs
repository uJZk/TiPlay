// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateCounts, rtcFailureReason, rtcFailureSummary } from '../../site/play/rtc-diagnostics.js';

test('candidate summaries retain anonymous protocol and address-class counts', () => {
  const sdp = 'v=0\r\na=ice-pwd:secret\r\na=candidate:1 1 udp 1 169.254.111.111 5555 typ host\r\n' +
    'a=candidate:2 1 udp 1 masked.local 6666 typ host\r\na=candidate:3 1 tcp 1 192.168.43.1 7777 typ host\r\n';
  assert.deepEqual(candidateCounts(sdp), { total: 3, linkLocal: 1, udp: 2, tcp: 1, privateIpv4: 1, cgnatIpv4: 0, ipv6: 0, mdns: 1 });
  assert.deepEqual(candidateCounts(), { total: 0, linkLocal: 0, udp: 0, tcp: 0, privateIpv4: 0, cgnatIpv4: 0, ipv6: 0, mdns: 0 });
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
  const functions = ['rtcStageText', 'rtcCandidateText', 'rtcRetryText', 'retryStatusText'].map(name =>
    new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source)[0]).join('\n');
  return new Function('STRINGS', 'lang', 'rtcFailureSummary', `
    const t = (key, ...args) => (STRINGS[lang][key] ?? STRINGS.en[key]).replace(/\\{(\\d)\\}/g, (_, index) => args[index]);
    ${functions}
    return { rtcRetryText, rtcStageText, retryStatusText };
  `)(strings, language, rtcFailureSummary);
}

test('optional diagnostics retain distinct HTTP, PAKE and answered-but-not-connected failures in English and Chinese', () => {
  for (const language of ['en', 'zh']) {
    const page = pageText(language);
    const diagnostic = { stage: 'remote-ice', localCandidates: 1, localLinkLocalCandidates: 1,
      remoteCandidates: 0, remoteLinkLocalCandidates: 0 };
    const timed = page.rtcRetryText({ rtcReason: 'timeout', rtcDiagnostic: diagnostic, message: 'secret 9876' }, 8);
    assert.match(timed, language === 'zh' ? /安卓端已验证.*超时/ : /Android was verified.*timed out/);
    assert.match(timed, language === 'zh' ? /候选总数：浏览器 1，安卓端 0/ : /Candidate totals: browser 1, Android 0/);
    assert.match(timed, language === 'zh' ? /安卓端响应中没有 ICE 候选/ : /Android’s answer contains no ICE candidates/);
    assert.doesNotMatch(timed, /169\.254/); assert.match(timed, /8/); assert.doesNotMatch(timed, /secret|9876/);
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

test('CGNAT, private IPv4, IPv6 and mDNS remain distinct without retaining addresses', () => {
  const addresses = ['100.111.111.111', '100.64.0.1', '100.127.255.254', '100.128.0.1',
    '10.2.3.4', '172.16.0.1', '172.31.255.254', '172.32.0.1', '192.168.4.1', '169.254.2.3', 'fd12::1234', 'hidden.local'];
  const sdp = addresses.map((address, index) => `a=candidate:${index} 1 ${index % 2 ? 'tcp' : 'udp'} 1 ${address} 5555 typ host`).join('\r\n');
  const counts = candidateCounts(sdp);
  assert.deepEqual(counts, { total: 12, udp: 6, tcp: 6, privateIpv4: 4, cgnatIpv4: 3, linkLocal: 1, ipv6: 1, mdns: 1 });
  assert.doesNotMatch(JSON.stringify(counts), /100\.111|169\.254|fd12|hidden|5555|candidate/);
});

test('optional diagnostics show nonzero classes and independent ICE, peer and three channel states', () => {
  const diagnostic = { stage: 'remote-ice', localCandidates: 2, remoteCandidates: 1,
    localUdpCandidates: 2, remoteUdpCandidates: 1, localCgnatIpv4Candidates: 1, localMdnsCandidates: 1,
    remotePrivateIpv4Candidates: 1, localLinkLocalCandidates: 0, remoteLinkLocalCandidates: 0,
    iceState: 'connected', connectionState: 'connecting', videoChannelState: 'connecting',
    audioChannelState: 'connecting', controlChannelState: 'open' };
  for (const language of ['en', 'zh']) {
    const text = pageText(language).rtcRetryText({ rtcReason: 'timeout', rtcDiagnostic: diagnostic }, 8);
    assert.match(text, /UDP:2/); assert.match(text, /CGNAT IPv4:1/); assert.match(text, /mDNS:1/);
    assert.match(text, /ICE connected/); assert.match(text, language === 'zh' ? /Peer connecting/ : /peer connecting/);
    assert.match(text, /connecting\/connecting\/open/);
    assert.doesNotMatch(text, /169\.254|link-local|链路本地|contains no ICE|没有 ICE 候选/);
  }
});

test('normal retry status offers an action and countdown without protocol internals in either language', () => {
  for (const language of ['en', 'zh']) {
    const page = pageText(language);
    const cases = [
      [{ rtcReason: 'fetch' }, language === 'zh' ? /检查地址.*本地网络访问/ : /Check its address.*local-network access/],
      [{ status: 404 }, language === 'zh' ? /更新安卓端 TiPlay/ : /Update TiPlay on Android/],
      [{ status: 503 }, language === 'zh' ? /在手机上打开 TiPlay/ : /Open TiPlay on the phone/],
      [{ rtcReason: 'pairing' }, language === 'zh' ? /当前显示的配对码/ : /current code in TiPlay/],
      [{ rtcReason: 'timeout', rtcDiagnostic: { stage: 'remote-ice', localCandidates: 2, remoteCandidates: 0 } },
        language === 'zh' ? /连接同一网络/ : /same network/],
      [{ reason: 'no-local-candidates' }, language === 'zh' ? /连接同一网络/ : /same network/],
      [{ reason: 'no-remote-udp-candidates' }, language === 'zh' ? /连接同一网络/ : /same network/],
    ];
    for (const [error, action] of cases) {
      const text = page.retryStatusText({ ...error, message: 'secret 9876' }, 8);
      assert.match(text, action);
      assert.match(text, /8/);
      assert.doesNotMatch(text, /ICE|WebRTC|HTTP|candidate|候选|Peer|DC|secret|9876|v\d+/);
    }
  }
});
