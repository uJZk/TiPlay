package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class BrowserRtcAudioCaptureTest {
    private fun audioRecord(kind: Int, flags: Int, payload: ByteArray = byteArrayOf()) =
        ByteBuffer.allocate(28 + payload.size).order(ByteOrder.BIG_ENDIAN)
            .putInt(24 + payload.size).put(kind.toByte()).put(0).put(2).put(flags.toByte())
            .putInt(48_000).putInt(0).putInt(1).putDouble(Double.NaN).put(payload).array()

    @Test fun configurationResetAndMediaKeepOneFullCopyAndMetadataReferences() {
        val captured = mutableListOf<Pair<String, ByteArray>>()
        val capture = BrowserRtcAudioCapture(71, { true }) { channel, bytes -> captured += channel to bytes }
        val records = listOf(audioRecord(6, 0, "{\"codec\":\"opus\"}".toByteArray()),
            audioRecord(2, 2), audioRecord(7, 0, byteArrayOf(1, 2, 3)))
        var accepted = 0
        records.forEachIndexed { index, bytes -> capture.send(index, bytes) { accepted++ } }
        val payloads = captured.filter { it.first == "browser/audio/rtc/71/records" }
        assertEquals(3, accepted)
        assertEquals(records.size, payloads.size)
        records.forEachIndexed { index, bytes -> assertSame(bytes, payloads[index].second) }
        val events = captured.filter { it.first.endsWith("/events") }.map {
            WebJson.parse(String(it.second, Charsets.UTF_8)) as Map<*, *>
        }
        records.forEachIndexed { index, bytes ->
            assertEquals(listOf("attempt", "local-enqueue"), events.filter { it["sequence"] == index.toLong() }.map { it["phase"] })
            assertTrue(events.filter { it["sequence"] == index.toLong() }.all { it["bytes"] == bytes.size.toLong() })
        }
        assertTrue(events.none { it["phase"] == "received" || it["phase"] == "consumed" })
    }

    @Test fun failedSendRetainsTheRecordOnceWithoutClaimingSuccessfulEnqueue() {
        val captured = mutableListOf<Pair<String, ByteArray>>()
        val capture = BrowserRtcAudioCapture(1, { true }) { channel, bytes -> captured += channel to bytes }
        val bytes = audioRecord(7, 0, byteArrayOf(9))
        val failure = IllegalStateException("transport-send")
        try { capture.send(-1, bytes) { throw failure }; fail("send failure swallowed") }
        catch (actual: IllegalStateException) { assertSame(failure, actual) }
        assertEquals(1, captured.count { it.first.endsWith("/records") })
        val events = captured.filter { it.first.endsWith("/events") }.map { WebJson.parse(String(it.second)) as Map<*, *> }
        assertEquals(listOf("attempt", "failed"), events.map { it["phase"] })
        assertTrue(events.all { it["sequence"] == 0xffff_ffffL })
        assertTrue((events.last()["error"] as String).contains("transport-send"))
    }

    @Test fun disabledCaptureDoesNotRecordOrChangeTheSend() {
        var accepted = false
        val capture = BrowserRtcAudioCapture(1, { false }) { _, _ -> fail("capture disabled") }
        capture.send(0, audioRecord(2, 2)) { accepted = true }
        assertTrue(accepted)
    }
}
