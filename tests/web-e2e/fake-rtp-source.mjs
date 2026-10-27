// SPDX-License-Identifier: GPL-3.0-only
// Installed in a separate browser page; the page under test uses only production code.
export async function installFakeRtpSource({ offer, epoch, source, moduleBase, magic, headerBytes, fragmentBytes, videoTransport }) {
  const request = { epoch };
  globalThis.__fakeRtcRequest = request;
  globalThis.__fakeRtc?.dispose();
  const { encodeRecord, RECORD, FLAG } = await import(new URL('link.js', new URL(moduleBase, location.href)).href);
  if (globalThis.__fakeRtcRequest !== request) throw Error('Synthetic RTP source retired.');
  const peer = new RTCPeerConnection({ iceServers: [] });
  const state = globalThis.__fakeRtc = {
    peer, epoch, source, channels: {}, sequence: 0, unconsumed: new Map(), bytes: 0,
    authorized: false, closed: false, generation: 1, readyGeneration: 1,
    metadataRecords: 0, compressedRecords: 0, sourcePaints: 0, renegotiations: 0,
    encodedReports: new Map(), framesEncoded: 0, waiters: new Set(),
  };
  const current = () => !state.closed && globalThis.__fakeRtc === state && globalThis.__fakeRtcRequest === request;
  const reportError = error => {
    if (current()) void globalThis.__fakePhoneBridgeError(error.message, epoch).catch(() => {});
  };
  function stopCapture() {
    clearInterval(state.producer); state.producer = null;
    for (const track of state.capture?.stream.getTracks() || []) track.stop();
    state.capture = null;
  }
  state.dispose = () => {
    if (state.closed) return;
    state.closed = true; stopCapture();
    for (const finish of [...state.waiters]) finish(Error('Synthetic RTP source retired.'));
    peer.close();
    state.unconsumed.clear(); state.bytes = 0;
    if (globalThis.__fakeRtc === state) globalThis.__fakeRtc = null;
    if (globalThis.__fakeRtcRequest === request) globalThis.__fakeRtcRequest = null;
  };
  function sendControl(message) {
    if (!current() || state.channels.control?.readyState !== 'open') return false;
    state.channels.control.send(JSON.stringify(message)); return true;
  }
  state.sendRecord = (kind, payload) => {
    const channel = state.channels.video;
    const record = encodeRecord({ kind, flags: kind === RECORD.FRAME ? FLAG.KEY : 0,
      epoch: state.source.epoch, payload });
    if (!current() || !state.authorized || channel?.readyState !== 'open'
      || channel.bufferedAmount > 1024 * 1024 || state.bytes + record.length > 4 * 1024 * 1024) return false;
    const sequence = state.sequence++;
    state.unconsumed.set(sequence, record.length); state.bytes += record.length;
    for (let offset = 0; offset < record.length;) {
      const size = Math.min(record.length - offset, fragmentBytes - headerBytes);
      const fragment = new Uint8Array(headerBytes + size), header = new DataView(fragment.buffer);
      [magic, epoch, sequence, record.length, offset, size].forEach((value, index) => header.setUint32(index * 4, value, true));
      fragment.set(record.subarray(offset, offset + size), headerBytes); channel.send(fragment); offset += size;
    }
    if (kind === RECORD.CONFIG) state.metadataRecords++;
    if (kind === RECORD.FRAME) state.compressedRecords++;
    return true;
  };
  function publish() {
    if (!current() || !state.authorized || state.readyGeneration !== state.generation || !state.capture) return;
    if (state.configPending) {
      const config = { ...state.source, videoTransport, videoGeneration: state.generation };
      delete config.epoch;
      if (!state.sendRecord(RECORD.CONFIG, new TextEncoder().encode(JSON.stringify(config)))) return;
      state.configPending = false;
    }
    if (state.producer !== null && state.producer !== undefined) return;
    const capture = state.capture;
    const paint = () => {
      if (!current() || state.capture !== capture || state.readyGeneration !== state.generation) return;
      const mirror = state.source.mode === 'airplay-mirror';
      capture.brush.fillStyle = mirror ? (state.sourcePaints % 2 ? '#145adc' : '#1452d0')
        : (state.sourcePaints % 2 ? '#e12814' : '#d82014');
      capture.brush.fillRect(0, 0, capture.canvas.width, capture.canvas.height);
      state.sourcePaints++; capture.track.requestFrame();
    };
    paint(); state.producer = setInterval(paint, 1000 / state.source.fps);
  }
  async function attachSource(description) {
    await peer.setRemoteDescription({ type: 'offer', sdp: description });
    if (!current()) throw Error('Synthetic RTP source retired.');
    const transceiver = peer.getTransceivers().filter(value => !value.stopped && value.receiver.track.kind === 'video'
      && value.mid !== state.previousMid).at(-1);
    if (!transceiver) throw Error('Synthetic RTP source received no active video transceiver.');
    const profile = state.source.codec.slice(5).toLowerCase();
    const codecs = RTCRtpSender.getCapabilities('video').codecs.filter(value => value.mimeType.toLowerCase() === 'video/h264'
      && /(?:^|;)packetization-mode=1(?:;|$)/.test(value.sdpFmtpLine || '')
      && (value.sdpFmtpLine || '').toLowerCase().includes(`profile-level-id=${profile}`));
    if (!codecs.length) throw Error(`Synthetic RTP sender cannot encode ${state.source.codec}.`);
    transceiver.setCodecPreferences(codecs); transceiver.direction = 'sendonly';
    const canvas = document.createElement('canvas'); canvas.width = state.source.width; canvas.height = state.source.height;
    const brush = canvas.getContext('2d'), stream = canvas.captureStream(0), track = stream.getVideoTracks()[0];
    if (!track || typeof track.requestFrame !== 'function') { stream.getTracks().forEach(value => value.stop()); throw Error('Canvas frame capture is unavailable.'); }
    state.capture = { canvas, brush, stream, track };
    await transceiver.sender.replaceTrack(track); transceiver.sender.setStreams(stream);
    if (!current()) throw Error('Synthetic RTP source retired.');
    state.previousMid = transceiver.mid;
    await peer.setLocalDescription(await peer.createAnswer());
    if (peer.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); state.waiters.delete(finish);
        peer.removeEventListener('icegatheringstatechange', changed); error ? reject(error) : resolve();
      };
      const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(() => finish(Error('Synthetic RTP ICE gathering timed out.')), 5000);
      state.waiters.add(finish);
      peer.addEventListener('icegatheringstatechange', changed); changed();
    });
    if (!current()) throw Error('Synthetic RTP source retired.');
    return peer.localDescription.sdp;
  }
  async function handle(message) {
    if (!current()) return;
    if (message.k === 'auth') {
      const response = await globalThis.__fakePhoneAuth(message, epoch);
      if (!current()) return;
      state.authorized = !response.error; sendControl(response); publish(); return;
    }
    if (!state.authorized) throw Error('Media/control admitted before encrypted auth.');
    if (message.k === 'audio-ready' && message.enabled) {
      sendControl({ k: 'audio-barrier', generation: message.generation, sequence: 0, epoch }); return;
    }
    if (message.k === 'video-offer') {
      if (!state.pendingSource || state.negotiating || message.generation !== state.generation + 1
        || !Number.isSafeInteger(message.q) || typeof message.sdp !== 'string') throw Error('Invalid synthetic video negotiation.');
      state.negotiating = true; state.source = state.pendingSource; state.pendingSource = null;
      try {
        const sdp = await attachSource(message.sdp);
        if (!current()) return;
        state.generation = message.generation; state.renegotiations++; state.configPending = true;
        sendControl({ k: 'video-answer', q: message.q, generation: message.generation, videoTransport, sdp });
      } finally { state.negotiating = false; }
      return;
    }
    if (message.k === 'video-ready') {
      if (message.generation !== state.generation || state.readyGeneration === state.generation) throw Error('Invalid synthetic video-ready barrier.');
      state.readyGeneration = state.generation; publish(); return;
    }
    if (message.k === 'bye') {
      const response = await globalThis.__fakePhoneBye(message, epoch);
      if (current()) sendControl(response); return;
    }
    if (message.k === 'ack') {
      if (message.channel !== 'video' || state.unconsumed.get(message.q) !== message.bytes) throw Error('Invalid synthetic-phone consumption credit.');
      state.unconsumed.delete(message.q); state.bytes -= message.bytes; publish();
    } else if (Array.isArray(message.e)) {
      const response = await globalThis.__fakePhoneControl(message, epoch);
      if (current()) sendControl(response);
    }
  }
  peer.ondatachannel = ({ channel }) => {
    if (!current()) { channel.close(); return; }
    state.channels[channel.label] = channel;
    if (channel.label === 'video') channel.onopen = publish;
    if (channel.label === 'control') channel.onmessage = ({ data }) => {
      try { const message = JSON.parse(data); void handle(message).catch(reportError); } catch (error) { reportError(error); }
    };
  };
  state.changeSource = next => {
    if (!current() || !state.authorized || state.pendingSource || state.negotiating
      || state.readyGeneration !== state.generation) throw Error('Synthetic RTP source is not ready for replacement.');
    stopCapture(); state.pendingSource = next; state.readyGeneration = null;
    if (!sendControl({ k: 'video-error', generation: state.generation, reason: 'video-renegotiation-required' })) throw Error('Synthetic control channel closed.');
  };
  state.failVideo = reason => { stopCapture(); sendControl({ k: 'video-error', generation: state.generation, reason }); };
  state.injectCompressedVideo = () => state.sendRecord(RECORD.FRAME, new Uint8Array(16).fill(0x5a));
  state.snapshot = async () => {
    const reports = await peer.getStats();
    for (const report of reports.values()) if (report.type === 'outbound-rtp' && (report.kind || report.mediaType) === 'video') {
      state.encodedReports.set(report.id, Math.max(state.encodedReports.get(report.id) || 0, report.framesEncoded || 0));
    }
    state.framesEncoded = [...state.encodedReports.values()].reduce((sum, count) => sum + count, 0);
    return { source: state.source, sourcePaints: state.sourcePaints, framesEncoded: state.framesEncoded,
      metadataRecords: state.metadataRecords, compressedRecords: state.compressedRecords,
      videoGeneration: state.generation, readyGeneration: state.readyGeneration, renegotiations: state.renegotiations,
      bufferedBytes: state.bytes, active: current(), captureActive: Boolean(state.capture),
      controlState: state.channels.control?.readyState || 'connecting' };
  };
  state.configPending = true;
  try { return { sdp: await attachSource(offer) }; }
  catch (error) { state.dispose(); throw error; }
}
