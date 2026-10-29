package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import org.junit.Assert.*
import org.junit.Test

class ReceiverProtocolDiagnosticsTest {
    @Test fun logsOnlyWhitelistedMetadataAndNeverSensitiveRequestOrFailureContent() {
        val messages = mutableListOf<String>()
        val diagnostics = ReceiverProtocolDiagnostics(messages::add)
        val secret = "private-key-secret"
        diagnostics.request(1, RtspMessage.Request(secret, "https://private-host/$secret?token=$secret", "RTSP/1.0",
            mapOf("authorization" to secret), secret.toByteArray()))
        val failureText = "Invalid request token=$secret"
        diagnostics.failure(1, ReceiverProtocolDiagnostics.Stage.DISPATCH, IllegalArgumentException(failureText))
        diagnostics.setup(1, mapOf("ekey" to secret.toByteArray(), "eiv" to ByteArray(16),
            "streams" to listOf(mapOf("type" to 110), mapOf("type" to 96), mapOf("type" to secret)),
            "deviceID" to secret), true, 164)
        diagnostics.response(1, RtspMessage.Response(status = 403, body = secret.toByteArray(),
            headers = mapOf("authorization" to secret)))
        diagnostics.request(1, RtspMessage.Request("GET_PARAMETER", "/", "RTSP/1.0", emptyMap(),
            "volume: $secret\r\nprogress: $secret\r\n$secret\r\n".toByteArray()))
        val output = messages.joinToString("\n")
        assertFalse(output.contains(secret))
        assertFalse(output.contains("private-host"))
        assertFalse(output.contains("authorization"))
        assertTrue(output.contains("method=OTHER path=OTHER"))
        assertEquals("c=1 stage=DISPATCH exception=IllegalArgumentException causes=IllegalArgumentException errorText=${DiagnosticErrorText.sanitize(failureText)}",
            messages.first { it.contains("exception=") })
        assertTrue(output.contains("Invalid request"))
        assertTrue(output.contains("streams=[110,96,OTHER]"))
        assertTrue(output.contains("status=403"))
        assertTrue(output.contains("names=[volume,progress,OTHER]"))
    }

    @Test fun safePathOmitsQueryAndLoggingFailureDoesNotChangeProtocolExecution() {
        val messages = mutableListOf<String>()
        ReceiverProtocolDiagnostics(messages::add).request(1,
            RtspMessage.Request("GET", "/info?secret=hidden", "RTSP/1.0", emptyMap(), ByteArray(0)))
        assertEquals("c=1 stage=REQUEST method=GET path=/info bodyBytes=0", messages.single())
        ReceiverProtocolDiagnostics { error("log unavailable") }.stage(1, ReceiverProtocolDiagnostics.Stage.CLOSE)
    }

    @Test fun implicitSuccessStatusMatchesTheWireResponse() {
        val messages = mutableListOf<String>()
        val diagnostics = ReceiverProtocolDiagnostics(messages::add)
        diagnostics.response(1, RtspMessage.Response())
        diagnostics.pairingVerify(1, null, false)
        diagnostics.pairingVerify(1, 400, false)
        assertEquals("c=1 stage=RESPONSE status=200 bodyBytes=0", messages[0])
        assertEquals("c=1 stage=PAIR_VERIFY status=ok verified=false", messages[1])
        assertEquals("c=1 stage=PAIR_VERIFY status=failed verified=false", messages[2])
    }

    @Test fun videoControlDiagnosticsRecognizeAbsoluteTargetsAndHideUnknownQueryValues() {
        val messages = mutableListOf<String>()
        val diagnostics = ReceiverProtocolDiagnostics(messages::add)
        diagnostics.request(3, RtspMessage.Request("POST", "http://private-host/scrub?position=123.5&token=private-secret",
            "HTTP/1.1", emptyMap(), ByteArray(0)))
        diagnostics.request(3, RtspMessage.Request("POST", "/getProperty?playbackAccessLog&private-secret",
            "HTTP/1.1", emptyMap(), ByteArray(0)))
        val output = messages.joinToString("\n")
        assertTrue(output.contains("path=/scrub"))
        assertTrue(output.contains("target=ABSOLUTE route=/scrub selectors=[position,OTHER] position=123.5"))
        assertTrue(output.contains("route=/getProperty selectors=[playbackAccessLog,OTHER]"))
        assertFalse(output.contains("private-host"))
        assertFalse(output.contains("private-secret"))
        assertFalse(output.contains("token"))
    }

