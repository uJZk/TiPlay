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
            assertArrayEquals(byteArrayOf(5, 0), fresh.copyOfRange(28, fresh.size))
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
