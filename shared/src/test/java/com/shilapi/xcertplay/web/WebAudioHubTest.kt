package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WebAudioHubTest {
    @Test fun retiredProducerCannotPublishOrDeactivateReplacementMicrophone() {
        val hub = WebAudioHub()
        val old = Any(); val current = Any()
        hub.begin(old)
        val subscriber = hub.subscribe()
        hub.begin(current)
        repeat(5) { assertEquals(2, subscriber.take(1)!![7].toInt() and 2) }
        var samples = 0
        hub.microphone(current, 16000) { samples += it.size / 2 }
        hub.publish(old, 0, 48000, 2, ByteArray(8))
        hub.end(old)
        assertNull(subscriber.take(1))
        assertTrue(hub.acceptMicrophone(ByteArray(640)))
        assertEquals(320, samples)
        hub.end(current)
        assertFalse(hub.acceptMicrophone(ByteArray(640)))
    }

    @Test fun recordMatchesBrowserFormatAndKeepsPcmLittleEndian() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner)
        val reader = hub.subscribe()
        val pcm = byteArrayOf(0x34, 0x12, 0x78, 0x56)
        hub.publish(owner, 0, 44100, 2, pcm, buffered = true, reset = true)
        val bytes = reader.take(1)!!
        val record = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
        assertEquals(20, record.int)
        assertEquals(1, record.get().toInt())
        assertEquals(0, record.get().toInt())
        assertEquals(2, record.get().toInt())
        assertEquals(3, record.get().toInt())
        assertEquals(44100, record.int)
        assertArrayEquals(pcm, bytes.copyOfRange(20, bytes.size))
    }

    @Test fun slowRealtimeReaderResetsToFreshAudioWithoutGrowingQueue() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        repeat(17) { hub.publish(owner, 1, 16000, 1, byteArrayOf(it.toByte(), 0)) }
        val record = reader.take(1)!!
        assertEquals(2, record[7].toInt() and 2)
        assertEquals(16, record[20].toInt())
        assertNull(reader.take(1))
    }

    @Test fun disabledAudioAndInvalidMicrophoneUploadsCannotReachIPhone() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        var uploads = 0
        hub.microphone(owner, 16000) { uploads++ }
        assertFalse(hub.acceptMicrophone(ByteArray(3)))
        assertFalse(hub.acceptMicrophone(ByteArray(3202)))
        hub.enabled = false
        assertTrue(reader.closed)
        assertFalse(hub.acceptMicrophone(ByteArray(640)))
        assertEquals(0, uploads)
    }

    @Test fun realtimeOverflowNeverDiscardsBufferedMusicAndFlushRetiresQueuedMedia() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        repeat(16) { hub.publish(owner, 0, 48000, 2, byteArrayOf(it.toByte(), 0, 0, 0), buffered = true) }
        repeat(17) { hub.publish(owner, 1, 16000, 1, byteArrayOf(it.toByte(), 0)) }
        assertEquals(1, reader.take(1)!![5].toInt())
        repeat(16) { assertEquals(it, reader.take(1)!![20].toInt()) }
        hub.publish(owner, 0, 48000, 2, ByteArray(4), buffered = true)
        hub.flush(owner, 0)
        val reset = reader.take(1)!!
        assertEquals(20, reset.size)
        assertEquals(2, reset[7].toInt() and 2)
        assertNull(reader.take(1))
    }

    @Test fun microphoneDiagnosticsDistinguishSilenceRejectionAndDeliveryFailureWithoutRetainingSamples() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner)
        hub.microphone(owner, 16000) {}
        assertTrue(hub.acceptMicrophone(byteArrayOf(0, 0, 0, 0x80.toByte())))
        assertFalse(hub.acceptMicrophone(byteArrayOf(1)))
        val status = hub.microphoneStatus()
        assertEquals(1L, status["uploads"])
        assertEquals(4L, status["bytes"])
        assertEquals(32768, status["peak"])
        assertEquals(1L, status["rejected"])
        hub.microphone(owner, 16000) { throw IllegalStateException("test failure") }
        try { hub.acceptMicrophone(ByteArray(640)); fail("expected delivery failure") }
        catch (_: IllegalStateException) {}
        assertEquals(1L, hub.microphoneStatus()["failures"])
        assertEquals(0L, hub.microphoneStatus()["uploads"])
    }
}