    @Test fun setupTimingMetadataUsesOnlyPresenceAndWhitelistedProtocol() {
        val messages = mutableListOf<String>()
        val diagnostics = ReceiverProtocolDiagnostics(messages::add)
        diagnostics.setup(1, mapOf("timingPort" to 0, "timingProtocol" to "NTP"), true, 164)
        diagnostics.setup(2, mapOf("timingPort" to 65432, "timingProtocol" to "PTP"), true, 164)
        diagnostics.setup(3, emptyMap<Any, Any>(), true, 164)
        diagnostics.setup(4, mapOf("timingProtocol" to "private-protocol-secret"), true, 164)
        assertTrue(messages[0].contains("timingPortProvided=true timingPortZero=true timingProtocol=NTP"))
        assertTrue(messages[1].contains("timingPortProvided=true timingPortZero=false timingProtocol=PTP"))
        assertTrue(messages[2].contains("timingPortProvided=false timingPortZero=false timingProtocol=ABSENT"))
        assertTrue(messages[3].endsWith("timingProtocol=OTHER"))
        assertFalse(messages.joinToString().contains("65432"))
        assertFalse(messages.joinToString().contains("private-protocol-secret"))
    }

    @Test fun audioSecurityDiagnosticsReportOnlyBoundedState() {
        val messages = mutableListOf<String>()
        val diagnostic = ReceiverProtocolDiagnostics(messages::add)
        diagnostic.audioSetupSecurity(1, mapOf("shk" to "secret", "usingScreen" to true, "isMedia" to "secret"), ByteArray(16) { 7 }, ByteArray(16) { 9 }, true, false)
        diagnostic.audioSetupSecurity(2, mapOf("shk" to ByteArray(32) { 4 }), null, null, false, true)
        assertEquals("c=1 stage=AUDIO_SETUP_SECURITY shk=invalid legacyKey=valid iv=valid timing=true controlCipher=false usingScreen=true isMedia=invalid", messages[0])
        assertEquals("c=2 stage=AUDIO_SETUP_SECURITY shk=valid legacyKey=absent iv=absent timing=false controlCipher=true usingScreen=absent isMedia=absent", messages[1])
        assertFalse(messages.joinToString().contains("secret"))
    }

    @Test fun resourceDiagnosticsContainOnlyStageCorrelationAndNumericResponseMetadata() {
        val messages = mutableListOf<String>()
        val diagnostics = ReceiverProtocolDiagnostics(messages::add)
        diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.REQUEST, 7)
        diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.RESPONSE, 7, 200, 1024)
        diagnostics.resource(ReceiverProtocolDiagnostics.ResourceStage.TIMEOUT, 8)
        assertEquals(listOf("resource stage=REQUEST request=7",
            "resource stage=RESPONSE request=7 status=200 bodyBytes=1024",
            "resource stage=TIMEOUT request=8"), messages)
    }

    @Test fun playbackLifecycleIncludesSafeOffsetsReasonsAndReverseChannelAvailability() {
        val messages = mutableListOf<String>()
        val diagnostics = ReceiverProtocolDiagnostics(messages::add)
        diagnostics.play(4, ReceiverPlay("https://private-host/media?token=secret", 12.5, false))
        diagnostics.play(4, ReceiverPlay("mlhls://private-secret", Double.NaN, true))
        diagnostics.finish(ReceiverServer.PlaybackFinishReason.REVERSE_CLOSE, 9)
        diagnostics.playbackEvent(9, "playing")
        diagnostics.playbackEvent(null, "private-state-secret")
        assertEquals(listOf(
            "c=4 video stage=START start=12.5 fraction=false",
            "c=4 video stage=START start=INVALID fraction=true",
            "video stage=FINISH reason=reverse-close reverse=9",
            "video stage=EVENT state=playing reverse=9 available=true",
            "video stage=EVENT state=OTHER reverse=0 available=false",
        ), messages)
        assertFalse(messages.joinToString().contains("secret"))
        assertFalse(messages.joinToString().contains("private-host"))
        val unavailable = ReceiverProtocolDiagnostics { error("logger unavailable") }
        unavailable.play(1, ReceiverPlay("https://example.test/media", 0.0, true))
        unavailable.finish(ReceiverServer.PlaybackFinishReason.BROWSER_FAILED, null)
        unavailable.playbackEvent(null, "stopped")
    }
}
