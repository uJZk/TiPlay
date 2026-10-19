package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WebAudioHubTest {
    @Test fun extendedUnsignedStreamsRetainTheirOwnConfigurationAudioAndEnd() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        repeat(5) { reader.take(100) }
        val format = WebAudioHub.EncodedFormat("pcm", 48000, 1, 16, 960)
        val main = hub.publication(owner); val extra = hub.publication(owner)
        try {
            hub.beginEncodedStream(owner, 0, format, publication = main, semanticType = 0)
            hub.beginEncodedStream(owner, 255, format, publication = extra, semanticType = 0)
            val configurations = List(2) { requireNotNull(reader.take(100)) }
            assertEquals(setOf(0, 255), configurations.map { it[5].toInt() and 255 }.toSet())
            assertTrue(configurations.all { String(it.copyOfRange(28, it.size)).contains("\"semanticType\":0") })
            hub.publishEncoded(owner, byteArrayOf(0, 10), 0.0, id = 0, publication = main)
            hub.publishEncoded(owner, byteArrayOf(0, 20), 0.0, id = 255, publication = extra)
            hub.endEncodedStream(owner, 255, extra); extra.close()
            val ended = requireNotNull(reader.take(100))
            assertEquals(255, ended[5].toInt() and 255)
            assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
            val retained = requireNotNull(reader.take(100))
            assertEquals(0, retained[5].toInt()); assertEquals(10, retained[37].toInt())
            hub.publishEncoded(owner, byteArrayOf(0, 30), 20_000.0, id = 0, publication = main)
            assertEquals(30, requireNotNull(reader.take(100))[37].toInt())
            assertNull(reader.take(10))
            hub.beginEncodedStream(owner, 255, format, publication = main, semanticType = 1)
            reader.take(100)
            repeat(WebAudioHub.MAX_REALTIME_PACKETS + 1) {
                hub.publishEncoded(owner, byteArrayOf(0, it.toByte()), it.toDouble(), id = 255, publication = main)
            }
            val recovered = requireNotNull(reader.take(100))
            assertEquals(6, recovered[4].toInt()); assertEquals(255, recovered[5].toInt() and 255)
            assertTrue(String(recovered.copyOfRange(28, recovered.size)).contains("\"semanticType\":1"))
            assertEquals(WebAudioHub.MAX_REALTIME_PACKETS, requireNotNull(reader.take(100))[37].toInt())
            hub.begin(Any())
            val resets = List(6) { requireNotNull(reader.take(100)) }
            assertEquals(setOf(0, 1, 2, 3, 4, 255), resets.map { it[5].toInt() and 255 }.toSet())
        } finally { main.close(); extra.close(); reader.close() }
    }

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
        val reset = reader.take(100)!!
        assertEquals(WebAudioHub.AIRPLAY_MIRROR_STREAM, reset[5].toInt())
        assertEquals(BrowserPlaybackMode.AIRPLAY_MIRROR.audioFlags or 2, reset[7].toInt())
        assertEquals(20, reader.take(100)!![28].toInt())
        assertEquals(10, reader.take(100)!![28].toInt())
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(40, 0), buffered = true)
        assertEquals(40, reader.take(100)!![28].toInt())
        reader.close()
    }

    @Test fun mirrorOverflowAndRetiredMirrorCannotDiscardCarPlayAudio() {
        val hub = WebAudioHub(); val carPlay = Any(); val old = Any(); val current = Any()
        hub.begin(carPlay); hub.beginMirror(old); val reader = hub.subscribe()
        hub.publish(carPlay, 1, 16000, 1, byteArrayOf(20, 0))
        repeat(WebAudioHub.MAX_REALTIME_PACKETS + 1) { hub.publish(old, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(it.toByte(), 0),
            mode = BrowserPlaybackMode.AIRPLAY_MIRROR) }
        assertEquals(20, reader.take(100)!![28].toInt())
        val fresh = reader.take(100)!!
        assertEquals(WebAudioHub.MAX_REALTIME_PACKETS, fresh[28].toInt()); assertEquals(2, fresh[7].toInt() and 2)
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

    @Test fun voiceTransitionsPreservePcmEpochsAndHoldTheRouteUntilHardwareRelease() {
        val hub = WebAudioHub(); val carPlay = Any(); val airPlay = Any()
        hub.begin(carPlay); val reader = hub.subscribe()
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(1, 0), buffered = true, reset = true)
        val epoch = ByteBuffer.wrap(reader.take(100)!!).getInt(16)
        hub.publish(carPlay, 0, 48000, 1, byteArrayOf(2, 0), buffered = true)
        assertTrue(hub.voiceRoute(carPlay, "connecting", true))
        val route = reader.take(100)!!
        assertEquals(5, route[5].toInt()); assertEquals(0, route[7].toInt())
        val queued = reader.take(100)!!
        assertEquals(2, queued[28].toInt())
        assertEquals(epoch, ByteBuffer.wrap(queued).getInt(16))
        assertEquals(false, hub.voiceStatus()["muted"])
        assertEquals("connecting", hub.voiceStatus()["state"])
        hub.end(carPlay); hub.begin(airPlay)
        val nextReader = hub.subscribe()
        assertEquals(5, nextReader.take(100)!![5].toInt())
        hub.publish(airPlay, 0, 48000, 1, byteArrayOf(3, 0))
        assertEquals(3, nextReader.take(100)!![28].toInt())
        assertFalse(hub.voiceRoute(airPlay, "connecting", true))
        assertFalse(hub.voiceRoute(airPlay, "idle", false))
        assertTrue(hub.voiceRoute(carPlay, "releasing", true))
        assertFalse(hub.voiceRoute(airPlay, "connecting", true))
        assertTrue(hub.voiceRoute(carPlay, "idle", false))
        val released = nextReader.take(100)!!
        assertEquals(0, released[7].toInt())
        assertTrue(hub.voiceRoute(airPlay, "active", true))
        assertFalse(hub.voiceRoute(carPlay, "idle", false))
        assertEquals("active", hub.voiceStatus()["state"])
        nextReader.close()
    }

    @Test fun repeatedRouteNotificationsNeverDiscardLiveMusicOrMirrorPcm() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); hub.beginMirror(mirror); val reader = hub.subscribe()
        try {
            repeat(16) { hub.publish(carPlay, 4, 16000, 1, byteArrayOf(it.toByte(), 0)) }
            hub.publish(carPlay, 0, 48000, 1, byteArrayOf(40, 0), buffered = true)
            hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(30, 0),
                mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
            repeat(100) { assertTrue(hub.voiceRoute(carPlay, "connecting", true)) }
            val route = reader.take(100)!!
            assertEquals(5, route[5].toInt())
            assertEquals(100, ByteBuffer.wrap(route).getInt(16))
            assertEquals(0, route[7].toInt())
            val records = List(18) { reader.take(100)!! }
            records.filter { it[5].toInt() == 4 }.forEachIndexed { index, prompt ->
                assertEquals(index, prompt[28].toInt())
                assertEquals(0, prompt[7].toInt())
            }
            assertEquals(16, records.count { it[5].toInt() == 4 })
            assertEquals(30, records.single { it[5].toInt() == WebAudioHub.AIRPLAY_MIRROR_STREAM }[28].toInt())
            assertEquals(40, records.single { it[5].toInt() == 0 }[28].toInt())
            assertNull(reader.take(10))
            assertFalse(reader.closed)
        } finally { reader.close() }
    }

    @Test fun streamResetControlsNeverEvictOtherStreamsFromAFullRealtimeQueue() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); hub.beginMirror(mirror); val reader = hub.subscribe()
        try {
            repeat(WebAudioHub.MAX_REALTIME_PACKETS) { hub.publish(carPlay, 0, 16000, 1, byteArrayOf(it.toByte(), 0)) }
            hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(30, 0),
                mode = BrowserPlaybackMode.AIRPLAY_MIRROR)
            repeat(100) { hub.flush(carPlay, 1); hub.flush(carPlay, 2); hub.flush(carPlay, 3) }
            for (id in 1..3) {
                val reset = reader.take(100)!!
                assertEquals(id, reset[5].toInt())
                assertEquals(28, reset.size)
                assertEquals(2, reset[7].toInt())
            }
            val records = List(WebAudioHub.MAX_REALTIME_PACKETS + 1) { reader.take(100)!! }
            records.filter { it[5].toInt() == 0 }.forEachIndexed { index, music ->
                assertEquals(0, music[5].toInt())
                assertEquals(index, music[28].toInt())
                assertEquals(0, music[7].toInt())
            }
            assertEquals(WebAudioHub.MAX_REALTIME_PACKETS, records.count { it[5].toInt() == 0 })
            assertEquals(30, records.single { it[5].toInt() == WebAudioHub.AIRPLAY_MIRROR_STREAM }[28].toInt())
            assertNull(reader.take(10))
            assertFalse(reader.closed)
        } finally { reader.close() }
    }

    @Test fun encodedSpeechControlsCannotEvictAFullRealtimeMusicQueue() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        val format = WebAudioHub.EncodedFormat("pcm", 16000, 1, 16, 352)
        try {
            hub.beginEncodedStream(owner, 0, format)
            val musicEpoch = ByteBuffer.wrap(reader.take(100)!!).getInt(16)
            repeat(WebAudioHub.MAX_REALTIME_PACKETS) { hub.publishEncoded(owner, byteArrayOf(0, it.toByte()), it.toDouble(), id = 0) }
            repeat(10) {
                hub.beginEncodedStream(owner, 1, format)
                hub.endEncodedStream(owner, 1)
            }
            val ended = reader.take(100)!!
            assertEquals(6, ended[4].toInt())
            assertEquals(1, ended[5].toInt())
            assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
            repeat(WebAudioHub.MAX_REALTIME_PACKETS) {
                val music = reader.take(100)!!
                assertEquals(7, music[4].toInt())
                assertEquals(0, music[5].toInt())
                assertEquals(it, music[37].toInt())
                assertEquals(musicEpoch, ByteBuffer.wrap(music).getInt(16))
            }
            assertNull(reader.take(10))
            assertFalse(reader.closed)
        } finally { reader.close() }
    }

    @Test fun codecConfigurationQueuedDuringABufferedWaitPrecedesItsFirstPacket() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        val result = java.util.concurrent.atomic.AtomicReference<ByteArray?>()
        val consumer = Thread { result.set(reader.take(1000)) }.apply { start() }
        try {
            assertTrue(awaitBufferedWaiters(listOf(consumer)))
            hub.beginEncodedStream(owner, 0, WebAudioHub.EncodedFormat("pcm", 16000, 1, 16, 352), buffered = true)
            hub.publishEncoded(owner, byteArrayOf(0, 42), 0.0, id = 0, buffered = true)
            consumer.join(1000)
            val configuration = requireNotNull(result.get())
            assertEquals(6, configuration[4].toInt())
            val packet = reader.take(100)!!
            assertEquals(7, packet[4].toInt())
            assertEquals(42, packet[37].toInt())
            assertEquals(ByteBuffer.wrap(configuration).getInt(16), ByteBuffer.wrap(packet).getInt(16))
            assertNull(reader.take(10))
        } finally { reader.close(); consumer.join(1000) }
    }

    @Test fun repeatedFlushKeepsOnlyItsLatestResetBeforeNewPcmAndRejectsALateOldReset() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); val reader = hub.subscribe()
        try {
            hub.flush(owner, 1)
            val oldReset = reader.take(100)!!
            val oldGeneration = reader.streamVersion(1)
            hub.publish(owner, 1, 16000, 1, byteArrayOf(41, 0))
            hub.flush(owner, 1)
            hub.publish(owner, 1, 16000, 1, byteArrayOf(42, 0))
            hub.flush(owner, 1)
            hub.publish(owner, 1, 16000, 1, byteArrayOf(43, 0), reset = true)
            reader.offer(oldReset, false, reader.generation, version = oldGeneration)
            val reset = reader.take(100)!!
            assertEquals(28, reset.size)
            assertTrue(ByteBuffer.wrap(reset).getInt(16) > ByteBuffer.wrap(oldReset).getInt(16))
            val fresh = reader.take(100)!!
            assertEquals(43, fresh[28].toInt())
            assertTrue(ByteBuffer.wrap(fresh).getInt(16) > ByteBuffer.wrap(reset).getInt(16))
            assertNull(reader.take(10))
        } finally { reader.close() }
    }

    @Test fun aResetQueuedWhileTheReaderWaitsForMusicCannotArriveAfterItsFreshPcm() {
        repeat(10) {
            val hub = WebAudioHub(); val owner = Any()
            hub.begin(owner); val reader = hub.subscribe()
            val result = java.util.concurrent.atomic.AtomicReference<ByteArray?>()
            val consumer = Thread { result.set(reader.take(1000)) }.apply { start() }
            try {
                assertTrue(awaitBufferedWaiters(listOf(consumer)))
                hub.flush(owner, 0)
                hub.publish(owner, 0, 48000, 1, byteArrayOf(44, 0), buffered = true)
                consumer.join(1000)
                assertFalse(consumer.isAlive)
                val first = requireNotNull(result.get())
                val fresh = if (first.size == 28) reader.take(100)!! else first
                assertEquals(44, fresh[28].toInt())
                assertEquals(2, first[7].toInt() and 2)
                assertEquals(ByteBuffer.wrap(first).getInt(16), ByteBuffer.wrap(fresh).getInt(16))
                assertNull(reader.take(10))
            } finally { consumer.interrupt(); consumer.join(1000); reader.close() }
        }
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
        repeat(WebAudioHub.MAX_REALTIME_PACKETS + 1) { hub.publish(owner, 1, 16000, 1, byteArrayOf(it.toByte(), 0)) }
        val record = reader.take(1)!!
        assertEquals(2, record[7].toInt() and 2)
        assertEquals(WebAudioHub.MAX_REALTIME_PACKETS, record[28].toInt())
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
        repeat(WebAudioHub.MAX_REALTIME_PACKETS + 1) { hub.publish(owner, 1, 16000, 1, byteArrayOf(it.toByte(), 0)) }
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
    @Test fun reliableEncodedResetPreservesEveryAlreadyAdmittedPacketInOrder() {
        var now = 0L
        val hub = WebAudioHub { now }; val owner = Any(); hub.begin(owner)
        val format = WebAudioHub.EncodedFormat("aac-lc", 48000, 2, 16, 1024)
        hub.beginEncodedStream(owner, 0, format)
        val reader = hub.subscribe(reliable = true)
        assertEquals(6, reader.take(0)!![4].toInt())
        hub.publishEncoded(owner, byteArrayOf(10), 0.0)
        hub.publishEncoded(owner, byteArrayOf(20), 1024.0)
        hub.flushEncoded(owner)
        hub.publishEncoded(owner, byteArrayOf(30), 2048.0)
        val records = List(4) { requireNotNull(reader.take(0)) }
        assertEquals(listOf(7, 7, 6, 7), records.map { it[4].toInt() })
        assertEquals(listOf(10, 20, 30), records.filter { it[4].toInt() == 7 }.map { it[36].toInt() })
        assertEquals(2, ByteBuffer.wrap(records.last()).getInt(16))
        assertFalse(reader.closed)
        assertNull(reader.take(0))
        reader.close()
    }

    @Test fun reliableAudioPacketAndByteBoundsTerminateWithoutBlockingOrResettingEpoch() {
        val hub = WebAudioHub { 0L }; val owner = Any(); hub.begin(owner)
        val format = WebAudioHub.EncodedFormat("aac-lc", 48000, 2, 16, 1024)
        hub.beginEncodedStream(owner, 0, format, buffered = true)
        val reader = hub.subscribe(reliable = true)
        assertEquals(6, reader.take(0)!![4].toInt())
        repeat(WebAudioHub.MAX_RELIABLE_PACKETS + 1) {
            hub.publishEncoded(owner, byteArrayOf(it.toByte()), it.toDouble(), buffered = true)
        }
        assertTrue(reader.closed)
        assertEquals("reliable-overload", reader.endReason)
        assertNull(reader.take(0))
        val next = hub.subscribe(reliable = true)
        assertEquals(1, ByteBuffer.wrap(requireNotNull(next.take(0))).getInt(16))
        repeat(17) { hub.publishEncoded(owner, ByteArray(WebAudioHub.MAX_PCM), it.toDouble(), buffered = true) }
        assertTrue(next.closed)
        assertEquals("reliable-overload", next.endReason)
    }

    @Test fun reliableAudioAgeBoundAppliesOnBothDeliveryAndAdmission() {
        var now = 0L
        val hub = WebAudioHub { now }; val owner = Any(); hub.begin(owner)
        val reader = hub.subscribe(reliable = true)
        hub.publish(owner, 0, 48000, 1, byteArrayOf(1, 0))
        now = WebAudioHub.MAX_RELIABLE_AGE_NANOS
        assertNull(reader.take(0))
        assertEquals("reliable-expired", reader.endReason)
        val next = hub.subscribe(reliable = true)
        hub.publish(owner, 0, 48000, 1, byteArrayOf(2, 0))
        now += WebAudioHub.MAX_RELIABLE_AGE_NANOS
        hub.publish(owner, 0, 48000, 1, byteArrayOf(3, 0))
        assertTrue(next.closed)
        assertEquals("reliable-expired", next.endReason)
    }

    @Test fun reliablePublicationRetirementPreservesQueuedGuidanceAndContinuousMusic() {
        val hub = WebAudioHub { 0L }; val owner = Any(); hub.begin(owner)
        val music = hub.publication(owner); val guidance = hub.publication(owner)
        val format = WebAudioHub.EncodedFormat("aac-lc", 48000, 2, 16, 1024)
        hub.beginEncodedStream(owner, 0, format, publication = music, buffered = true)
        hub.beginEncodedStream(owner, 1, format, publication = guidance)
        val reader = hub.subscribe(reliable = true)
        repeat(2) { assertEquals(6, reader.take(0)!![4].toInt()) }
        hub.publishEncoded(owner, byteArrayOf(10), 0.0, id = 0, publication = music, buffered = true)
        hub.publishEncoded(owner, byteArrayOf(20), 0.0, id = 1, publication = guidance)
        guidance.close()
        guidance.close() // Idempotent: do not append another end or advance the epoch again.
        hub.publishEncoded(owner, byteArrayOf(99), 1.0, id = 1, publication = guidance)
        hub.beginEncodedStream(owner, 1, format, publication = guidance)
        hub.publishEncoded(owner, byteArrayOf(30), 1.0, id = 0, publication = music, buffered = true)
        assertFalse(reader.closed)
        assertNull(reader.endReason)
        val records = List(4) { requireNotNull(reader.take(0)) }
        assertEquals(listOf(7, 7, 6, 7), records.map { it[4].toInt() })
        assertEquals(listOf(0, 1, 1, 0), records.map { it[5].toInt() })
        assertEquals(listOf(10, 20, 30), records.filter { it[4].toInt() == 7 }.map { it[36].toInt() })
        assertTrue(String(records[2].copyOfRange(28, records[2].size)).contains("\"ended\":true"))
        assertEquals(1, ByteBuffer.wrap(records.last()).getInt(16))
        assertEquals(2, ByteBuffer.wrap(records[2]).getInt(16))
        assertNull(reader.take(0))
        val replacement = hub.publication(owner)
        hub.beginEncodedStream(owner, 1, format, publication = replacement)
        assertEquals(3, ByteBuffer.wrap(requireNotNull(reader.take(0))).getInt(16))
        hub.publishEncoded(owner, byteArrayOf(40), 2.0, id = 0, publication = music, buffered = true)
        assertEquals(40, requireNotNull(reader.take(0))[36].toInt())
        assertFalse(reader.closed)
        reader.close()
    }

    @Test fun reliablePcmRetirementUsesOnlyItsStreamFormatAndLeavesAlreadyDeliveredMusicRunning() {
        val hub = WebAudioHub { 0L }; val owner = Any(); hub.begin(owner)
        val music = hub.publication(owner); val guidance = hub.publication(owner)
        val reader = hub.subscribe(reliable = true)
        hub.publish(owner, 0, 48000, 2, byteArrayOf(10, 0, 10, 0), publication = music)
        hub.publish(owner, 1, 16000, 1, byteArrayOf(20, 0), publication = guidance)
        assertEquals(10, requireNotNull(reader.take(0))[28].toInt())
        assertEquals(20, requireNotNull(reader.take(0))[28].toInt())
        guidance.close() // Stream metadata must survive draining the media queue.
        hub.publish(owner, 1, 16000, 1, byteArrayOf(99, 0), publication = guidance)
        hub.publish(owner, 0, 48000, 2, byteArrayOf(30, 0, 30, 0), publication = music)
        val reset = requireNotNull(reader.take(0))
        assertEquals(28, reset.size)
        assertEquals(1, reset[5].toInt())
        assertEquals(1, reset[6].toInt())
        assertEquals(16000, ByteBuffer.wrap(reset).getInt(8))
        assertEquals(2, reset[7].toInt() and 2)
        assertEquals(30, requireNotNull(reader.take(0))[28].toInt())
        assertNull(reader.take(0))
        assertFalse(reader.closed)
        reader.close()
    }

}
