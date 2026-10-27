package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import org.webrtc.RTCStats
import org.webrtc.RTCStatsReport

class BrowserRtcVideoDiagnosticsTest {
    private val twcc = "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01"
    private val abs = "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"
    private fun stat(id: String, type: String, vararg fields: Pair<String, Any>) = RTCStats(123L, type, id, linkedMapOf(*fields))
    private fun report(vararg stats: RTCStats) = RTCStatsReport(123L, stats.associateBy { it.id })

    @Test fun senderReportFollowsOnlyItsCodecRemoteAndTransportLinks() {
        val result = BrowserRtcVideoDiagnostics.sender(report(
            stat("v", "outbound-rtp", "kind" to "video", "codecId" to "h", "remoteId" to "r", "transportId" to "t",
                "packetsSent" to 123L, "framesSent" to 20L, "totalPacketSendDelay" to 0.42,
                "targetBitrate" to 30_000.0, "qualityLimitationReason" to "bandwidth"),
            stat("repair", "outbound-rtp", "kind" to "video", "codecId" to "rtx", "packetsSent" to 999L),
            stat("audio", "outbound-rtp", "kind" to "audio", "packetsSent" to 888L),
            stat("h", "codec", "mimeType" to "video/H264"), stat("rtx", "codec", "mimeType" to "video/rtx"),
            stat("r", "remote-inbound-rtp", "reportsReceived" to 4L, "roundTripTime" to 0.006, "roundTripTimeMeasurements" to 3L),
            stat("t", "transport", "selectedCandidatePairId" to "p"),
            stat("p", "candidate-pair", "currentRoundTripTime" to 0.004, "availableOutgoingBitrate" to 12_000_000.0),
            stat("other-pair", "candidate-pair", "currentRoundTripTime" to 2.0, "availableOutgoingBitrate" to 1.0)))
        assertEquals("selected", result["state"])
        assertEquals(123.0, result["out.packetsSent"])
        assertEquals(420.0, result["out.totalPacketSendDelayMs"])
        assertEquals(30_000.0, result["out.targetBitrate"])
        assertEquals("bandwidth", result["out.qualityLimitationReason"])
        assertEquals(6.0, result["remote.roundTripTimeMs"])
        assertEquals(4.0, result["pair.currentRoundTripTimeMs"])
        assertEquals(12_000_000.0, result["pair.availableOutgoingBitrate"])
    }

    @Test fun arbitraryReportValuesAndIdsNeverReachTheDiagnosticFields() {
        val secret = "address=private token=secret arbitrary SDP"
        val result = BrowserRtcVideoDiagnostics.sender(report(
            stat(secret, "outbound-rtp", "mediaType" to "video", "packetsSent" to Double.NaN,
                "bytesSent" to -1L, "framesEncoded" to Double.POSITIVE_INFINITY, "framesSent" to "50",
                "nackCount" to 9e13, "qualityLimitationReason" to secret, "remoteId" to secret, "transportId" to secret),
            stat("private-remote", "remote-inbound-rtp", "reportsReceived" to 99L)))
        assertEquals(mapOf("state" to "selected", "remoteReport" to false, "selectedPair" to false), result)
        assertFalse(result.toString().contains(secret))
    }

    @Test fun multiplePrimaryVideoStreamsDoNotBecomeOneInventedSenderSample() {
        val result = BrowserRtcVideoDiagnostics.sender(report(
            stat("a", "outbound-rtp", "kind" to "video", "packetsSent" to 1L),
            stat("b", "outbound-rtp", "kind" to "video", "packetsSent" to 2L)))
        assertEquals(mapOf("state" to "ambiguous"), result)
        assertEquals(mapOf("state" to "no-outbound"), BrowserRtcVideoDiagnostics.sender(report()))
    }

    @Test fun feedbackEvidenceUsesTheActualSendingSectionAndPrimaryPayload() {
        val answer = """
            v=0
            a=ice-pwd:private-password
            m=video 9 UDP/TLS/RTP/SAVPF 96
            a=mid:anchor
            a=inactive
            a=extmap:4 $twcc
            a=rtpmap:96 H264/90000
            a=rtcp-fb:96 transport-cc
            m=video 9 UDP/TLS/RTP/SAVPF 118 119
            a=mid:active
            a=sendonly
            a=extmap:4/sendonly $twcc
            a=extmap:2 $abs
            a=rtpmap:118 H264/90000
            a=rtpmap:119 rtx/90000
            a=rtcp-fb:118 transport-cc
            a=rtcp-fb:118 goog-remb
            m=video 0 UDP/TLS/RTP/SAVPF 96
            a=mid:retired
            a=sendonly
        """.trimIndent()
        val result = BrowserRtcVideoDiagnostics.negotiation(answer, "active", listOf(twcc, "private-extension"))
        assertEquals(mapOf("state" to "selected", "transportCc" to true, "googRemb" to true, "sdpTwcc" to true,
            "sdpAbsSendTime" to true, "senderTwcc" to true, "senderAbsSendTime" to false), result)
        assertFalse(result.toString().contains("private"))
        assertEquals("no-active-video", BrowserRtcVideoDiagnostics.negotiation(answer, "retired", emptyList())["state"])
    }

    @Test fun receivingOnlyExtensionsAndOtherPayloadFeedbackDoNotProveSenderFeedback() {
        val answer = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 118\r\na=mid:6\r\na=sendonly\r\n" +
            "a=extmap:4/recvonly $twcc\r\na=extmap:2/inactive $abs\r\na=rtpmap:118 H264/90000\r\n" +
            "a=rtcp-fb:96 transport-cc\r\na=rtcp-fb:118 nack pli\r\n"
        val result = BrowserRtcVideoDiagnostics.negotiation(answer, "6", emptyList())
        for (key in listOf("transportCc", "googRemb", "sdpTwcc", "sdpAbsSendTime", "senderTwcc", "senderAbsSendTime")) assertEquals(key, false, result[key])
    }

    @Test fun samplerBoundsRequestsAndRejectsExpiredCallbacksWithoutDelayingANewOwner() {
        val sampler = BrowserRtcVideoDiagnostics.Sampler(100L)
        val owner = Any(); val replacement = Any()
        val first = sampler.begin(owner, 1, 0L)!!
        assertNull(sampler.begin(owner, 1, 99L))
        assertFalse(sampler.complete(first, owner, 1, 101L))
        val fresh = sampler.begin(owner, 1, 101L)!!
        val changed = sampler.begin(replacement, 2, 102L)!!
        assertFalse(sampler.complete(fresh, owner, 1, 103L))
        assertTrue(sampler.current(changed, replacement, 2, 103L))
        assertFalse(sampler.current(changed, replacement, 1, 103L))
        assertTrue(sampler.complete(changed, replacement, 2, 103L))
        assertFalse(sampler.complete(changed, replacement, 2, 104L))
        assertNull(sampler.begin(replacement, 2, 150L))
    }

    @Test fun samplerRejectsAReusedSenderGenerationAndRetiredPeerCallbacks() {
        val sampler = BrowserRtcVideoDiagnostics.Sampler(100L); val owner = Any()
        val old = sampler.begin(owner, 1, 0L)!!
        val next = sampler.begin(owner, 2, 1L)!!
        assertFalse(sampler.complete(old, owner, 1, 2L))
        assertFalse(sampler.current(next, owner, 2, 0L))
        sampler.close()
        assertFalse(sampler.complete(next, owner, 2, 2L))
        assertNull(sampler.begin(owner, 3, 200L))
    }
}
