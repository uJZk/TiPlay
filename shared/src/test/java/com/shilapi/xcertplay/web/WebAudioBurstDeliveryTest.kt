package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

class WebAudioBurstDeliveryTest {
    private val format = WebAudioHub.EncodedFormat("aac-lc", 48000, 2, 16, 1024, asc = byteArrayOf(0x11, 0x90.toByte()))
    private fun epoch(packet: ByteArray) = ByteBuffer.wrap(packet).getInt(16)
    private fun drain(reader: WebAudioHub.Subscription) = buildList {
        while (true) add(reader.take(0) ?: break)
    }

    @Test fun carPlayAacBurstsKeepAllEighteenPacketsInTheirOriginalEpoch() {
        val hub = WebAudioHub(); val owner = Any()
        hub.begin(owner); hub.beginEncodedStream(owner, 0, format)
        val reader = hub.subscribe()
        try {
            val initial = requireNotNull(reader.take(100))
            assertEquals(6, initial[4].toInt())
            repeat(4) { burst ->
                // Observed iPhone type-102 input: 18 consecutive AAC frames arrive before a read.
                repeat(18) { index ->
                    val sample = burst * 18 + index
                    hub.publishEncoded(owner, byteArrayOf(sample.toByte()), sample * 1024e6 / 48000,
                        presentationNanos = sample * 1024_000_000_000L / 48000)
                }
                repeat(18) { index ->
                    val packet = requireNotNull(reader.take(100))
                    assertEquals(7, packet[4].toInt())
                    assertEquals(burst * 18 + index, packet[36].toInt())
                    assertEquals(epoch(initial), epoch(packet))
                    assertEquals(0, packet[7].toInt() and 2)
                }
                assertNull(reader.take(0))
            }
        } finally { reader.close() }
    }

    @Test fun realtimeByteOverflowRestoresTheCodecAndDrainingReleasesItsBudget() {
        for (mirror in listOf(false, true)) {
            val hub = WebAudioHub(); val owner = Any()
            val id = if (mirror) WebAudioHub.AIRPLAY_MIRROR_STREAM else 0
            if (mirror) hub.beginEncoded(owner, format)
            else { hub.begin(owner); hub.beginEncodedStream(owner, id, format) }
            val reader = hub.subscribe()
            try {
                val initialEpoch = epoch(requireNotNull(reader.take(100)))
                repeat(5) { hub.publishEncoded(owner, ByteArray(64 * 1024) { _ -> it.toByte() }, it.toDouble(), id = id) }
                val records = drain(reader)
                assertEquals(6, records.first()[4].toInt())
                assertTrue(epoch(records.first()) > initialEpoch)
                val packets = records.drop(1)
                assertTrue(packets.sumOf { it.size } <= 256 * 1024)
                assertEquals(listOf(3, 4), packets.map { it[36].toInt() })
                assertTrue(packets.all { it[4].toInt() == 7 && epoch(it) == epoch(records.first()) })
                repeat(3) { hub.publishEncoded(owner, ByteArray(64 * 1024) { _ -> (it + 5).toByte() }, it.toDouble(), id = id) }
                val next = drain(reader)
                assertEquals(listOf(5, 6, 7), next.map { it[36].toInt() })
                assertTrue(next.all { it[4].toInt() == 7 && epoch(it) == epoch(records.first()) })
            } finally { reader.close() }
        }
    }

