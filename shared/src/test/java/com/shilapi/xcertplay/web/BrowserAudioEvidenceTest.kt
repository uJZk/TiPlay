package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class BrowserAudioEvidenceTest {
    private fun sample(): Map<String, Any?> {
        val text = javaClass.getResourceAsStream("/Browser-audio-evidence-v1.json")!!.bufferedReader().use { it.readText() }
        @Suppress("UNCHECKED_CAST")
        return WebJson.parse(text) as Map<String, Any?>
    }
    @Test fun actualBrowserFixtureRetainsCounterTriggerAndExactFloatWaveformThroughJsonRoundTrip() {
        val value = sample()
        assertEquals(value, BrowserAudioEvidence.parse(value))
        assertNotNull(BrowserAudioEvidence.parse(WebJson.parse(WebJson.write(value))))
        val blocks = value["blocks"] as List<*>
        assertEquals(6, blocks.size)
        val row = blocks[0] as Map<*, *>
        val bytes = java.util.Base64.getDecoder().decode(row["pcm"] as String)
        val buffer = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        assertEquals(.125f, buffer.float, 0f); assertEquals(-.125f, buffer.float, 0f)
        assertEquals(256L, ((value["causes"] as List<*>)[0] as Map<*, *>)["deltaFrames"])
    }
    @Test fun malformedOversizedNestedAndMislabelledEvidenceIsRejected() {
        val value = sample(); val blocks = value["blocks"] as List<*>; val row = blocks[0] as Map<*, *>
        assertNull(BrowserAudioEvidence.parse(value + ("secret" to "injected")))
        assertNull(BrowserAudioEvidence.parse(value + ("main" to mapOf("nested" to mapOf("a" to 1)))))
        assertNull(BrowserAudioEvidence.parse(value + ("causes" to listOf(mapOf("reason" to "untrusted")))))
        assertNull(BrowserAudioEvidence.parse(value + ("blocks" to List(7) { row })))
        assertNull(BrowserAudioEvidence.parse(value + ("blocks" to listOf(row + ("pcm" to "AAAA")))))
        assertNull(BrowserAudioEvidence.parse(value + ("blocks" to listOf(row + ("durationMs" to Double.NaN)))))
        assertNull(BrowserAudioEvidence.parse(value + ("laneFields" to List(21) { "wrong" })))
        assertNull(BrowserAudioEvidence.parse(value + ("id" to -1)))
    }
}
