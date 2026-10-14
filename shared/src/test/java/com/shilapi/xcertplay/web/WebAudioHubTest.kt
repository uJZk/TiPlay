package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WebAudioHubTest {
    @Test fun disablingCarPlayDiscardsOnlyItsAudioAndKeepsMirrorConnected() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); hub.beginMirror(mirror); val reader = hub.subscribe()
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(10, 0), buffered = true)
        hub.publish(carPlay, 1, 16000, 1, byteArrayOf(20, 0))
        hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(30, 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
        hub.carPlayEnabled = false
        assertFalse(reader.closed)
        repeat(5) { assertEquals(it, reader.take(100)!![5].toInt()) }
        assertEquals(30, reader.take(100)!![28].toInt())
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(99, 0), buffered = true)
        assertNull(reader.take(10))
        hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(40, 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
        assertEquals(40, reader.take(100)!![28].toInt())
        hub.carPlayEnabled = true
        repeat(5) { reader.take(100) }
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(50, 0), buffered = true)
        assertEquals(50, reader.take(100)!![28].toInt())
        reader.close()
    }

    @Test fun mirrorStartAndStopPreserveCarPlayMusicAndPrompts() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); val reader = hub.subscribe()
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(10, 0), buffered = true)
        hub.publish(carPlay, 1, 16000, 1, byteArrayOf(20, 0))
        hub.beginMirror(mirror)
        hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(30, 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
        hub.endMirror(mirror)
        assertEquals(20, reader.take(100)!![28].toInt())
        val reset = reader.take(100)!!
        assertEquals(WebAudioHub.AIRPLAY_MIRROR_STREAM, reset[5].toInt())
        assertEquals(BrowserPlaybackMode.AIRPLAY_MIRROR.audioFlags or 2, reset[7].toInt())
        assertEquals(10, reader.take(100)!![28].toInt())
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(40, 0), buffered = true)
        assertEquals(40, reader.take(100)!![28].toInt())
        reader.close()
    }

    @Test fun mirrorOverflowAndRetiredMirrorCannotDiscardCarPlayAudio() {
        val hub = WebAudioHub(); val carPlay = Any(); val old = Any(); val current = Any()
        hub.begin(carPlay); hub.beginMirror(old); val reader = hub.subscribe()
        hub.publish(carPlay, 1, 16000, 1, byteArrayOf(20, 0))
        repeat(17) { hub.publish(old, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(it.toByte(), 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR) }
        assertEquals(20, reader.take(100)!![28].toInt())
        val fresh = reader.take(100)!!
        assertEquals(16, fresh[28].toInt()); assertEquals(2, fresh[7].toInt() and 2)
        hub.beginMirror(current)
        reader.take(100)
        hub.endMirror(old)
        hub.publish(old, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(99, 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
        assertNull(reader.take(10))
        hub.publish(current, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(30, 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
        assertEquals(30, reader.take(100)!![28].toInt())
        reader.close()
    }

    @Test fun replacingCarPlayCancelsItsWaitingProducerAndPreservesMirror() {
        val hub = WebAudioHub(); val old = Any(); val current = Any(); val mirror = Any()
        hub.begin(old); hub.beginMirror(mirror); val reader = hub.subscribe()
        repeat(16) { hub.publish(old, 0, 48000, 1, byteArrayOf(99, 0), buffered = true) }
        val producer = Thread { hub.publish(old, 0, 48000, 1, byteArrayOf(100, 0), buffered = true) }.apply { start() }
        try {
            assertTrue(awaitBufferedWaiters(listOf(producer)))
            hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(30, 0),
                mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
            hub.begin(current)
            producer.join(500); assertFalse(producer.isAlive)
            repeat(5) { assertEquals(it, reader.take(100)!![5].toInt()) }
            assertEquals(30, reader.take(100)!![28].toInt())
            assertNull(reader.take(10)); assertFalse(reader.closed)
        } finally { producer.interrupt(); producer.join(1000); reader.close() }
    }

    @Test fun aRetiredPublicationCannotEnqueueOrAdvanceTheReplacementEpoch() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        val old = hub.publication(owner)
        val ready = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val delayed = java.util.concurrent.CompletableFuture.runAsync {
            ready.countDown()
            check(release.await(2, java.util.concurrent.TimeUnit.SECONDS))
            hub.publish(owner, 0, 48000, 1, byteArrayOf(99, 0), reset = true, publication = old)
        }
        try {
            assertTrue(ready.await(1, java.util.concurrent.TimeUnit.SECONDS))
            old.close()
            val current = hub.publication(owner)
            hub.publish(owner, 0, 48000, 1, byteArrayOf(1, 0), reset = true, publication = current)
            val epoch = ByteBuffer.wrap(reader.take(100)!!).getInt(16)
            release.countDown(); delayed.get(1, java.util.concurrent.TimeUnit.SECONDS)
            assertNull(reader.take(10))
            hub.publish(owner, 0, 48000, 1, byteArrayOf(2, 0), publication = current)
            val next = reader.take(100)!!
            assertEquals(2, next[28].toInt())
            assertEquals(epoch, ByteBuffer.wrap(next).getInt(16))
            assertEquals(0, next[7].toInt() and 2)
            current.close()
        } finally { release.countDown(); reader.close() }
    }

    @Test fun retiringAFullPublicationReleasesItsQueuedAndWaitingMusicBeforeReplacement() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        val old = hub.publication(owner)
        repeat(16) { hub.publish(owner, 0, 48000, 1, byteArrayOf(99, 0), buffered = true, publication = old) }
        val producer = Thread {
            hub.publish(owner, 0, 48000, 1, byteArrayOf(100, 0), buffered = true, publication = old)
        }
        producer.start()
        try {
            assertTrue(awaitBufferedWaiters(listOf(producer)))
            old.close()
            producer.join(500)
            assertFalse(producer.isAlive)
            assertNull(reader.take(10))
            assertFalse(reader.closed)
            val current = hub.publication(owner)
            hub.publish(owner, 0, 48000, 1, byteArrayOf(3, 0), buffered = true, reset = true, publication = current)
            assertEquals(3, reader.take(100)!![28].toInt())
            current.close()
        } finally { old.close(); producer.interrupt(); producer.join(1000); reader.close() }
    }

    @Test fun retiringAPublicationCancelsEveryWaiterEvenWhenOtherMusicKeepsTheQueueFull() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        val current = hub.publication(owner)
        repeat(16) { hub.publish(owner, 0, 48000, 1, byteArrayOf(it.toByte(), 0), buffered = true, publication = current) }
        val old = hub.publication(owner)
        val done = java.util.concurrent.CountDownLatch(3)
        val failure = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val producers = List(3) {
            Thread {
                try { hub.publish(owner, 0, 48000, 1, byteArrayOf(99, 0), buffered = true, publication = old) }
                catch (error: Throwable) { failure.compareAndSet(null, error) }
                finally { done.countDown() }
            }.apply { start() }
        }
        try {
            assertTrue(awaitBufferedWaiters(producers))
            old.close()
            assertTrue("All retired producers must leave backpressure without an external interrupt", done.await(500, java.util.concurrent.TimeUnit.MILLISECONDS))
            assertNull(failure.get())
            assertFalse(reader.closed)
            repeat(16) { assertEquals(it, reader.take(100)!![28].toInt()) }
            assertNull(reader.take(10))
            hub.publish(owner, 0, 48000, 1, byteArrayOf(42, 0), buffered = true, publication = current)
            assertEquals(42, reader.take(100)!![28].toInt())
        } finally {
            old.close(); current.close()
            producers.forEach { it.interrupt(); it.join(1000) }
            reader.close()
        }
    }

    private fun awaitBufferedWaiters(producers: List<Thread>): Boolean {
        val deadline = System.nanoTime() + 500_000_000L
        while (System.nanoTime() < deadline) {
            if (producers.all { it.state == Thread.State.TIMED_WAITING }) return true
            Thread.sleep(1)
        }
        return false
    }

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