    @Test fun retiringAProducerReleasesItsByteBudgetBeforeTheReplacementPublishes() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner)
        val first = hub.publication(owner)
        hub.beginEncodedStream(owner, 0, format, publication = first)
        val reader = hub.subscribe()
        try {
            reader.take(100)
            repeat(3) { hub.publishEncoded(owner, ByteArray(64 * 1024), it.toDouble(), publication = first) }
            first.close()
            val next = hub.publication(owner)
            hub.beginEncodedStream(owner, 0, format, publication = next)
            val configuration = requireNotNull(reader.take(100))
            repeat(3) { hub.publishEncoded(owner, ByteArray(64 * 1024) { _ -> (it + 1).toByte() }, it.toDouble(), publication = next) }
            val records = drain(reader)
            assertEquals(listOf(1, 2, 3), records.map { it[36].toInt() })
            assertTrue(records.all { it[4].toInt() == 7 && epoch(it) == epoch(configuration) })
        } finally { reader.close() }
    }

    @Test fun flushingReleasesRealtimeBytesAndKeepsTheNextBurstInOneEpoch() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner)
        hub.beginEncodedStream(owner, 0, format); val reader = hub.subscribe()
        try {
            reader.take(100)
            repeat(3) { hub.publishEncoded(owner, ByteArray(64 * 1024), it.toDouble()) }
            hub.flushEncoded(owner)
            val configuration = requireNotNull(reader.take(100))
            repeat(3) { hub.publishEncoded(owner, ByteArray(64 * 1024) { _ -> (it + 1).toByte() }, it.toDouble()) }
            val records = drain(reader)
            assertEquals(listOf(1, 2, 3), records.map { it[36].toInt() })
            assertTrue(records.all { it[4].toInt() == 7 && epoch(it) == epoch(configuration) })
        } finally { reader.close() }
    }

    @Test fun legacyPcmSharesTheRealtimeByteBoundAndMarksOverflowDiscontinuous() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        try {
            repeat(5) { hub.publish(owner, 1, 48000, 2, ByteArray(64 * 1024) { _ -> it.toByte() }) }
            val records = drain(reader)
            assertTrue(records.sumOf { it.size } <= 256 * 1024)
            assertEquals(listOf(3, 4), records.map { it[28].toInt() })
            assertEquals(2, records.first()[7].toInt() and 2)
            assertEquals(0, records.last()[7].toInt() and 2)
        } finally { reader.close() }
    }

    @Test fun continuousRealtimeStreamsCannotStarveEachOtherOrBufferedMusic() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); hub.beginEncodedStream(carPlay, 3, format)
        hub.beginEncodedStream(carPlay, 0, format, buffered = true); hub.beginEncoded(mirror, format)
        val reader = hub.subscribe()
        try {
            drain(reader)
            repeat(18) {
                hub.publishEncoded(carPlay, byteArrayOf(1), it.toDouble(), id = 3)
                hub.publishEncoded(mirror, byteArrayOf(2), it.toDouble(), id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
            }
            hub.publishEncoded(carPlay, byteArrayOf(3), 0.0, buffered = true)
            val delivered = mutableListOf<Int>()
            repeat(18) {
                val packet = requireNotNull(reader.take(100))
                assertEquals(7, packet[4].toInt())
                val id = packet[5].toInt(); delivered += id
                if (id == 3) hub.publishEncoded(carPlay, byteArrayOf(1), (it + 18).toDouble(), id = id)
                if (id == WebAudioHub.AIRPLAY_MIRROR_STREAM)
                    hub.publishEncoded(mirror, byteArrayOf(2), (it + 18).toDouble(), id = id)
            }
            assertEquals(listOf(3, WebAudioHub.AIRPLAY_MIRROR_STREAM), delivered.take(2))
            assertTrue(delivered.indexOf(0) in 0..8)
        } finally { reader.close() }
    }

    @Test fun waitingReaderDeliversACompleteBurstWithItsConfigurationBeforeAnyPayload() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner)
        val reader = hub.subscribe()
        val started = CountDownLatch(1)
        val records = AtomicReference<List<ByteArray>>()
        val consumer = Thread {
            started.countDown()
            records.set(List(19) { requireNotNull(reader.take(5000)) })
        }.apply { start() }
        try {
            assertTrue(started.await(1, TimeUnit.SECONDS)); assertTrue(awaitWaiting(consumer))
            synchronized(reader) {
                hub.beginEncodedStream(owner, 0, format)
                repeat(18) { hub.publishEncoded(owner, byteArrayOf(it.toByte()), it.toDouble()) }
            }
            consumer.join(2000); assertFalse(consumer.isAlive)
            val delivered = requireNotNull(records.get())
            assertEquals(6, delivered.first()[4].toInt())
            assertEquals((0..17).toList(), delivered.drop(1).map { it[36].toInt() })
            assertTrue(delivered.all { epoch(it) == epoch(delivered.first()) })
        } finally { reader.close(); consumer.interrupt(); consumer.join(1000) }
    }

    @Test fun waitingReaderWakesForRealtimeRouteAndCloseWithoutBufferedMusic() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner)
        val reader = hub.subscribe()
        try {
            for (kind in 0..2) {
                val started = CountDownLatch(1)
                val result = AtomicReference<ByteArray?>()
                val consumer = Thread { started.countDown(); result.set(reader.take(30_000)) }.apply { start() }
                try {
                    assertTrue(started.await(1, TimeUnit.SECONDS)); assertTrue(awaitWaiting(consumer))
                    when (kind) {
                        0 -> hub.publish(owner, 1, 16000, 1, byteArrayOf(42, 0))
                        1 -> hub.voiceRoute(owner, "connecting", true)
                        else -> reader.close()
                    }
                    consumer.join(2000); assertFalse(consumer.isAlive)
                    when (kind) {
                        0 -> assertEquals(42, requireNotNull(result.get())[28].toInt())
                        1 -> assertEquals(5, requireNotNull(result.get())[5].toInt())
                        else -> assertNull(result.get())
                    }
                } finally { consumer.interrupt(); consumer.join(1000) }
            }
        } finally { reader.close() }
    }

    private fun awaitWaiting(thread: Thread): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (System.nanoTime() < deadline) {
            if (thread.state == Thread.State.TIMED_WAITING) return true
            Thread.sleep(1)
        }
        return false
    }
}
