package com.shilapi.xcertplay.diagnostics

import org.junit.Assert.*
import org.junit.Test

class DiagnosticErrorTextTest {
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
}
