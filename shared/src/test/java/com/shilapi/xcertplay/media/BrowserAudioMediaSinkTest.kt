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
        var stops = 0; var closes = 0
        override fun start(config: MicrophoneConfig) { starts += config }
        override fun stop() { stops++ }
        override fun close() { closes++ }
        override fun play(id: AudioStreamId, sampleRate: Int, channels: Int, pcm: ByteArray) { audio += id to pcm }
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
    private fun awaitAudio(voice: Voice, count: Int) {
        val until = System.nanoTime() + 1_000_000_000L
        while (voice.audio.size < count && System.nanoTime() < until) Thread.sleep(5)
        assertEquals(count, voice.audio.size)
    }

    @Test fun demandGatesBrowserAndKeepsOnlyCallAssistantAndGuidanceUntilActualRelease() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val reader = hub.subscribe()
        val media = AudioStreamId(103, "media"); val call = AudioStreamId(100, "telephony")
        try {
            packet(sink, media, 1); assertNotNull(pcm(reader))
            sink.onMicrophoneStarted(call, config("telephony"))
            assertEquals(true, hub.voiceStatus()["muted"])
            packet(sink, media, 2)
            voice.ready()
            for (id in listOf(call, AudioStreamId(100, "speechrecognition"), AudioStreamId(100, "default"),
                AudioStreamId(100, "alert"), AudioStreamId(102, "compatibility"))) packet(sink, id, 3)
            awaitAudio(voice, 3)
            assertTrue(voice.audio.all { BluetoothVoicePolicy.allowed(it.first) })
            assertNull(reader.take(20)?.takeIf { it.size > 28 })
            sink.onMicrophoneStopped(call)
            assertEquals("releasing", hub.voiceStatus()["state"])
            assertEquals(true, hub.voiceStatus()["muted"])
            packet(sink, media, 4)
            voice.released()
            assertEquals(false, hub.voiceStatus()["muted"])
            packet(sink, media, 5)
            val fresh = pcm(reader)!!
            assertArrayEquals(byteArrayOf(0, 5), fresh.copyOfRange(36, fresh.size))
        } finally { sink.close(); voice.released(); reader.close() }
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
        assertEquals(true, hub.voiceStatus()["muted"])
        voice.released()
        sink.close(); voice.released()
        hub.publish(airPlay, 0, 48000, 1, byteArrayOf(8, 0))
        assertArrayEquals(byteArrayOf(8, 0), pcm(reader)!!.let { it.copyOfRange(28, it.size) })
        reader.close()
    }

    @Test fun unavailableBluetoothNeverActivatesBrowserOrHandsetCapture() {
        val hub = WebAudioHub(); lateinit var voice: Voice
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub,
            voiceFactory = BluetoothVoiceFactory { Voice(it).also { channel -> voice = channel } })
        val call = AudioStreamId(100, "telephony")
        sink.onMicrophoneStarted(call, config("telephony")); voice.failed()
        assertEquals("failed", hub.voiceStatus()["state"])
        assertEquals("car-bluetooth-unavailable", hub.voiceStatus()["error"])
        assertEquals(true, hub.voiceStatus()["muted"])
        sink.onMicrophoneStopped(call); voice.released()
        assertEquals(false, hub.voiceStatus()["muted"])
        sink.close(); voice.released()
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
        } finally { next.close(); second?.released() }
    }
}
