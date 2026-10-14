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
                val packet = ByteBuffer.wrap(requireNotNull(reader.take(1000)))
                assertEquals(48000, packet.getInt(8))
                assertEquals(2000.0, packet.getDouble(20), 0.001)
            } finally { sink.close(); reader.close() }
        }
    }

    @Test fun replacingADecoderBlockedOnMusicCapacityRetiresItsPendingResetWithoutClosingTheReader() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val reader = hub.subscribe()
        val id = AudioStreamId(103, "media")
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, id.type, id.audioType)
        try {
            repeat(16) { hub.publish(sink, 0, 16000, 1, byteArrayOf(it.toByte(), 0), buffered = true) }
            sink.onAudioStarted(id, format, 0)
            val old = decoderThread(sink, id)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 99), 0)
            awaitMusicWait(old)
            val replacement = java.util.concurrent.CompletableFuture.runAsync { sink.onAudioStarted(id, format, 0) }
            replacement.get(500, java.util.concurrent.TimeUnit.MILLISECONDS)
            old.join(500)
            assertFalse("Retired decoder must leave its full-buffer wait", old.isAlive)
            repeat(16) { assertEquals(it, reader.take(100)!![28].toInt()) }
            assertNull(reader.take(20))
            assertFalse(reader.closed)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 77), 0)
            val fresh = reader.take(1000)!!
            assertEquals(77, fresh[28].toInt())
            assertEquals(2, fresh[7].toInt() and 2)
            val epoch = ByteBuffer.wrap(fresh).getInt(16)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 78), 1)
            val next = reader.take(1000)!!
            assertEquals(78, next[28].toInt())
            assertEquals(epoch, ByteBuffer.wrap(next).getInt(16))
            assertEquals(0, next[7].toInt() and 2)
        } finally { sink.close(); reader.close() }
    }

    @Test fun pausingAFullMusicDecoderReturnsPromptlyAndResumeStartsOnlyFreshPcm() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val reader = hub.subscribe()
        val id = AudioStreamId(103, "media")
        val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, id.type, id.audioType)
        try {
            repeat(16) { hub.publish(sink, 0, 16000, 1, byteArrayOf(1, 0), buffered = true) }
            sink.onAudioStarted(id, format, 0)
            val old = decoderThread(sink, id)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 99), 0)
            awaitMusicWait(old)
            java.util.concurrent.CompletableFuture.runAsync { sink.pauseAudio() }
                .get(500, java.util.concurrent.TimeUnit.MILLISECONDS)
            old.join(500)
            assertFalse(old.isAlive)
            sink.resumeAudio()
            while (reader.take(10) != null) Unit
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0, 42), 0)
            val fresh = reader.take(1000)!!
            assertEquals(42, fresh[28].toInt())
            assertEquals(2, fresh[7].toInt() and 2)
            assertNull(reader.take(20))
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

    @Test fun pcmIsConvertedForTheBrowserAndStopClearsPlayback() {
        val hub = WebAudioHub()
        val sink = BrowserAudioMediaSink(object : MediaSink {}, hub)
        val subscription = hub.subscribe()
        try {
            val id = AudioStreamId(100, "telephony")
            val format = AudioFormat(AudioCodecKind.LPCM, 16000, 1, 100, "telephony")
            sink.onAudioStarted(id, format, 0)
            sink.onAudioClock(id, 0, 1_000_000_000L)
            sink.onAudioRtp(id, format, ByteArray(12) + byteArrayOf(0x12, 0x34, 0x56, 0x78), 0)
            val packet = subscription.take(1000)!!
            assertEquals(2, packet[5].toInt())
            assertEquals(2, packet[7].toInt() and 2)
            assertEquals(2, packet[4].toInt())
            assertEquals(1000.0, ByteBuffer.wrap(packet).order(ByteOrder.BIG_ENDIAN).getDouble(20), 0.0)
            assertArrayEquals(byteArrayOf(0x34, 0x12, 0x78, 0x56), packet.copyOfRange(28, packet.size))
            sink.onAudioStopped(id)
            val stopped = subscription.take(1000)!!
            assertEquals(28, stopped.size)
            assertEquals(2, stopped[7].toInt() and 2)
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
    private fun pcm(reader: WebAudioHub.Subscription): ByteArray? {
        val until = System.nanoTime() + 1_000_000_000L
        while (System.nanoTime() < until) {
            val packet = reader.take(10) ?: continue
            if (packet.size > 28) return packet
        }
        return null
    }
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
            assertArrayEquals(byteArrayOf(2, 0), pcm(reader)!!.let { it.copyOfRange(28, it.size) })
            assertNull(pcm(reader))
            voice.ready()
            for (id in listOf(call, AudioStreamId(100, "speechrecognition"), AudioStreamId(100, "default"),
                AudioStreamId(100, "navigation"))) packet(sink, id, 3)
            awaitAudio(voice, 4)
            assertTrue(voice.audio.all { BluetoothVoicePolicy.allowed(it.first) })
            packet(sink, AudioStreamId(100, "alert"), 6)
            packet(sink, AudioStreamId(102, "compatibility"), 7)
            val browserValues = List(2) { pcm(reader)!![28].toInt() }.toSet()
            assertEquals(setOf(6, 7), browserValues)
            val mirror = Any(); hub.beginMirror(mirror)
            hub.publish(mirror, WebAudioHub.AIRPLAY_MIRROR_STREAM, 44100, 1, byteArrayOf(8, 0),
                mode = com.shilapi.xcertplay.web.BrowserPlaybackMode.AIRPLAY_MIRROR)
            assertEquals(8, pcm(reader)!![28].toInt())
            assertNull(pcm(reader))
            sink.onMicrophoneStopped(call)
            assertEquals("releasing", hub.voiceStatus()["state"])
            assertEquals(false, hub.voiceStatus()["muted"])
            packet(sink, call, 99)
            packet(sink, media, 4)
            assertEquals(4, pcm(reader)!![28].toInt())
            assertNull(pcm(reader))
            voice.released()
            assertEquals(false, hub.voiceStatus()["muted"])
            packet(sink, media, 5)
            val fresh = pcm(reader)!!
            assertArrayEquals(byteArrayOf(5, 0), fresh.copyOfRange(28, fresh.size))
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
            repeat(16) { hub.publish(sink, 0, 16000, 1, byteArrayOf(it.toByte(), 0), buffered = true) }
            sink.onAudioRtp(media, format, ByteArray(12) + byteArrayOf(0, 99), 1)
            awaitMusicWait(worker)
            sink.onMicrophoneStarted(call, config("telephony"))
            voice.ready()
            sink.onMicrophoneStopped(call)
            voice.released()
            assertSame(worker, decoderThread(sink, media))
            assertTrue(worker.isAlive)
            repeat(16) {
                val queued = pcm(reader)!!
                assertEquals(it, queued[28].toInt())
                assertEquals(epoch, ByteBuffer.wrap(queued).getInt(16))
            }
            val pending = pcm(reader)!!
            assertEquals(99, pending[28].toInt())
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
                    assertEquals(it, music[28].toInt())
                    assertEquals(if (it == 0) 2 else 0, music[7].toInt() and 2)
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
            assertEquals(7, pcm(reader)!![28].toInt())
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
