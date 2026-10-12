package com.shilapi.xcertplay.network

import org.junit.Assert.*
import org.junit.Test

class HotspotConfigurationReaderTest {
    @Test fun readsUnicodeAndDelimiterCharactersWithoutExposingSecrets() {
        val encoded = HotspotConfigurationReader.format("本机 | hotspot", "secret|123")
        val result = HotspotConfigurationReader.parse("shell warning\n$encoded\n")!!
        assertEquals("本机 | hotspot", result.ssid)
        assertEquals("secret|123", result.password)
        assertFalse(encoded.contains("secret|123"))
        assertFalse(result.toString().contains("secret|123"))
    }

    @Test fun readsOpenHotspotsAndRejectsBrokenOrAmbiguousResults() {
        val record = HotspotConfigurationReader.format("Phone", null)
        assertNull(HotspotConfigurationReader.parse(record)!!.password)
        assertNull(HotspotConfigurationReader.parse("$record\n$record"))
        assertNull(HotspotConfigurationReader.parse("TIPLAY_HOTSPOT_READ_V1|0x|dead"))
        assertNull(HotspotConfigurationReader.parse(HotspotConfigurationReader.format("a".repeat(33), null)))
        assertNull(HotspotConfigurationReader.parse("Permission denied"))
    }

    @Test fun commandQuotesApkPathsAndRejectsNewlines() {
        val command = HotspotConfigurationReader.command("/data/app/a'b/base.apk")
        assertTrue(command.contains("CLASSPATH='/data/app/a'\"'\"'b/base.apk'"))
        assertTrue(command.endsWith("com.shilapi.xcertplay.network.HotspotConfigurationReaderMain"))
        assertThrows(IllegalArgumentException::class.java) { HotspotConfigurationReader.command("/data/app/a\nwrong.apk") }
    }
}
