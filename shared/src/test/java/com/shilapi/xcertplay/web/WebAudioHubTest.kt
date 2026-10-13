package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WebAudioHubTest {
    @Test fun voiceTransitionsDiscardBufferedPcmAndSurviveAudioOwnershipUntilHardwareRelease() {
        val hub = WebAudioHub(); val carPlay = Any(); val airPlay = Any()
        hub.begin(carPlay); val reader = hub.subscribe()
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(1, 0), buffered = true)
        assertTrue(hub.voiceRoute(carPlay, "connecting", true))
        val route = reader.take(10)!!
        assertEquals(5, route[5].toInt()); assertEquals(16, route[7].toInt() and 16)
        assertNull(reader.take(10))
        hub.end(carPlay); hub.begin(airPlay)
        val nextReader = hub.subscribe()
        assertEquals(5, nextReader.take(10)!![5].toInt())
        hub.publish(airPlay, 0, 48000, 1, byteArrayOf(2, 0))
        assertNull(nextReader.take(10))
        assertFalse(hub.voiceRoute(airPlay, "idle", false))
        assertTrue(hub.voiceRoute(carPlay, "idle", false))
        val released = nextReader.take(10)!!
        assertEquals(0, released[7].toInt() and 16)
        hub.publish(airPlay, 0, 48000, 1, byteArrayOf(3, 0))
        assertEquals(3, nextReader.take(10)!![28].toInt())
        nextReader.close()
    }
    @Test fun retiredProducerCannotPublishOrDeactivateReplacementAudio() {
        val hub = WebAudioHub()
        val old = Any(); val current = Any()
        hub.begin(old)
        val subscriber = hub.subscribe()
        hub.begin(current)
        repeat(5) { assertEquals(2, subscriber.take(1)!![7].toInt() and 2) }
        hub.publish(old, 0, 48000, 2, ByteArray(8))
        hub.end(old)
        assertNull(subscriber.take(1))
        hub.publish(current, 0, 48000, 1, byteArrayOf(4, 0))
        assertEquals(4, subscriber.take(10)!![28].toInt())
        hub.end(current)
    }

    @Test fun recordMatchesBrowserFormatAndKeepsPcmLittleEndian() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner)
        val reader = hub.subscribe()
        val pcm = byteArrayOf(0x34, 0x12, 0x78, 0x56)
        hub.publish(owner, 0, 44100, 2, pcm, buffered = true, reset = true)
        val bytes = reader.take(1)!!
        val record = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
        assertEquals(28, record.int)
        assertEquals(2, record.get().toInt())
        assertEquals(0, record.get().toInt())
        assertEquals(2, record.get().toInt())
        assertEquals(3, record.get().toInt())
        assertEquals(44100, record.int)
        assertArrayEquals(pcm, bytes.copyOfRange(28, bytes.size))
    }

    @Test fun slowRealtimeReaderResetsToFreshAudioWithoutGrowingQueue() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        repeat(17) { hub.publish(owner, 1, 16000, 1, byteArrayOf(it.toByte(), 0)) }
        val record = reader.take(1)!!
        assertEquals(2, record[7].toInt() and 2)
        assertEquals(16, record[28].toInt())
        assertNull(reader.take(1))
    }

    @Test fun disabledAudioRetiresTheReaderAndCannotPublishPcm() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        hub.enabled = false
        assertTrue(reader.closed)
        hub.publish(owner, 0, 48000, 1, byteArrayOf(3, 0))
        assertNull(reader.take(10))
    }

    @Test fun realtimeOverflowNeverDiscardsBufferedMusicAndFlushRetiresQueuedMedia() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        repeat(16) { hub.publish(owner, 0, 48000, 2, byteArrayOf(it.toByte(), 0, 0, 0), buffered = true) }
        repeat(17) { hub.publish(owner, 1, 16000, 1, byteArrayOf(it.toByte(), 0)) }
        assertEquals(1, reader.take(1)!![5].toInt())
        repeat(16) { assertEquals(it, reader.take(1)!![28].toInt()) }
        hub.publish(owner, 0, 48000, 2, ByteArray(4), buffered = true)
        hub.flush(owner, 0)
        val reset = reader.take(1)!!
        assertEquals(28, reset.size)
        assertEquals(2, reset[7].toInt() and 2)
        assertNull(reader.take(1))
    }

    @Test fun presentationTimeAndStreamEpochSurvivePcmTransport() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner)
        val reader = hub.subscribe()
        hub.publish(owner, 0, 48000, 2, ByteArray(4), reset = true, presentationNanos = 1_234_567_890L)
        val first = ByteBuffer.wrap(requireNotNull(reader.take(1))).order(ByteOrder.BIG_ENDIAN)
        val epoch = first.getInt(16)
        assertEquals(1234.56789, first.getDouble(20), 0.000001)
        hub.publish(owner, 0, 48000, 2, ByteArray(4), presentationNanos = 1_235_567_890L)
        assertEquals(epoch, ByteBuffer.wrap(requireNotNull(reader.take(1))).getInt(16))
        hub.flush(owner, 0)
        val reset = ByteBuffer.wrap(requireNotNull(reader.take(1)))
        assertTrue(reset.getInt(16) != epoch)
        assertTrue(reset.getDouble(20).isNaN())
    }

    @Test fun audioIdentifiesItsModeBeforeTheIndependentVideoConfigurationArrives() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner)
        val reader = hub.subscribe()
        for (mode in BrowserPlaybackMode.entries) {
            hub.publish(owner, 0, 48000, 2, ByteArray(4), buffered = true, reset = true, mode = mode)
            val packet = requireNotNull(reader.take(1))
            assertEquals(mode.audioFlags or 3, packet[7].toInt())
        }
    }
}
