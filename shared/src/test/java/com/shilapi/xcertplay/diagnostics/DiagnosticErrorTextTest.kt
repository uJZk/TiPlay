package com.shilapi.xcertplay.diagnostics

import org.junit.Assert.*
import org.junit.Test

class DiagnosticErrorTextTest {
    @Test fun nestedFailuresRetainTheirCauseWithoutResourceSecretsOrUnboundedMessages() {
        val failure = java.io.IOException("resource failed https://private.example/media?token=private-secret",
            java.util.concurrent.ExecutionException(java.net.SocketTimeoutException("read timed out\r\n192.168.49.1:7000")))
        val text = DiagnosticErrorText.describe(failure)
        assertTrue(text, text.contains("IOException:resource failed [url]"))
        assertTrue(text, text.contains("ExecutionException"))
        assertTrue(text, text.contains("SocketTimeoutException:read timed out"))
        assertFalse(text, text.contains("private"))
        assertFalse(text, text.contains("192.168"))
        assertFalse(text, text.contains('\n'))
        assertEquals("IOException<-ExecutionException<-SocketTimeoutException", DiagnosticErrorText.types(failure))
        assertEquals("none", DiagnosticErrorText.describe(null))
        assertTrue(DiagnosticErrorText.describe(RuntimeException("x".repeat(10_000))).length <= 700)
    }

    @Test fun cyclicAndBrokenThrowableAccessorsDoNotBreakDiagnosticCollection() {
        val cyclic = object : RuntimeException() { override val cause: Throwable get() = this }
        assertTrue(DiagnosticErrorText.describe(cyclic).endsWith("[cause-cycle]"))
        val broken = object : RuntimeException() {
            override val message: String get() = error("unavailable")
            override val cause: Throwable get() = error("unavailable")
        }
        assertEquals("OTHER", DiagnosticErrorText.describe(broken))
        assertEquals("OTHER", DiagnosticErrorText.types(broken))
    }

    @Test fun usefulFailureWordingSurvivesAsOneBoundedLine() {
        assertEquals("play() failed because the user did not interact with the document first.",
            DiagnosticErrorText.sanitize("play() failed because the user did not interact with the document first."))
        assertEquals("解码失败：没有可用的视频轨道", DiagnosticErrorText.sanitize("解码失败：没有可用的视频轨道"))
        assertEquals("decode failed next frame", DiagnosticErrorText.sanitize("decode failed\r\n\t next frame"))
        assertEquals("decode failed next frame", DiagnosticErrorText.sanitize("decode failed\u2028next\u2029frame"))
        assertEquals("", DiagnosticErrorText.sanitize(null))
        assertEquals("[message omitted: too long]", DiagnosticErrorText.sanitize("x".repeat(4_097)))
    }

    @Test fun resourceLocationsAndHeadersNeverSurviveIntoTheErrorText() {
        val messages = listOf(
            "Failed to load https://private.example/video?token=credential-one",
            "Failed to load mlhls://private.example/video",
            "Failed to load https%3A%2F%2Fprivate.example%2Fvideo",
            "Failed to load blob:https://private.example/id data:video/mp4;base64,credential-one",
            "Failed to load /airplay-resource?c=credential-one&s=session-one segments/master.m3u8?token=credential-one",
            "Failed request\r\nAuthorization: Bearer credential-one\r\nDecode failed",
            "Failed request Cookie: session=session-one; token=credential-one",
            "Failed request Basic credential-one",
        )
        messages.forEach { message ->
            val filtered = DiagnosticErrorText.sanitize(message)
            assertTrue(filtered, filtered.contains("Failed"))
            listOf("private.example", "credential-one", "session-one", "master.m3u8", "airplay-resource").forEach {
                assertFalse(filtered, filtered.contains(it))
            }
        }
    }

    @Test fun quotedCredentialsAndPairingValuesAreRemovedWithoutDiscardingTheFailure() {
        val filtered = DiagnosticErrorText.sanitize("""Invalid request {"token":"credential one", "sessionID":"session-one", "password":"credential\"tail"} pairing code "123 456" pairing_record='private record'; code=9876""")
        assertTrue(filtered, filtered.startsWith("Invalid request"))
        listOf("credential one", "session-one", "credential", "tail", "123", "456", "private record", "9876").forEach {
            assertFalse(filtered, filtered.contains(it))
        }
        assertFalse(DiagnosticErrorText.sanitize("Invalid token=\"unfinished-secret").contains("unfinished-secret"))
    }

    @Test fun addressesAndPairingIdentifiersAreRemoved() {
        val filtered = DiagnosticErrorText.sanitize("Connection refused 192.168.49.1:7000 [::1]:8080 fe80::1234%wlan0 C0:A6:00:29:58:0A C0-A6-00-29-58-0A 12345678-1234-1234-1234-123456789abc 0123456789abcdef0123456789abcdef")
        assertTrue(filtered.startsWith("Connection refused"))
        listOf("192.168", "::1", "fe80", "C0:A6", "C0-A6", "12345678", "012345").forEach {
            assertFalse(filtered, filtered.contains(it))
        }
    }

    @Test fun nativeWebrtcFailuresNeverExposeIcePasswordsOrDescriptionsOfNetworkCandidates() {
        val values = listOf(
            "Failed to set remote description: invalid a=ice-pwd:short-secret-value",
            "Failed to parse a=ice-ufrag:short-secret-value",
            "Failed to parse a=fingerprint:sha-256 01:23:45:67:89:ab:cd:ef",
            "Failed to parse a=candidate:123 1 udp 99 private-host.local 5000 typ host",
        )
        values.forEach { message ->
            val safe = DiagnosticErrorText.sanitize(message)
            assertTrue(safe, safe.startsWith("Failed"))
            assertTrue(safe, safe.contains("[webrtc-identity]"))
            listOf("short-secret", "01:23", "private-host", "5000").forEach { assertFalse(safe, safe.contains(it)) }
        }
    }
}
