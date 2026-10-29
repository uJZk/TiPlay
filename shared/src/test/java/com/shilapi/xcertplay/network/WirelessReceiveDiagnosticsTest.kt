package com.shilapi.xcertplay.network

import java.io.File
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class WirelessReceiveDiagnosticsTest {
    @Test fun fullWidthCounterDeltasFitOnSeparateExportableLines() {
        var value = 0L
        var clock = 0L
        val diagnostics = WirelessReceiveDiagnostics("p2p0", { path, _ ->
            when (path) {
                "/proc/net/snmp" -> udp4(value)
                "/proc/net/snmp6" -> udp6(value)
                else -> value.toString()
            }
        }, { clock })
        diagnostics.snapshot()
        value = Long.MAX_VALUE
        clock = Long.MAX_VALUE
        val lines = diagnostics.snapshot().lines()
        assertEquals(3, lines.size)
        assertTrue(lines.all { "wireless snapshot cached=true $it".length < 350 })
        assertTrue(lines.first().contains("ifaceRxMissedErrorsDelta=${Long.MAX_VALUE}"))
        assertTrue(lines[1].contains("udp4InCsumErrorsDelta=${Long.MAX_VALUE}"))
        assertTrue(lines[2].contains("udp6InCsumErrorsDelta=${Long.MAX_VALUE}"))
    }

    @Test fun reportsNumericWindowDeltasForBothFamiliesWithoutExportingFileContent() {
        var value = 10L
        var clock = 0L
        val diagnostics = WirelessReceiveDiagnostics("p2p0", { path, limit ->
            assertTrue(limit in 1..16 * 1024)
            when (path) {
                "/proc/net/snmp" -> udp4(value) + "\nprivate unrelated text"
                "/proc/net/snmp6" -> udp6(value)
                else -> value.toString()
            }
        }, { clock })
        val first = diagnostics.snapshot()
        assertEquals(3, first.lines().size)
        assertTrue(first.lines().all { it.contains("windowMs=baseline udpScope=device") })
        assertTrue(first.contains("ifaceRx=baseline") && first.contains("udp4=baseline") && first.contains("udp6=baseline"))
        value = 13
        clock = 10_000_000_000L
        val result = diagnostics.snapshot()
        assertTrue(result.contains("windowMs=10000 udpScope=device"))
        assertTrue(result.contains("ifaceRxPacketsDelta=3 ifaceRxBytesDelta=3 ifaceRxDroppedDelta=3"))
        assertTrue(result.contains("udp4RcvbufErrorsDelta=3"))
        assertTrue(result.contains("udp6RcvbufErrorsDelta=3"))
        assertFalse(result.contains("p2p0") || result.contains("private") || result.contains("unrelated"))
    }

    @Test fun recreatedInterfaceAndResetCountersStartANewBaseline() {
        var value = 20L
        val diagnostics = WirelessReceiveDiagnostics("p2p0", { path, _ ->
            when (path) {
                "/proc/net/snmp" -> udp4(value)
                "/proc/net/snmp6" -> udp6(value)
                else -> value.toString()
            }
        })
        diagnostics.snapshot()
        value = 2
        val reset = diagnostics.snapshot()
        assertTrue(reset.contains("ifaceRx=reset") && reset.contains("udp4=reset") && reset.contains("udp6=reset"))
        assertFalse(reset.contains("Delta=-"))
        value = 3
        assertTrue(diagnostics.snapshot().contains("ifaceRxPacketsDelta=1"))
    }

    @Test fun inaccessibleSourcesRetryAfterBackoffAndExceptionDetailsStayPrivate() {
        var attempts = 0
        var clock = 0L
        val diagnostics = WirelessReceiveDiagnostics("p2p0", { _, _ ->
            attempts++
            throw SecurityException("phone name/password/address should never be in the report")
        }, { clock })
        val first = diagnostics.snapshot()
        val second = diagnostics.snapshot()
        assertEquals(7, attempts) // Five interface fields plus two proc sources.
        for (result in listOf(first, second)) {
            assertTrue(result.contains("ifaceRx=unavailable fields=Packets:SecurityException"))
            assertTrue(result.contains("udp4=unavailable") && result.contains("udp6=unavailable"))
            assertFalse(result.contains("password") || result.contains("phone") || result.contains("address"))
        }
        clock = 60_000_000_000L
        diagnostics.snapshot()
        assertEquals(14, attempts)
    }

    @Test fun missingOptionalInterfaceFieldKeepsOtherDeltasAndRecoversWithNewBaseline() {
        var value = 10L
        var clock = 0L
        var missing = true
        var missingReads = 0
        val diagnostics = WirelessReceiveDiagnostics("p2p0", { path, _ ->
            when {
                path.endsWith("rx_missed_errors") -> {
                    missingReads++
                    if (missing) throw java.io.FileNotFoundException("private interface details")
                    value.toString()
                }
                path == "/proc/net/snmp" -> udp4(value)
                path == "/proc/net/snmp6" -> udp6(value)
                else -> value.toString()
            }
        }, { clock })
        assertTrue(diagnostics.snapshot().contains("unavailableFields=MissedErrors:FileNotFoundException"))
        value = 13; clock = 10_000_000_000L
        val next = diagnostics.snapshot()
        assertTrue(next.contains("ifaceRxPacketsDelta=3 ifaceRxBytesDelta=3 ifaceRxDroppedDelta=3"))
        assertFalse(next.contains("private interface details"))
        assertEquals(1, missingReads)
        missing = false; value = 20; clock = 60_000_000_000L
        val restored = diagnostics.snapshot()
        assertTrue(restored.contains("ifaceRxPacketsDelta=7"))
        assertTrue(restored.contains("baselineFields=MissedErrors"))
        assertFalse(restored.contains("ifaceRxMissedErrorsDelta="))
        value = 21; clock += 10_000_000_000L
        assertTrue(diagnostics.snapshot().contains("ifaceRxMissedErrorsDelta=1"))
        assertEquals(2, missingReads)
    }

    @Test fun missingOrInvalidUdpFieldDoesNotHideOtherCounters() {
        var value = 10L
        var missing = true
        val diagnostics = WirelessReceiveDiagnostics("p2p0", { path, _ ->
            when (path) {
                "/proc/net/snmp" -> if (missing)
                    "Udp: InDatagrams InErrors RcvbufErrors\nUdp: $value bad $value" else udp4(value)
                "/proc/net/snmp6" -> if (missing)
                    "Udp6InDatagrams $value\nUdp6InErrors bad\nUdp6RcvbufErrors $value" else udp6(value)
                else -> value.toString()
            }
        })
        val first = diagnostics.snapshot()
        assertTrue(first.contains("udp4=baseline unavailableFields=InErrors,InCsumErrors"))
        assertTrue(first.contains("udp6=baseline unavailableFields=InErrors,InCsumErrors"))
        value = 12
        val next = diagnostics.snapshot()
        assertTrue(next.contains("udp4InDatagramsDelta=2 udp4RcvbufErrorsDelta=2"))
        assertTrue(next.contains("udp6InDatagramsDelta=2 udp6RcvbufErrorsDelta=2"))
        assertFalse(next.contains("bad"))
        missing = false; value = 15
        val recovered = diagnostics.snapshot()
        assertTrue(recovered.contains("baselineFields=InErrors,InCsumErrors"))
        assertFalse(recovered.contains("udp4InErrorsDelta="))
    }

    @Test fun interfaceNameCannotEscapeTheFixedStatisticsDirectory() {
        val paths = mutableListOf<String>()
        val diagnostics = WirelessReceiveDiagnostics("../../private", { path, _ ->
            paths.add(path)
            throw IOException()
        })
        assertTrue(diagnostics.snapshot().contains("ifaceRx=unavailable"))
        assertEquals(listOf("/proc/net/snmp", "/proc/net/snmp6"), paths)
    }

    @Test fun parserUsesHeadersAndRejectsMissingMalformedOrOversizedCounters() {
        val result = WirelessReceiveDiagnostics.parseUdp4(
            "Tcp: ignored fields\nUdp: RcvbufErrors NoPorts InErrors InDatagrams\nUdp: 7 123 9 11\n",
        )
        assertEquals(linkedMapOf("InDatagrams" to 11L, "InErrors" to 9L, "RcvbufErrors" to 7L), result)
        val bad = listOf(
            "Udp: InDatagrams InErrors\nUdp: 1 2",
            "Udp: InDatagrams InErrors RcvbufErrors\nUdp: 1 -2 3",
            "Udp: InDatagrams InErrors RcvbufErrors\nUdp: 1 secret 3",
            "Udp: InDatagrams InErrors RcvbufErrors\nUdp: 1 2",
            "x".repeat(16 * 1024 + 1),
        )
        bad.forEach { text ->
            try { WirelessReceiveDiagnostics.parseUdp4(text); fail("Malformed counters accepted") }
            catch (_: IOException) { }
        }
        try { WirelessReceiveDiagnostics.parseUdp6("Udp6InDatagrams 1\nUdp6InErrors 2"); fail("Missing receive-buffer counter accepted") }
        catch (_: IOException) { }
    }

    @Test fun diagnosticFileReadRejectsTruncationRatherThanPublishingAnIncorrectNumber() {
        val file = File.createTempFile("diplay-counter-test", ".txt")
        try {
            file.writeText("123\n")
            assertEquals("123\n", readBoundedDiagnosticFile(file.path, 4))
            try { readBoundedDiagnosticFile(file.path, 3); fail("Oversized source accepted") }
            catch (_: IOException) { }
        } finally { file.delete() }
    }

    private fun udp4(value: Long): String =
        "Udp: InDatagrams NoPorts InErrors OutDatagrams RcvbufErrors SndbufErrors InCsumErrors\n" +
            "Udp: $value 0 $value 0 $value 0 $value"

    private fun udp6(value: Long): String =
        "Udp6InDatagrams $value\nUdp6InErrors $value\nUdp6RcvbufErrors $value\nUdp6InCsumErrors $value"
}
