package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class WebEncodedAudioHubTest {
    private val format = WebAudioHub.EncodedFormat("aac-eld", 44100, 2, 16, 480,
        asc = byteArrayOf(0xf8.toByte(), 0xe8.toByte(), 0x50, 0))
    private fun epoch(packet: ByteArray) = ByteBuffer.wrap(packet).getInt(16)

    @Test fun configurationAndUntouchedPayloadCarryIndependentDecodeAndPresentationTimes() {
        val hub = WebAudioHub(); val owner = Any()
        hub.beginEncoded(owner, format)
        val reader = hub.subscribe()
        val config = requireNotNull(reader.take(10))
        assertEquals(6, config[4].toInt())
        assertEquals(6, config[7].toInt())
        val json = String(config.copyOfRange(28, config.size), Charsets.UTF_8)
        assertTrue(json.contains("\"codec\":\"aac-eld\""))
        assertTrue(json.contains("\"asc\":[248,232,80,0]"))
        val raw = byteArrayOf(1, 2, 3, 4, 5)
        hub.publishEncoded(owner, raw, 12345.0, 8_765_432_100L, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        val packet = requireNotNull(reader.take(10))
        val header = ByteBuffer.wrap(packet)
        assertEquals(7, packet[4].toInt()); assertEquals(4, packet[7].toInt())
        assertEquals(epoch(config), epoch(packet))
        assertEquals(8765.4321, header.getDouble(20), 0.000001)
        assertEquals(12345.0, header.getDouble(28), 0.0)
        assertArrayEquals(raw, packet.copyOfRange(36, packet.size))
        assertEquals(packet.size - 4, header.getInt(0))
        assertNull(reader.take(1))
    }

    @Test fun flushRetiresQueuedAccessUnitsAndReplaysConfigurationWithANewEpoch() {
        val hub = WebAudioHub(); val owner = Any()
        hub.beginEncoded(owner, format); val reader = hub.subscribe()
        val oldEpoch = epoch(requireNotNull(reader.take(10)))
        hub.publishEncoded(owner, byteArrayOf(99), 1.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        hub.flushEncoded(owner, WebAudioHub.AIRPLAY_MIRROR_STREAM)
        val config = requireNotNull(reader.take(10))
        assertEquals(6, config[4].toInt()); assertTrue(oldEpoch != epoch(config))
        hub.publishEncoded(owner, byteArrayOf(7), 2.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        val next = requireNotNull(reader.take(10))
        assertEquals(7, next[4].toInt()); assertEquals(epoch(config), epoch(next))
        assertArrayEquals(byteArrayOf(7), next.copyOfRange(36, next.size))
        assertNull(reader.take(1))
    }

    @Test fun slowReaderGetsFreshConfigurationBeforeAnyPacketFromANewBoundedEpoch() {
        val hub = WebAudioHub(); val owner = Any()
        hub.beginEncoded(owner, format); val reader = hub.subscribe()
        repeat(100) { hub.publishEncoded(owner, byteArrayOf(it.toByte()), it.toDouble(), id = WebAudioHub.AIRPLAY_MIRROR_STREAM) }
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        assertTrue(records.size <= WebAudioHub.MAX_REALTIME_PACKETS + 1)
        assertEquals(6, records.first()[4].toInt())
        assertTrue(records.drop(1).all { it[4].toInt() == 7 && epoch(it) == epoch(records.first()) })
        assertEquals(99, records.last()[36].toInt())
    }

    @Test fun stopAndReplacementDiscardOldPacketsAndRestoreConfigurationOnReconnect() {
        val hub = WebAudioHub(); val old = Any(); val current = Any()
        hub.beginEncoded(old, format); var reader = hub.subscribe()
        reader.take(10)
        hub.publishEncoded(old, byteArrayOf(1), 1.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        hub.endMirror(old)
        val ended = buildList { while (true) add(reader.take(1) ?: break) }.last()
        assertEquals(6, ended[4].toInt())
        assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
        hub.beginEncoded(current, format)
        reader = hub.subscribe()
        val config = requireNotNull(reader.take(10))
        assertEquals(6, config[4].toInt())
        hub.publishEncoded(old, byteArrayOf(99), 2.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM); hub.endMirror(old)
        assertNull(reader.take(1))
        hub.publishEncoded(current, byteArrayOf(3), 3.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        assertEquals(3, requireNotNull(reader.take(10))[36].toInt())
    }

    @Test fun voiceDemandPreservesEncodedMirrorMediaAndItsExistingConfiguration() {
        val hub = WebAudioHub(); val voice = Any(); val owner = Any()
        hub.beginEncoded(owner, format); val reader = hub.subscribe()
        val initialEpoch = epoch(requireNotNull(reader.take(10)))
        hub.publishEncoded(owner, byteArrayOf(1), 1.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        assertTrue(hub.voiceRoute(voice, "connected", true))
        assertEquals(5, requireNotNull(reader.take(10))[5].toInt())
        assertEquals(false, hub.voiceStatus()["muted"])
        hub.publishEncoded(owner, byteArrayOf(2), 2.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        for (value in 1..2) {
            val packet = requireNotNull(reader.take(10))
            assertEquals(7, packet[4].toInt()); assertEquals(value, packet[36].toInt())
            assertEquals(initialEpoch, epoch(packet))
        }
        assertTrue(hub.voiceRoute(voice, "idle", false))
        assertEquals(5, requireNotNull(reader.take(10))[5].toInt())
        hub.publishEncoded(owner, byteArrayOf(3), 3.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        val packet = requireNotNull(reader.take(10))
        assertEquals(7, packet[4].toInt()); assertEquals(3, packet[36].toInt())
        assertEquals(initialEpoch, epoch(packet)); assertNull(reader.take(1))
    }

    @Test fun independentCarPlayStreamsRetainIdsModesConfigurationsAndStopMetadata() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner)
        val reader = hub.subscribe()
        for (id in 0..4) {
            hub.beginEncodedStream(owner, id, format)
            val config = requireNotNull(reader.take(10))
            assertEquals(6, config[4].toInt()); assertEquals(id, config[5].toInt())
            assertEquals(2, config[7].toInt())
        }
        for (id in 0..4) hub.publishEncoded(owner, byteArrayOf(id.toByte()), 1.0, id = id)
        for (id in 0..4) {
            val packet = requireNotNull(reader.take(10))
            assertEquals(7, packet[4].toInt()); assertEquals(id, packet[5].toInt())
            assertEquals(0, packet[7].toInt())
        }
        hub.endEncodedStream(owner, 2)
        val ended = requireNotNull(reader.take(10))
        assertEquals(2, ended[5].toInt()); assertEquals(2, ended[7].toInt())
        assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
        hub.publishEncoded(owner, byteArrayOf(99), 2.0, id = 2)
        assertNull(reader.take(1))
        hub.publishEncoded(owner, byteArrayOf(4), 3.0, id = 4)
        assertEquals(4, requireNotNull(reader.take(10))[5].toInt())
    }

    @Test fun oldLeaseCannotReconfigureFlushPublishOrEndItsReplacementStream() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        val old = hub.publication(owner)
        hub.beginEncodedStream(owner, 1, format, publication = old); reader.take(10)
        hub.publishEncoded(owner, byteArrayOf(99), 1.0, id = 1, publication = old)
        old.close()
        val current = hub.publication(owner)
        hub.beginEncodedStream(owner, 1, format.copy(codec = "aac-lc"), publication = current)
        val config = requireNotNull(reader.take(10)); val newEpoch = epoch(config)
        hub.beginEncodedStream(owner, 1, format, publication = old)
        hub.flushEncoded(owner, 1, old)
        hub.publishEncoded(owner, byteArrayOf(99), 2.0, id = 1, publication = old)
        hub.endEncodedStream(owner, 1, old)
        assertNull(reader.take(1))
        hub.publishEncoded(owner, byteArrayOf(3), 3.0, id = 1, publication = current)
        val packet = requireNotNull(reader.take(10))
        assertEquals(newEpoch, epoch(packet)); assertEquals(3, packet[36].toInt())
    }

    @Test fun bufferedConfigurationAlwaysPrecedesItsPacketsWhileNavigationOvertakesMusic() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        hub.beginEncodedStream(owner, 0, format, buffered = true)
        repeat(8) { hub.publishEncoded(owner, byteArrayOf(it.toByte()), it.toDouble(), buffered = true) }
        hub.beginEncodedStream(owner, 3, format.copy(codec = "opus", sampleRate = 48000))
        hub.publishEncoded(owner, byteArrayOf(42), 0.0, id = 3)
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        val navigation = records.filter { it[5].toInt() == 3 }
        assertEquals(listOf(6, 7), navigation.map { it[4].toInt() })
        assertEquals(epoch(navigation[0]), epoch(navigation[1]))
        assertEquals(42, navigation[1][36].toInt())
        val music = records.filter { it[5].toInt() == 0 }
        val config = music.first()
        assertEquals(6, config[4].toInt()); assertEquals(3, config[7].toInt())
        assertEquals(9, music.size)
        repeat(8) {
            val packet = music[it + 1]
            assertEquals(7, packet[4].toInt()); assertEquals(it, packet[36].toInt())
            assertEquals(epoch(config), epoch(packet)); assertEquals(1, packet[7].toInt())
        }
        assertTrue(records.indexOf(navigation[1]) < records.indexOf(music[1]))
        val reconnect = hub.subscribe()
        val replayed = listOf(requireNotNull(reconnect.take(10)), requireNotNull(reconnect.take(10)))
        assertEquals(setOf(0, 3), replayed.map { it[5].toInt() }.toSet())
        assertTrue(replayed.all { it[4].toInt() == 6 })
    }

    @Test fun retiringBlockedEncodedMusicDoesNotBlockNavigationOrLeakOldAacIntoReplacement() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        val old = hub.publication(owner)
        hub.beginEncodedStream(owner, 0, format, publication = old, buffered = true)
        repeat(16) { hub.publishEncoded(owner, byteArrayOf(99), it.toDouble(), buffered = true, publication = old) }
        val producer = Thread { hub.publishEncoded(owner, byteArrayOf(99), 99.0, buffered = true, publication = old) }
        producer.start()
        try {
            assertTrue(awaitWaiting(producer))
            hub.beginEncodedStream(owner, 3, format)
            hub.publishEncoded(owner, byteArrayOf(42), 0.0, id = 3)
            val beforeMusic = takeThrough(reader) { it[4].toInt() == 7 && it[5].toInt() == 3 }
            val navigation = beforeMusic.filter { it[5].toInt() == 3 }
            assertEquals(listOf(6, 7), navigation.map { it[4].toInt() })
            assertEquals(epoch(navigation[0]), epoch(navigation[1]))
            assertEquals(42, navigation[1][36].toInt())
            assertTrue(beforeMusic.none { it[4].toInt() == 7 && it[5].toInt() == 0 })
            old.close(); producer.join(500)
            assertFalse(producer.isAlive); assertFalse(reader.closed)
            val current = hub.publication(owner)
            hub.beginEncodedStream(owner, 0, format, publication = current, buffered = true)
            hub.publishEncoded(owner, byteArrayOf(7), 1.0, buffered = true, publication = current)
            assertEquals(6, requireNotNull(reader.take(10))[4].toInt())
            assertEquals(7, requireNotNull(reader.take(10))[36].toInt())
            assertNull(reader.take(1))
        } finally { old.close(); producer.interrupt(); producer.join(1000); reader.close() }
    }

    @Test fun flushCancelsBlockedMusicWithTheSameLeaseAndNoStaleAccessUnitSurvives() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        val lease = hub.publication(owner)
        hub.beginEncodedStream(owner, 0, format, publication = lease, buffered = true)
        val oldEpoch = epoch(requireNotNull(reader.take(10)))
        repeat(16) { hub.publishEncoded(owner, byteArrayOf(99), it.toDouble(), buffered = true, publication = lease) }
        val producer = Thread { hub.publishEncoded(owner, byteArrayOf(99), 99.0, buffered = true, publication = lease) }
        producer.start()
        try {
            assertTrue(awaitWaiting(producer))
            hub.flushEncoded(owner, publication = lease)
            producer.join(500); assertFalse(producer.isAlive); assertFalse(reader.closed)
            val config = requireNotNull(reader.take(10))
            assertEquals(6, config[4].toInt()); assertTrue(epoch(config) != oldEpoch)
            assertNull(reader.take(1))
        } finally { lease.close(); producer.interrupt(); producer.join(1000); reader.close() }
    }

    @Test fun liveOverrunRestoresEveryAffectedCodecAndNeverDiscardsBufferedMusic() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        hub.beginEncodedStream(owner, 0, format, buffered = true)
        hub.publishEncoded(owner, byteArrayOf(11), 1.0, buffered = true)
        hub.beginEncodedStream(owner, 1, format)
        hub.beginEncodedStream(owner, 3, format)
        repeat(WebAudioHub.MAX_REALTIME_PACKETS + 8) { hub.publishEncoded(owner, byteArrayOf(42), it.toDouble(), id = 3) }
        hub.publishEncoded(owner, byteArrayOf(1), 50.0, id = 1)
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        val voice = records.filter { it[5].toInt() == 1 }
        assertEquals(6, voice[0][4].toInt()); assertEquals(7, voice[1][4].toInt())
        assertEquals(epoch(voice[0]), epoch(voice[1]))
        val music = records.filter { it[5].toInt() == 0 }
        assertEquals(6, music[0][4].toInt()); assertEquals(11, music[1][36].toInt())
    }

    @Test fun stalledBufferedReaderIsRetiredInsteadOfDroppingAnyMusicPacket() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        hub.beginEncodedStream(owner, 0, format, buffered = true)
        repeat(16) { hub.publishEncoded(owner, byteArrayOf(it.toByte()), it.toDouble(), buffered = true) }
        assertFalse(reader.closed)
        hub.publishEncoded(owner, byteArrayOf(99), 99.0, buffered = true)
        assertTrue(reader.closed); assertNull(reader.take(1))
    }

    @Test fun stoppedMetadataSurvivesLeaseCloseAndIsRetiredByNewStreamRegistration() {
        val hub = WebAudioHub(); val owner = Any(); hub.begin(owner); val reader = hub.subscribe()
        val lease = hub.publication(owner)
        hub.beginEncodedStream(owner, 0, format, publication = lease, buffered = true); reader.take(10)
        hub.publishEncoded(owner, byteArrayOf(99), 1.0, buffered = true, publication = lease)
        hub.endEncodedStream(owner, 0, lease); lease.close()
        val ended = requireNotNull(reader.take(10))
        assertEquals(6, ended[4].toInt()); assertEquals(3, ended[7].toInt())
        assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
        assertNull(reader.take(1))
        val next = hub.publication(owner)
        hub.beginEncodedStream(owner, 0, format, publication = next, buffered = true)
        hub.endEncodedStream(owner, 0, next)
        val replacement = hub.publication(owner)
        hub.beginEncodedStream(owner, 0, format, publication = replacement, buffered = true)
        val config = requireNotNull(reader.take(10))
        assertFalse(String(config.copyOfRange(28, config.size)).contains("ended"))
        assertNull(reader.take(1))
    }

    @Test fun scoTransitionsPreserveQueuedMusicAndIndependentEncodedStreamEpochs() {
        val hub = WebAudioHub(); val owner = Any(); val voice = Any()
        hub.begin(owner); val reader = hub.subscribe()
        hub.beginEncodedStream(owner, 0, format, buffered = true)
        hub.beginEncodedStream(owner, 3, format)
        val configs = listOf(requireNotNull(reader.take(10)), requireNotNull(reader.take(10)))
        hub.publishEncoded(owner, byteArrayOf(1), 1.0, buffered = true)
        assertTrue(hub.voiceRoute(voice, "connected", true))
        assertEquals(5, requireNotNull(reader.take(10))[5].toInt())
        hub.publishEncoded(owner, byteArrayOf(2), 2.0, buffered = true)
        hub.publishEncoded(owner, byteArrayOf(3), 2.0, id = 3)
        val duringDemand = List(3) { requireNotNull(reader.take(10)) }
        assertTrue(duringDemand.all { it[4].toInt() == 7 })
        assertEquals(listOf(1, 2), duringDemand.filter { it[5].toInt() == 0 }.map { it[36].toInt() })
        assertEquals(3, duringDemand.single { it[5].toInt() == 3 }[36].toInt())
        for (packet in duringDemand) assertEquals(epoch(configs.single { it[5] == packet[5] }), epoch(packet))
        assertNull(reader.take(1))
        assertTrue(hub.voiceRoute(voice, "idle", false))
        assertEquals(5, requireNotNull(reader.take(10))[5].toInt())
        hub.publishEncoded(owner, byteArrayOf(7), 3.0, buffered = true)
        hub.publishEncoded(owner, byteArrayOf(3), 3.0, id = 3)
        val afterRelease = List(2) { requireNotNull(reader.take(10)) }
        assertEquals(setOf(0, 3), afterRelease.map { it[5].toInt() }.toSet())
        for (packet in afterRelease) {
            assertEquals(7, packet[4].toInt())
            assertEquals(epoch(configs.single { it[5] == packet[5] }), epoch(packet))
        }
        assertEquals(7, afterRelease.single { it[5].toInt() == 0 }[36].toInt())
        assertEquals(3, afterRelease.single { it[5].toInt() == 3 }[36].toInt())
        assertNull(reader.take(1))
    }

    @Test fun mirrorEndKeepsCarPlayCodecsMusicAndGuidanceAlive() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); val reader = hub.subscribe()
        hub.beginEncodedStream(carPlay, 0, format, buffered = true)
        hub.publishEncoded(carPlay, byteArrayOf(10), 0.0, buffered = true)
        hub.beginEncodedStream(carPlay, 3, format)
        hub.publishEncoded(carPlay, byteArrayOf(20), 0.0, id = 3)
        hub.beginEncoded(mirror, format)
        hub.publishEncoded(mirror, byteArrayOf(30), 0.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        hub.endMirror(mirror)
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        val ended = records.single { it[5].toInt() == 6 }
        assertEquals(6, ended[4].toInt())
        assertTrue(String(ended.copyOfRange(28, ended.size)).contains("\"ended\":true"))
        for ((id, value) in listOf(3 to 20, 0 to 10)) {
            val stream = records.filter { it[5].toInt() == id }
            assertEquals(listOf(6, 7), stream.map { it[4].toInt() })
            assertEquals(value, stream[1][36].toInt()); assertEquals(epoch(stream[0]), epoch(stream[1]))
        }
        hub.publishEncoded(carPlay, byteArrayOf(40), 1.0, buffered = true)
        assertEquals(40, requireNotNull(reader.take(10))[36].toInt())
    }

    @Test fun mirrorOverrunRestoresItsCodecWithoutDiscardingCarPlayGuidanceOrMusic() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); val reader = hub.subscribe()
        hub.beginEncodedStream(carPlay, 0, format, buffered = true)
        hub.publishEncoded(carPlay, byteArrayOf(10), 0.0, buffered = true)
        hub.beginEncodedStream(carPlay, 3, format)
        hub.publishEncoded(carPlay, byteArrayOf(20), 0.0, id = 3)
        hub.beginEncoded(mirror, format)
        repeat(100) { hub.publishEncoded(mirror, byteArrayOf(it.toByte()), it.toDouble(), id = WebAudioHub.AIRPLAY_MIRROR_STREAM) }
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        val guidance = records.filter { it[5].toInt() == 3 }
        assertEquals(listOf(6, 7), guidance.map { it[4].toInt() })
        assertEquals(20, guidance[1][36].toInt()); assertEquals(epoch(guidance[0]), epoch(guidance[1]))
        val mirrors = records.filter { it[5].toInt() == WebAudioHub.AIRPLAY_MIRROR_STREAM }
        assertTrue(mirrors.size <= WebAudioHub.MAX_REALTIME_PACKETS + 1); assertEquals(6, mirrors.first()[4].toInt())
        assertTrue(mirrors.drop(1).all { it[4].toInt() == 7 && epoch(it) == epoch(mirrors.first()) })
        assertEquals(99, mirrors.last()[36].toInt())
        val music = records.filter { it[5].toInt() == 0 }
        assertEquals(listOf(6, 7), music.map { it[4].toInt() })
        assertEquals(10, music[1][36].toInt()); assertEquals(epoch(music[0]), epoch(music[1]))
        assertTrue(records.indexOf(guidance[1]) < records.indexOf(music[1]))
    }

    @Test fun carPlayBeginAndEndPreserveAnExistingMirrorCodecAndItsQueuedPackets() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.beginEncoded(mirror, format); val reader = hub.subscribe()
        hub.publishEncoded(mirror, byteArrayOf(30), 0.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        hub.begin(carPlay)
        hub.beginEncodedStream(carPlay, 0, format, buffered = true)
        hub.publishEncoded(carPlay, byteArrayOf(99), 0.0, buffered = true)
        hub.end(carPlay)
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        val mirrors = records.filter { it[5].toInt() == WebAudioHub.AIRPLAY_MIRROR_STREAM }
        assertEquals(listOf(6, 7), mirrors.map { it[4].toInt() })
        assertFalse(String(mirrors.first().copyOfRange(28, mirrors.first().size)).contains("ended"))
        assertEquals(30, mirrors.last()[36].toInt())
        assertTrue(records.none { it[4].toInt() == 7 && it[5].toInt() == 0 })
        hub.publishEncoded(mirror, byteArrayOf(40), 1.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        assertEquals(40, requireNotNull(reader.take(10))[36].toInt())
    }

    @Test fun carPlaySettingRetiresOnlyCarPlayEncodedAudioAndReplaysItsCodecWhenEnabled() {
        val hub = WebAudioHub(); val carPlay = Any(); val mirror = Any()
        hub.begin(carPlay); val reader = hub.subscribe()
        hub.beginEncodedStream(carPlay, 0, format, buffered = true)
        hub.publishEncoded(carPlay, byteArrayOf(10), 0.0, buffered = true)
        hub.beginEncoded(mirror, format)
        hub.publishEncoded(mirror, byteArrayOf(30), 0.0, id = WebAudioHub.AIRPLAY_MIRROR_STREAM)
        hub.carPlayEnabled = false
        val records = buildList { while (true) add(reader.take(1) ?: break) }
        assertFalse(reader.closed)
        assertTrue(records.none { it[4].toInt() == 7 && it[5].toInt() == 0 })
        assertEquals(30, records.single { it[4].toInt() == 7 }[36].toInt())
        hub.publishEncoded(carPlay, byteArrayOf(99), 1.0, buffered = true)
        assertNull(reader.take(1))
        hub.carPlayEnabled = true
        while (reader.take(1) != null) {}
        hub.publishEncoded(carPlay, byteArrayOf(40), 2.0, buffered = true)
        assertEquals(6, requireNotNull(reader.take(10))[4].toInt())
        assertEquals(40, requireNotNull(reader.take(10))[36].toInt())
    }

    private fun takeThrough(reader: WebAudioHub.Subscription, matches: (ByteArray) -> Boolean): List<ByteArray> {
        val records = mutableListOf<ByteArray>()
        repeat(32) {
            val packet = requireNotNull(reader.take(100))
            records += packet
            if (matches(packet)) return records
        }
        error("Expected encoded audio record was not delivered")
    }

    private fun awaitWaiting(thread: Thread): Boolean {
        val deadline = System.nanoTime() + 500_000_000L
        while (System.nanoTime() < deadline) {
            if (thread.state == Thread.State.TIMED_WAITING) return true
            Thread.sleep(1)
        }
        return false
    }

}
