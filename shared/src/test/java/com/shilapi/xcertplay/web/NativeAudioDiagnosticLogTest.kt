package com.shilapi.xcertplay.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAudioDiagnosticLogTest {
    @Test fun allNativeFieldsSurviveBoundedFailureLines() {
        val details = nativeAudioDiagnostics(longestNativeValues())
        val expectedKeys = setOf(
            "available", "connection", "ice", "connectionChanges", "iceChanges", "gathering", "signaling",
            "gatheringChanges", "signalingChanges", "remoteDescriptionSetResult", "localDescriptionSetResult",
            "localDescriptionType", "remoteDescriptionType", "selectedPair", "selectedPairResult",
            "localCandidateType", "localCandidateProtocol", "localCandidateFamily", "localCandidatePresent",
            "remoteCandidateType", "remoteCandidateProtocol", "remoteCandidateFamily", "remoteCandidatePresent",
        )
        assertEquals(23, details.size)
        assertEquals(expectedKeys, details.keys)
        assertEquals(-2147483647, details["remoteDescriptionSetResult"])
        assertEquals(Int.MAX_VALUE, details["localDescriptionSetResult"])
        assertEquals(Int.MIN_VALUE, details["selectedPairResult"])
        assertEquals("have-remote-pranswer", details["signaling"])
        assertEquals(65535, details["connectionChanges"])

        val prefix = longestPrefix()
        val lines = NativeAudioDiagnosticLog.lines(prefix, details)
        assertTrue("The full native diagnostic snapshot needs multiple bounded lines", lines.size > 1)
        assertEquals(asText(details), fields(prefix, lines))
    }

    @Test fun unknownNativeStatesAndNullResultsRemainExplicit() {
        val raw = IntArray(21) { -1 }
        raw[8] = Int.MIN_VALUE
        raw[9] = Int.MIN_VALUE
        raw[12] = -3
        val details = nativeAudioDiagnostics(raw)
        val prefix = "stage=negotiation-failure peer=7"
        val actual = fields(prefix, NativeAudioDiagnosticLog.lines(prefix, details))

        assertEquals(asText(details), actual)
        assertEquals("unavailable", actual["connection"])
        assertEquals("unavailable", actual["signaling"])
        assertEquals("unknown", actual["localCandidateType"])
        assertEquals("unknown", actual["remoteCandidateFamily"])
        assertEquals("not-selected", actual["selectedPair"])
        assertEquals("null", actual["remoteDescriptionSetResult"])
        assertEquals("null", actual["localDescriptionSetResult"])
    }

    @Test fun beforeAndAfterSnapshotsRetainTheirOwnFieldsAndContext() {
        val raw = longestNativeValues()
        val before = nativeAudioDiagnostics(raw)
        val beforePrefix = "stage=sender-failure peer=42 snapshot=before"
        val beforeLines = NativeAudioDiagnosticLog.lines(beforePrefix, before)
        raw[0] = 5
        raw[1] = 6
        raw[2] = 9
        raw[12] = -3
        val after = nativeAudioDiagnostics(raw)
        val afterPrefix = "stage=sender-failure peer=42 snapshot=after"
        val afterLines = NativeAudioDiagnosticLog.lines(afterPrefix, after)

        assertEquals(asText(before), fields(beforePrefix, beforeLines))
        assertEquals(asText(after), fields(afterPrefix, afterLines))
        assertEquals("disconnected", fields(beforePrefix, beforeLines)["connection"])
        assertEquals("closed", fields(afterPrefix, afterLines)["connection"])
        assertEquals("error", fields(beforePrefix, beforeLines)["selectedPair"])
        assertEquals("not-selected", fields(afterPrefix, afterLines)["selectedPair"])
    }

    @Test fun maximumKeyAndTokenLengthsSurviveDoubleDigitPartCounts() {
        val details = linkedMapOf<String, Any?>()
        repeat(31) { index ->
            val key = "field${index}".padEnd(48, 'k')
            details[key] = "safe_${index}".padEnd(64, 'v')
        }
        val prefix = longestPrefix()
        val lines = NativeAudioDiagnosticLog.lines(prefix, details)

        assertTrue("Part numbering must also remain bounded above nine parts", lines.size >= 10)
        assertEquals(asText(details), fields(prefix, lines))
    }

    @Test fun safePrimitiveTokensAndNullArePreserved() {
        val details = linkedMapOf<String, Any?>(
            "flag" to false,
            "minimum" to Long.MIN_VALUE,
            "maximum" to Long.MAX_VALUE,
            "decimal" to 12.5,
            "classification" to "have-remote-pranswer",
            "token" to "A_z-0.9",
            "notCalled" to null,
        )
        val prefix = "stage=sender-failure peer=1"

        assertEquals(asText(details), fields(prefix, NativeAudioDiagnosticLog.lines(prefix, details)))
    }

    @Test fun privateOrWhitespaceValuesAreReplacedWithoutLeakingTheirText() {
        val details = linkedMapOf<String, Any?>(
            "privateText" to "private credential",
            "sdp" to "v=0\r\na=ice-pwd:private-password",
            "url" to "https://private.example/path",
            "ipv6" to "2001:db8::1",
            "empty" to "",
            "whitespace" to " \t\n",
            "oversized" to "x".repeat(65),
            "object" to object { override fun toString() = "private-object" },
            "safe" to "unknown",
        )
        val prefix = "stage=sender-failure peer=1"
        val lines = NativeAudioDiagnosticLog.lines(prefix, details)
        val expected = details.mapValues { (key, _) -> if (key == "safe") "unknown" else "invalid" }

        assertEquals(expected, fields(prefix, lines))
        for (secret in listOf("credential", "private-password", "private.example", "2001:db8", "private-object", "x".repeat(65))) {
            assertFalse("Unsafe diagnostic value leaked: $secret", lines.any { it.contains(secret) })
        }
    }

    @Test fun invalidKeysAreOmittedWithoutLosingValidFields() {
        val details = linkedMapOf<String, Any?>(
            "" to "empty-key-secret",
            "1invalid" to "numeric-key-secret",
            "private key" to "space-key-secret",
            "private=key" to "equals-key-secret",
            "line\nbreak" to "newline-key-secret",
            "a".repeat(49) to "long-key-secret",
            "valid" to true,
        )
        val prefix = "stage=sender-failure peer=1"
        val lines = NativeAudioDiagnosticLog.lines(prefix, details)

        assertEquals(mapOf("valid" to "true"), fields(prefix, lines))
        assertFalse(lines.any { it.contains("secret") })
    }

    @Test fun unavailableOrEmptySnapshotsStillProduceOneExplicitDiagnostic() {
        val prefix = "stage=negotiation-failure peer=1"
        val unavailable = nativeAudioDiagnostics(IntArray(0))
        for (details in listOf(unavailable, emptyMap(), mapOf("invalid key" to "private"))) {
            val lines = NativeAudioDiagnosticLog.lines(prefix, details)
            assertEquals(1, lines.size)
            assertEquals(mapOf("available" to "false"), fields(prefix, lines))
        }
    }

    @Test fun prefixesRequireBoundedPrintableAscii() {
        for (prefix in listOf("", "x".repeat(181), "stage=failure\nprivate", "stage=failure\u007f", "阶段=failure")) {
            var rejected = false
            try {
                NativeAudioDiagnosticLog.lines(prefix, mapOf("available" to true))
            } catch (_: IllegalArgumentException) {
                rejected = true
            }
            assertTrue("Unsafe diagnostic prefix must be rejected", rejected)
        }
    }

    private fun longestNativeValues() = intArrayOf(
        3, 5, Int.MAX_VALUE, Int.MAX_VALUE, 1, 4, Int.MAX_VALUE, Int.MAX_VALUE,
        Int.MIN_VALUE + 1, Int.MAX_VALUE, 0, 0, Int.MIN_VALUE,
        3, 2, 3, 1, 3, 2, 3, 1,
    )

    private fun longestPrefix(): String {
        val context = "stage=sender-failure peer=9223372036854775807 snapshot=before context="
        return context + "w".repeat(180 - context.length)
    }

    private fun asText(details: Map<String, Any?>): Map<String, String> =
        details.mapValues { (_, value) -> value?.toString() ?: "null" }

    private fun fields(prefix: String, lines: List<String>): Map<String, String> {
        assertTrue("Every snapshot needs at least one diagnostic line", lines.isNotEmpty())
        val pairs = mutableListOf<Pair<String, String>>()
        lines.forEachIndexed { index, line ->
            assertTrue("Diagnostic line exceeds its formatter budget: ${line.length}", line.length <= NativeAudioDiagnosticLog.MAX_LINE_CHARS)
            assertEquals(500, NativeAudioDiagnosticLog.MAX_LINE_CHARS)
            val header = "$prefix part=${index + 1}/${lines.size} "
            assertTrue("Each part must retain the complete context and accurate numbering", line.startsWith(header))
            val body = line.removePrefix(header)
            assertTrue("Diagnostic parts must carry complete fields", body.isNotEmpty())
            for (field in body.split(' ')) {
                assertTrue("Diagnostic fields must remain safe single tokens", field.matches(Regex("[A-Za-z][A-Za-z0-9]{0,47}=[A-Za-z0-9_.-]{1,64}")))
                val separator = field.indexOf('=')
                pairs += field.substring(0, separator) to field.substring(separator + 1)
            }
        }
        assertEquals("Every diagnostic key must occur exactly once", pairs.size, pairs.map { it.first }.toSet().size)
        return pairs.toMap()
    }
}
