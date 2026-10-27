// SPDX-License-Identifier: GPL-3.0-only
// Real Chromium SDP admission only; no ICE connection or RTP delivery is asserted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright-core');
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-breakpad'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const receiver = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const sender = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const channels = ['control', 'video', 'audio'].map(label => receiver.createDataChannel(label, { ordered: true }));
    const checks = [], generations = [];
    function check(condition, message) { if (!condition) throw Error(message); checks.push(message); }
    async function bounded(promise) {
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SDP admission timed out')), 10000); })]); }
      finally { clearTimeout(timer); }
    }
    function parsed(sdp) {
      const sections = sdp.replace(/\r/g, '').split(/\n(?=m=)/);
      const session = sections.shift().split('\n');
      const line = (lines, prefix) => lines.find(value => value.startsWith(prefix))?.slice(prefix.length);
      const media = sections.map(section => {
        const lines = section.split('\n');
        return { kind: lines[0].split(' ')[0].slice(2), port: Number(lines[0].split(' ')[1]),
          mid: line(lines, 'a=mid:'), lines,
          direction: lines.find(value => /^a=(recvonly|sendonly|sendrecv|inactive)$/.test(value)) };
      });
      const application = media.find(value => value.kind === 'application');
      return { media, application, bundle: line(session, 'a=group:BUNDLE ')?.split(' ') ?? [],
        identity: application && ['a=ice-ufrag:', 'a=ice-pwd:', 'a=fingerprint:', 'a=sctp-port:', 'a=max-message-size:']
          .map(prefix => line(application.lines, prefix) ?? line(session, prefix) ?? null) };
    }
    try {
      // This pending offer is never sent to the other peer. It lets Chromium assign
      // the application section first, without SDP reordering or identity rewriting.
      await bounded(receiver.setLocalDescription(await bounded(receiver.createOffer())));
      const pending = parsed(receiver.localDescription.sdp);
      check(pending.media.length === 1 && pending.media[0].kind === 'application', 'Pending offer contains only the application section');
      const anchor = pending.application.mid, identity = JSON.stringify(pending.identity);
      check(pending.bundle[0] === anchor, 'Chromium assigns the application BUNDLE anchor');
      const codec = RTCRtpReceiver.getCapabilities('video')?.codecs.find(value => /^video\/H264$/i.test(value.mimeType)
        && /(?:^|;)packetization-mode=1(?:;|$)/.test(value.sdpFmtpLine));
      check(Boolean(codec), 'The browser advertises an original H264 packetization-mode 1 capability');
      let transceiver, sctpOwner, dtlsOwner;
      for (let generation = 1; generation <= 4; generation++) {
        if (transceiver) { transceiver.receiver.track.stop(); transceiver.stop(); }
        transceiver = receiver.addTransceiver('video', { direction: 'recvonly' });
        transceiver.setCodecPreferences([codec]);
        await bounded(receiver.setLocalDescription(await bounded(receiver.createOffer())));
        const offer = parsed(receiver.localDescription.sdp);
        check(offer.media[0].kind === 'application' && offer.application.mid === anchor && offer.bundle[0] === anchor,
          `Generation ${generation} retains the application anchor`);
        check(JSON.stringify(offer.identity) === identity, `Generation ${generation} retains SCTP, ICE and fingerprint identity`);
        const active = offer.media.filter(value => value.kind === 'video' && value.port !== 0 && value.direction !== 'a=inactive');
        check(active.length === 1 && active[0].mid === transceiver.mid && active[0].direction === 'a=recvonly',
          `Generation ${generation} has exactly one active receive-only video section`);
        check(active[0].lines.some(value => value.includes('transport-wide-cc-extensions-01'))
          && active[0].lines.some(value => /^a=rtcp-fb:\d+ transport-cc$/.test(value)),
        `Generation ${generation} retains transport-wide congestion feedback`);
        await bounded(sender.setRemoteDescription(receiver.localDescription));
        const remote = sender.getTransceivers().find(value => value.mid === transceiver.mid);
        check(Boolean(remote), `Generation ${generation} maps the actual remote video transceiver`);
        remote.direction = 'sendonly';
        await bounded(sender.setLocalDescription(await bounded(sender.createAnswer())));
        await bounded(receiver.setRemoteDescription(sender.localDescription));
        if (generation === 1) { sctpOwner = receiver.sctp; dtlsOwner = sctpOwner?.transport; }
        check(Boolean(sctpOwner && dtlsOwner) && receiver.sctp === sctpOwner && receiver.sctp.transport === dtlsOwner,
          `Generation ${generation} retains the actual SCTP and DTLS objects`);
        const answer = parsed(sender.localDescription.sdp);
        check(answer.bundle[0] === anchor && answer.application.mid === anchor,
          `Generation ${generation} answer accepts the application anchor`);
        const video = answer.media.find(value => value.mid === transceiver.mid);
        check(video?.port !== 0 && video?.direction === 'a=sendonly'
          && video.lines.some(value => /^a=rtpmap:\d+ H264\/90000$/i.test(value)),
        `Generation ${generation} answer admits the actual H264 capability`);
        check(video.lines.some(value => value.includes('transport-wide-cc-extensions-01'))
          && video.lines.some(value => /^a=rtcp-fb:\d+ transport-cc$/.test(value)),
        `Generation ${generation} answer retains transport-wide congestion feedback`);
        generations.push({ generation, applicationMid: anchor, videoMid: transceiver.mid, activeVideos: active.length,
          localAndRemoteDescriptionsAccepted: true, transportWideFeedbackRetained: true });
      }
      check(channels.map(channel => channel.label).join(',') === 'control,video,audio'
        && channels.every(channel => channel.ordered && channel.readyState !== 'closed'),
      'All three ordered DataChannels remain present');
      return { scope: 'sdp-admission-only', browser: navigator.userAgent, generations, checks,
        sourcePicturesEncoded: false, rtpDeliveryTested: false, physicalPerformanceMeasured: false };
    } finally { receiver.close(); sender.close(); }
  });
  assert.deepEqual(errors, []);
  assert.equal(result.generations.length, 4);
  assert.equal(result.rtpDeliveryTested, false);
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); }
