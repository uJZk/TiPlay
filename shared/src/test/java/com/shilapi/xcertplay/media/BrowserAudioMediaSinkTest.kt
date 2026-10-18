package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.web.WebAudioHub
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserAudioMediaSinkTest {
    @Test fun concurrentGuidanceWithTheSamePurposeKeepsSeparateTransportAndSurvivesOneEnd() {
        val hub = WebAudioHub(); val sink = BrowserAudioMediaSink(object : MediaSink {}, hub); val reader = hub.subscribe()
        val first = AudioStreamId(100, "navigation"); val second = AudioStreamId(101, "default")
        val format = AudioFormat(AudioCodecKind.LPCM, 48000, 1, 100, "navigation")
        fun offer(id: AudioStreamId, sequence: Int, value: Int) {
            val packet = ByteArray(12) + byteArrayOf(0, value.toByte()); packet[3] = sequence.toByte()
            sink.onAudioRtp(id, format, packet, sequence * 960)
        }
        try {
            sink.onAudioStarted(first, format, 0); sink.onAudioStarted(second, format, 0)
            val configurations = List(2) { requireNotNull(reader.take(1000)) }
            assertEquals(setOf(1, 7), configurations.map { it[5].toInt() and 255 }.toSet())
            assertTrue(configurations.all { String(it.copyOfRange(28, it.size)).contains("\"semanticType\":1") })
            offer(first, 0, 11); offer(second, 0, 22)
            val packets = List(2) { requireNotNull(pcm(reader)) }
            assertEquals(setOf(1, 7), packets.map { it[5].toInt() and 255 }.toSet())
            assertEquals(setOf(11, 22), packets.map(::sampleValue).toSet())
            sink.onAudioStopped(second)
            val ended = requireNotNull(reader.take(1000)); assertEquals(7, ended[5].toInt())
            offer(first, 1, 33)
            assertEquals(33, sampleValue(requireNotNull(pcm(reader))))
            sink.onAudioStarted(second, format, 0)
            assertEquals(7, requireNotNull(reader.take(1000))[5].toInt())
            offer(second, 0, 44); assertEquals(44, sampleValue(requireNotNull(pcm(reader))))
        } finally { sink.close(); reader.close() }
    }

    @Test fun exhaustedTransportSlotsRejectOnlyTheNewStreamAndReleasedSlotsCanBeReused() {
        val hub = WebAudioHub(); val sink = BrowserAudioMediaSink(object : MediaSink {}, hub); val reader = hub.subscribe()
        val current = AudioStreamId(100, "default"); val candidate = AudioStreamId(999, "navigation")
        val format = AudioFormat(AudioCodecKind.LPCM, 48000, 1, 100, "default")
        @Suppress("UNCHECKED_CAST")
        val slots = BrowserAudioMediaSink::class.java.getDeclaredField("transportIds").apply { isAccessible = true }
            .get(sink) as MutableMap<AudioStreamId, Int>
        try {
            sink.onAudioStarted(current, format, 0); reader.take(1000)
            // Fill bookkeeping without starting hundreds of audio workers.
            for (slot in (0..4) + (7..255)) if (slot != 1) slots[AudioStreamId(1000 + slot, "navigation")] = slot
            sink.onAudioStarted(candidate, format, 0)
            assertFalse(slots.containsKey(candidate)); assertEquals(254, slots.size)
            sink.onAudioRtp(current, format, ByteArray(12) + byteArrayOf(0, 55), 0)
            assertEquals(55, sampleValue(requireNotNull(pcm(reader))))
            sink.onAudioStopped(AudioStreamId(1007, "navigation"))
            sink.onAudioStarted(candidate, format, 0)
            assertEquals(7, slots[candidate]); assertEquals(7, requireNotNull(reader.take(1000))[5].toInt())
        } finally { sink.close(); reader.close() }
    }

    @Test fun idleAacAndOpusForwardTheirAccessUnitsWithoutCreatingAndroidCodecs() {
        val hub = WebAudioHub()
        val codecCreations = java.util.concurrent.atomic.AtomicInteger()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub, decoderFactory = {
            codecCreations.incrementAndGet()
            error("Android decoding must not be used by idle playback")
        })
        val reader = hub.subscribe()
        try {
            for (kind in listOf(AudioCodecKind.AAC_LC, AudioCodecKind.OPUS)) {
                val id = AudioStreamId(100, "media")
                val format = AudioFormat(kind, 48000, 1, 100, "media", rtpClockRate = 16000)
                sink.onAudioStarted(id, format, 0)
                val config = requireNotNull(reader.take(1000))
                assertEquals(6, config[4].toInt())
                assertTrue(String(config.copyOfRange(28, config.size)).contains(
                    "\"codec\":\"${if (kind == AudioCodecKind.OPUS) "opus" else "aac-lc"}\""))
                val raw = byteArrayOf(9, 8, 7, 6)
                sink.onAudioRtp(id, format, ByteArray(12) + raw, 16000)
                val packet = requireNotNull(pcm(reader))
                assertArrayEquals(raw, packet.copyOfRange(36, packet.size))
                assertEquals(1_000_000.0, ByteBuffer.wrap(packet).getDouble(28), 0.0)
                assertEquals(0, codecCreations.get())
            }
        } finally { sink.close(); reader.close() }
    }

    @Test fun androidCodecCreationIsLimitedToAllowedStreamsDuringActiveMicrophoneDemand() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val codecCreations = java.util.concurrent.atomic.AtomicInteger()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } },
            decoderFactory = { codecCreations.incrementAndGet(); error("Injected codec factory") })
        val media = AudioStreamId(103, "media"); val call = AudioStreamId(100, "telephony")
        fun start(id: AudioStreamId) = sink.onAudioStarted(id, AudioFormat(AudioCodecKind.AAC_LC, 48000, 1, id.type, id.audioType), 0)
        try {
            start(media)
            sink.onMicrophoneStarted(call, config("telephony"))
            start(call)
            assertEquals(0, codecCreations.get())
            voice.ready()
            val deadline = System.nanoTime() + 1_000_000_000L
            while (codecCreations.get() == 0 && System.nanoTime() < deadline) Thread.sleep(1)
            assertEquals(1, codecCreations.get())
            start(AudioStreamId(100, "alert"))
            sink.onMicrophoneStopped(call); voice.released()
            start(media)
            Thread.sleep(20)
            assertEquals(1, codecCreations.get())
        } finally { sink.close(); voice.released() }
    }

    @Test fun presentationUsesTheRtpClockWhilePcmKeepsItsDecodeSampleRate() {
        for (clock in listOf(16000, 24000, 48000)) {
            val hub = WebAudioHub()
            val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
            val reader = hub.subscribe()
            val id = AudioStreamId(100, "media")
            val format = AudioFormat(AudioCodecKind.LPCM, 48000, 1, id.type, id.audioType, rtpClockRate = clock)
            try {
                sink.onAudioStarted(id, format, 100)
                sink.onAudioClock(id, 100, 1_000_000_000L)
                sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 1), 100 + clock)
                val packet = ByteBuffer.wrap(requireNotNull(pcm(reader)))
                assertEquals(48000, packet.getInt(8))
                assertEquals(2000.0, packet.getDouble(20), 0.001)
            } finally { sink.close(); reader.close() }
        }
    }

    @Test fun scoMarksRtpGapsForSmoothingWithoutMistakingRateConversionOrWrapForLoss() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val id = AudioStreamId(100, "telephony")
        val format = AudioFormat(AudioCodecKind.LPCM, 48000, 1, 100, "telephony", rtpClockRate = 16000)
        try {
            sink.onMicrophoneStarted(id, config("telephony")); voice.ready()
            sink.onAudioStarted(id, format, -256)
            // Each packet decodes to 480 frames: exactly 160 RTP ticks, including across uint32 wrap.
            for ((sequence, sample) in listOf(-256, -96, 64, 384).withIndex()) {
                val packet = ByteArray(12 + 480 * 2)
                packet[3] = sequence.toByte()
                sink.onAudioRtp(id, format, packet, sample)
            }
            awaitAudio(voice, 4)
            assertEquals(listOf(false, false, false, true), voice.discontinuities)
        } finally { sink.close(); voice.released() }
    }

    @Test fun scoRejectsOldAnchoredSpeechAndCarriesTheFreshDeadlineToPlayback() {
        val now = java.util.concurrent.atomic.AtomicLong(1_000_000_000L)
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } }, nowNanos = now::get)
        val id = AudioStreamId(100, "telephony")
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, 100, "telephony")
        fun offer(sequence: Int, sample: Int, value: Int) {
            val packet = ByteArray(12 + 320 * 2)
            packet[3] = sequence.toByte()
            for (at in 12 until packet.size step 2) { packet[at] = 0; packet[at + 1] = value.toByte() }
            sink.onAudioRtp(id, format, packet, sample)
        }
        try {
            sink.onMicrophoneStarted(id, config("telephony")); voice.ready()
            sink.onAudioStarted(id, format, 0)
            sink.onAudioClock(id, 0, 0L)
            offer(0, 0, 99) // Entire packet expired before arrival.
            offer(1, 16000, 11)
            awaitAudio(voice, 1)
            assertEquals(1_125_000_000L, voice.deadlines.single())
            now.set(2_000_000_000L)
            offer(2, 16320, 88)
            offer(3, 32000, 33)
            awaitAudio(voice, 2)
            assertEquals(listOf(11, 33), voice.audio.map { it.second[0].toInt() and 255 })
            assertEquals(listOf(false, true), voice.discontinuities)
            assertEquals(2_125_000_000L, voice.deadlines.last())
        } finally { sink.close(); voice.released() }
    }

    @Test fun speechFinishingAfterACodecStallIsDroppedBeforeFreshOutputResumes() {
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val calls = java.util.concurrent.atomic.AtomicInteger()
        val codec = object : org.robolectric.shadows.ShadowMediaCodec.CodecConfig.Codec {
            override fun process(input: ByteBuffer, output: ByteBuffer) {
                val first = calls.getAndIncrement() == 0
                if (first) { entered.countDown(); check(release.await(5, java.util.concurrent.TimeUnit.SECONDS)) }
                input.position(input.limit())
                repeat(960) { output.put((if (first) 99 else 33).toByte()); output.put(0) }
            }
        }
        org.robolectric.shadows.ShadowMediaCodec.addDecoder(android.media.MediaFormat.MIMETYPE_AUDIO_OPUS,
            org.robolectric.shadows.ShadowMediaCodec.CodecConfig(65536, 65536, codec))
        val now = java.util.concurrent.atomic.AtomicLong(1_000_000_000L)
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } }, nowNanos = now::get)
        val id = AudioStreamId(100, "telephony")
        val format = AudioFormat(AudioCodecKind.OPUS, 48000, 1, 100, "telephony", 16000)
        fun offer(sequence: Int, sample: Int) {
            val packet = ByteArray(12) + byteArrayOf((19 shl 3).toByte(), 0)
            packet[3] = sequence.toByte()
            sink.onAudioRtp(id, format, packet, sample)
        }
        try {
            sink.onMicrophoneStarted(id, config("telephony")); voice.ready()
            sink.onAudioStarted(id, format, 0); sink.onAudioClock(id, 0, now.get())
            offer(0, 0)
            assertTrue("Decoder entered the real MediaCodec queue/drain path", entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            now.set(1_400_000_000L)
            offer(1, 6400)
            release.countDown()
            awaitAudio(voice, 1)
            assertEquals(33, voice.audio.single().second[0].toInt() and 255)
            assertEquals(1_525_000_000L, voice.deadlines.single())
        } finally {
            release.countDown(); sink.close(); voice.released()
            org.robolectric.shadows.ShadowMediaCodec.clearCodecs()
        }
    }

    @Test fun replacingAnEncodedMusicWorkerRetiresItsBlockedOldPacketWithoutClosingTheReader() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val reader = hub.subscribe()
        val id = AudioStreamId(103, "media")
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, id.type, id.audioType)
        try {
            sink.onAudioStarted(id, format, 0)
            assertEquals(6, reader.take(1000)!![4].toInt())
            // Fill through the producer so every queued packet has its real retirement lease.
            repeat(16) { sample ->
                sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, sample.toByte()), sample)
            }
            val old = decoderThread(sink, id)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 99), 0)
            awaitMusicWait(old)
            java.util.concurrent.CompletableFuture.runAsync { sink.onAudioStarted(id, format, 0) }
                .get(500, java.util.concurrent.TimeUnit.MILLISECONDS)
            old.join(500)
            assertFalse("Retired worker must leave its full-buffer wait", old.isAlive)
            val config = reader.take(1000)!!
            assertEquals(6, config[4].toInt())
            assertFalse(reader.closed)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 77), 0)
            val fresh = pcm(reader)!!
            assertArrayEquals(byteArrayOf(0, 77), fresh.copyOfRange(36, fresh.size))
            assertEquals(1, fresh[7].toInt() and 1)
            assertEquals(ByteBuffer.wrap(config).getInt(16), ByteBuffer.wrap(fresh).getInt(16))
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 78), 1)
            val next = pcm(reader)!!
            assertArrayEquals(byteArrayOf(0, 78), next.copyOfRange(36, next.size))
            assertEquals(ByteBuffer.wrap(fresh).getInt(16), ByteBuffer.wrap(next).getInt(16))
        } finally { sink.close(); reader.close() }
    }

    @Test fun pausingAFullMusicWorkerReturnsPromptlyAndResumeForwardsOnlyFreshAccessUnits() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val reader = hub.subscribe()
        val id = AudioStreamId(103, "media")
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, id.type, id.audioType)
        try {
            sink.onAudioStarted(id, format, 0)
            assertEquals(6, reader.take(1000)!![4].toInt())
            repeat(16) { hub.publish(sink, 0, 16000, 1, byteArrayOf(1, 0), buffered = true) }
            val old = decoderThread(sink, id)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 99), 0)
            awaitMusicWait(old)
            java.util.concurrent.CompletableFuture.runAsync { sink.pauseAudio() }
                .get(500, java.util.concurrent.TimeUnit.MILLISECONDS)
            old.join(500)
            assertFalse(old.isAlive)
            sink.resumeAudio()
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 42), 0)
            val fresh = pcm(reader)!!
            assertArrayEquals(byteArrayOf(0, 42), fresh.copyOfRange(36, fresh.size))
            assertNull(pcm(reader, 20))
            assertFalse(reader.closed)
        } finally { sink.close(); reader.close() }
    }

    private fun decoderThread(sink: BrowserAudioMediaSink, id: AudioStreamId): Thread {
        val renderers = BrowserAudioMediaSink::class.java.getDeclaredField("renderers").apply { isAccessible = true }
            .get(sink) as Map<*, *>
        val decoder = requireNotNull(renderers[id])
        return decoder.javaClass.getDeclaredField("thread").apply { isAccessible = true }.get(decoder) as Thread
    }

    private fun awaitMusicWait(thread: Thread) {
        val deadline = System.nanoTime() + 2_000_000_000L
        while (System.nanoTime() < deadline) {
            val stack = thread.stackTrace
            if (stack.any { it.className == "java.util.concurrent.ArrayBlockingQueue" && it.methodName == "offer" } &&
                stack.any { it.className == "com.shilapi.xcertplay.web.WebAudioHub\$Subscription" }) return
            Thread.sleep(1)
        }
        fail("Decoder did not enter buffered publication backpressure")
    }

    @Test fun aNewPausedCarPlaySinkDoesNotTakeAudioFromAirPlay() {
        val hub = WebAudioHub()
        val airPlay = Any()
        hub.begin(airPlay)
        val subscription = hub.subscribe()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub, initiallyPaused = true)
        try {
            hub.publish(airPlay, 0, 48000, 2, byteArrayOf(1, 0, 2, 0))
            assertNotNull(subscription.take(1000))
            sink.close()
            hub.publish(airPlay, 0, 48000, 2, byteArrayOf(3, 0, 4, 0))
            assertNotNull(subscription.take(1000))
        } finally { sink.close(); subscription.close() }
    }

    @Test fun pcmIsForwardedUnchangedForBrowserConversionAndStopClearsPlayback() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val subscription = hub.subscribe()
        try {
            val id = AudioStreamId(100, "telephony")
            val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, 100, "telephony")
            sink.onAudioStarted(id, format, 0)
            sink.onAudioClock(id, 0, 1_000_000_000L)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0x12, 0x34, 0x56, 0x78), 0)
            val packet = pcm(subscription)!!
            assertEquals(2, packet[5].toInt())
            assertEquals(7, packet[4].toInt())
            assertEquals(1000.0, ByteBuffer.wrap(packet).order(ByteOrder.BIG_ENDIAN).getDouble(20), 0.0)
            assertArrayEquals(byteArrayOf(0x12, 0x34, 0x56, 0x78), packet.copyOfRange(36, packet.size))
            sink.onAudioStopped(id)
            val stopped = subscription.take(1000)!!
            assertEquals(6, stopped[4].toInt())
            assertTrue(String(stopped.copyOfRange(28, stopped.size)).contains("\"ended\":true"))
            sink.onAudioRtp(id, format, ByteArray(14), 0)
            assertNull(subscription.take(30))
        } finally { sink.close(); subscription.close() }
    }

    private class Voice(private val callback: (BluetoothVoiceState) -> Unit) : BluetoothVoiceChannel {
        val starts = mutableListOf<MicrophoneConfig>()
        val audio = java.util.concurrent.CopyOnWriteArrayList<Pair<AudioStreamId, ByteArray>>()
        val discontinuities = java.util.concurrent.CopyOnWriteArrayList<Boolean>()
        val deadlines = java.util.concurrent.CopyOnWriteArrayList<Long>()
        var stops = 0; var closes = 0
        override fun start(config: MicrophoneConfig) { starts += config }
        override fun stop() { stops++ }
        override fun close() { closes++ }
        override fun play(id: AudioStreamId, sampleRate: Int, channels: Int, pcm: ByteArray, discontinuity: Boolean, deadlineNanos: Long) {
            discontinuities += discontinuity
            deadlines += deadlineNanos
            audio += id to pcm
        }
        override fun clear(id: AudioStreamId) {}
        fun ready() { callback(BluetoothVoiceState("active")) }
        fun released() { callback(BluetoothVoiceState("idle", released = true)) }
        fun failed() { callback(BluetoothVoiceState("failed", "car-bluetooth-unavailable", released = true)) }
    }
    private fun config(type: String) = MicrophoneConfig(type, 16000, 1, 97, 20,
        InetAddress.getLoopbackAddress(), 12345, ByteArray(32))
    private fun packet(sink: BrowserAudioMediaSink, id: AudioStreamId, value: Int) {
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, id.type, id.audioType)
        sink.onAudioStarted(id, format, 0)
        sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, value.toByte()), 0)
    }
    private fun pcm(reader: WebAudioHub.Subscription, timeoutMillis: Long = 1000): ByteArray? {
        val until = System.nanoTime() + timeoutMillis * 1_000_000L
        while (System.nanoTime() < until) {
            val packet = reader.take(10) ?: continue
            if ((packet[4].toInt() == 2 && packet.size > 28) || packet[4].toInt() == 7) return packet
        }
        return null
    }
    private fun sampleValue(packet: ByteArray): Int =
        packet[if (packet[4].toInt() == 7) 37 else 28].toInt() and 255
    private fun awaitAudio(voice: Voice, count: Int) {
        val until = System.nanoTime() + 1_000_000_000L
        while (voice.audio.size < count && System.nanoTime() < until) Thread.sleep(5)
        assertEquals(count, voice.audio.size)
    }

    @Test fun demandKeepsMusicPromptsAndMirrorInBrowserWhileSpeechUsesOnlyBluetooth() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val reader = hub.subscribe()
        val media = AudioStreamId(103, "media"); val call = AudioStreamId(100, "telephony")
        try {
            packet(sink, media, 1); assertNotNull(pcm(reader))
            sink.onMicrophoneStarted(call, config("telephony"))
            assertEquals(false, hub.voiceStatus()["muted"])
            packet(sink, call, 99)
            packet(sink, media, 2)
            assertEquals(2, sampleValue(pcm(reader)!!))
            assertNull(pcm(reader))
            voice.ready()
            for (id in listOf(call, AudioStreamId(100, "speechrecognition"), AudioStreamId(100, "default"),
                AudioStreamId(100, "navigation"))) packet(sink, id, 3)
            awaitAudio(voice, 4)
            assertTrue(voice.audio.all { BluetoothVoicePolicy.allowed(it.first) })
            packet(sink, AudioStreamId(100, "alert"), 6)
            packet(sink, AudioStreamId(102, "compatibility"), 7)
            val browserValues = List(2) { sampleValue(pcm(reader)!!) }.toSet()
            assertEquals(setOf(6, 7), browserValues)
            val mirror = Any(); hub.beginMirror(mirror)
            hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(8, 0),
                mode = com.shilapi.xcertplay.web.BrowserPlaybackMode.AIRPLAY_MIRROR)
            assertEquals(8, sampleValue(pcm(reader)!!))
            assertNull(pcm(reader))
            sink.onMicrophoneStopped(call)
            assertEquals("releasing", hub.voiceStatus()["state"])
            assertEquals(false, hub.voiceStatus()["muted"])
            packet(sink, call, 99)
            packet(sink, media, 4)
            assertEquals(4, sampleValue(pcm(reader)!!))
            assertNull(pcm(reader))
            voice.released()
            assertEquals(false, hub.voiceStatus()["muted"])
            packet(sink, media, 5)
            val fresh = pcm(reader)!!
            assertArrayEquals(byteArrayOf(0, 5), fresh.copyOfRange(36, fresh.size))
        } finally { sink.close(); voice.released(); reader.close() }
    }

    @Test fun microphoneTransitionsKeepTheMusicDecoderItsPendingPublicationAndStreamEpoch() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val reader = hub.subscribe()
        val media = AudioStreamId(103, "media"); val call = AudioStreamId(100, "telephony")
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, media.type, media.audioType)
        try {
            sink.onAudioStarted(media, format, 0)
            sink.onAudioRtp(media, format, ByteArray(12) + byteArrayOf(0, 1), 0)
            val epoch = ByteBuffer.wrap(pcm(reader)!!).getInt(16)
            val worker = decoderThread(sink, media)
            repeat(16) { sample ->
                sink.onAudioRtp(media, format, ByteArray(12) + byteArrayOf(0, sample.toByte()), sample + 1)
            }
            sink.onAudioRtp(media, format, ByteArray(12) + byteArrayOf(0, 99), 17)
            awaitMusicWait(worker)
            sink.onMicrophoneStarted(call, config("telephony"))
            voice.ready()
            sink.onMicrophoneStopped(call)
            voice.released()
            assertSame(worker, decoderThread(sink, media))
            assertTrue(worker.isAlive)
            repeat(16) {
                val queued = pcm(reader)!!
                assertEquals(it, sampleValue(queued))
                assertEquals(epoch, ByteBuffer.wrap(queued).getInt(16))
            }
            val pending = pcm(reader)!!
            assertEquals(99, sampleValue(pending))
            assertEquals(epoch, ByteBuffer.wrap(pending).getInt(16))
            assertEquals(0, pending[7].toInt() and 2)
            assertFalse(reader.closed)
        } finally { sink.close(); voice.released(); reader.close() }
    }

    @Test fun microphoneSpeechResetsPreserveAFullRealtimeMusicQueueIncludingCompatibilityAudio() {
        for (media in listOf(AudioStreamId(100, "media"), AudioStreamId(102, "default"), AudioStreamId(102, "compatibility"))) {
            val hub = WebAudioHub(); lateinit var voice: Voice
            val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
                voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
            val reader = hub.subscribe()
            val call = AudioStreamId(100, "telephony")
            val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, media.type, media.audioType)
            try {
                packet(sink, AudioStreamId(100, "navigation"), 77)
                assertEquals(1, pcm(reader)!![5].toInt())
                sink.onAudioStarted(media, format, 0)
                val configuration = requireNotNull(reader.take(1000))
                assertEquals(6, configuration[4].toInt())
                val musicEpoch = ByteBuffer.wrap(configuration).getInt(16)
                val worker = decoderThread(sink, media)
                repeat(16) { sequence ->
                    val rtp = ByteArray(12) + byteArrayOf(0, sequence.toByte())
                    rtp[3] = sequence.toByte()
                    sink.onAudioRtp(media, format, rtp, sequence)
                }
                val live = reader.javaClass.getDeclaredField("live").apply { isAccessible = true }
                    .get(reader) as java.util.concurrent.BlockingQueue<*>
                val deadline = System.nanoTime() + 1_000_000_000L
                while (live.size < 16 && System.nanoTime() < deadline) Thread.sleep(1)
                assertEquals(16, live.size)
                sink.onMicrophoneStarted(call, config("telephony"))
                voice.ready()
                sink.onMicrophoneStopped(call)
                voice.released()
                assertSame(worker, decoderThread(sink, media))
                repeat(16) {
                    val music = pcm(reader)!!
                    assertEquals(0, music[5].toInt())
                    assertEquals(it, sampleValue(music))
                    assertEquals(musicEpoch, ByteBuffer.wrap(music).getInt(16))
                    assertEquals(0, music[7].toInt() and 2)
                }
                assertNull(pcm(reader))
                assertFalse(reader.closed)
            } finally { sink.close(); voice.released(); reader.close() }
        }
    }

    @Test fun overlappingDemandsGiveCallsPriorityAndEndingOneDoesNotReleaseTheOther() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val assistant = AudioStreamId(100, "speechrecognition"); val call = AudioStreamId(100, "telephony")
        try {
            sink.onMicrophoneStarted(assistant, config("speechrecognition"))
            sink.onMicrophoneStarted(call, config("telephony"))
            assertEquals(listOf("speechrecognition", "telephony"), voice.starts.map { it.audioType })
            sink.onMicrophoneStopped(AudioStreamId(101, "telephony"))
            assertEquals(0, voice.stops)
            sink.onMicrophoneStopped(call)
            assertEquals("speechrecognition", voice.starts.last().audioType)
            assertEquals(0, voice.stops)
            sink.onMicrophoneStopped(assistant)
            assertEquals(1, voice.stops)
            voice.released()
            assertEquals(false, hub.voiceStatus()["muted"])
        } finally { sink.close(); voice.released() }
    }

    @Test fun pausedDisplayDefersCaptureAndTeardownCannotStealTheNextAudioOwner() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub, initiallyPaused = true,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val call = AudioStreamId(100, "telephony")
        sink.onMicrophoneStarted(call, config("telephony"))
        assertEquals(false, hub.voiceStatus()["muted"])
        sink.resumeAudio(); voice.ready()
        sink.pauseAudio()
        val airPlay = Any(); hub.begin(airPlay); val reader = hub.subscribe()
        hub.publish(airPlay, 0, 48000, 1, byteArrayOf(7, 0))
        assertEquals(false, hub.voiceStatus()["muted"])
        assertArrayEquals(byteArrayOf(7, 0), pcm(reader)!!.let { it.copyOfRange(28, it.size) })
        voice.released()
        sink.close(); voice.released()
        hub.publish(airPlay, 0, 48000, 1, byteArrayOf(8, 0))
        assertArrayEquals(byteArrayOf(8, 0), pcm(reader)!!.let { it.copyOfRange(28, it.size) })
        reader.close()
    }

    @Test fun unavailableBluetoothKeepsMusicButNeverFallsBackToBrowserSpeechOrHandsetCapture() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val call = AudioStreamId(100, "telephony")
        val reader = hub.subscribe()
        try {
            sink.onMicrophoneStarted(call, config("telephony")); voice.failed()
            assertEquals("failed", hub.voiceStatus()["state"])
            assertEquals("car-bluetooth-unavailable", hub.voiceStatus()["error"])
            assertEquals(false, hub.voiceStatus()["muted"])
            assertFalse(hub.voiceRoute(Any(), "connecting", true))
            packet(sink, call, 99)
            packet(sink, AudioStreamId(103, "media"), 7)
            assertEquals(7, sampleValue(pcm(reader)!!))
            assertNull(pcm(reader))
            assertTrue(voice.audio.isEmpty())
            sink.onMicrophoneStopped(call); voice.released()
            assertEquals("idle", hub.voiceStatus()["state"])
        } finally { sink.close(); voice.released(); reader.close() }
    }

    @Test fun reconnectWaitsForTheRetiringTapToReallyReleaseBluetoothBeforeStartingCapture() {
        val hub = WebAudioHub(); lateinit var first: Voice; var second: Voice? = null
        val old = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { first = it } })
        val call = AudioStreamId(100, "telephony")
        old.onMicrophoneStarted(call, config("telephony")); first.ready(); old.close()
        val next = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { second = it } })
        try {
            next.onMicrophoneStarted(call, config("telephony"))
            assertNull(second)
            first.released()
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(100))
            assertNotNull(second)
            assertEquals(1, second!!.starts.size)
            second!!.ready()
            assertEquals("active", hub.voiceStatus()["state"])
            first.released()
            assertEquals("active", hub.voiceStatus()["state"])
        } finally { next.close(); second?.released() }
    }
}
