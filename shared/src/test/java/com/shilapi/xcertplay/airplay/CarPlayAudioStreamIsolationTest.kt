package com.shilapi.xcertplay.airplay

import java.io.Closeable
import java.net.Socket
import java.net.InetSocketAddress
import java.net.SocketAddress
import java.security.SecureRandom
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class CarPlayAudioStreamIsolationTest {
    @Test fun siriMicrophoneStartsAtSetupWithoutWaitingForDownlinkAndStopsOnSessionClose() {
        val events = mutableListOf<String>()
        val engine = CarPlayMediaEngine(object : MediaSink, BrowserBufferedAudioPolicy {
            override fun onMicrophoneStarted(id: AudioStreamId, config: MicrophoneConfig) {
                events += "start"
                assertEquals(5000, config.port)
                assertEquals(AudioCodecKind.OPUS, config.codec)
                assertEquals(480, config.rtpSamplesPerPacket)
            }
            override fun onMicrophoneStopped(id: AudioStreamId) { events += "stop" }
        }, microphoneEnabled = true)
        val session = session()
        try {
            assertNotNull(engine.onAudio(session, 100, mapOf(
                "audioType" to "speechrecognition", "audioFormat" to 0x20000000L,
                "streamConnectionID" to 42L, "dataPort" to 5000L,
            )))
            assertEquals(listOf("start"), events)
            engine.onSessionClosed(session)
            assertEquals(listOf("start", "stop"), events)
        } finally {
            engine.onSessionClosed(session)
            session.close()
        }
    }

    @Test fun guidanceSetupAndMediaReplacementKeepTheOtherAudioStreamAlive() {
        val session = session()
        val engine = CarPlayMediaEngine(object : MediaSink, BrowserBufferedAudioPolicy {})
        try {
            assertNotNull(engine.onAudio(session, 100, setup("media")))
            val streams = streams(engine)
            val mediaKey = CarPlayMediaEngine.StreamKey(session, 100, "media")
            val firstMedia = streams[mediaKey]
            assertNotNull(engine.onAudio(session, 100, setup("default")))
            val guidanceKey = CarPlayMediaEngine.StreamKey(session, 100, "default")
            val guidance = streams[guidanceKey]
            assertSame(firstMedia, streams[mediaKey])
            assertEquals(2, streams.size)
            assertNotNull(engine.onAudio(session, 100, setup("MEDIA")))
            assertNotSame(firstMedia, streams[mediaKey])
            assertSame(guidance, streams[guidanceKey])
            assertEquals(2, streams.size)
        } finally {
            engine.onSessionClosed(session)
            session.close()
        }
    }

    @Test fun typeTeardownClosesEveryVariantButKeepsOtherTypes() {
        val stopped = mutableListOf<AudioStreamId>()
        val engine = CarPlayMediaEngine(object : MediaSink, BrowserBufferedAudioPolicy {
            override fun onAudioStopped(id: AudioStreamId) { stopped.add(id) }
        })
        val session = session()
        try {
            assertNotNull(engine.onAudio(session, 100, setup("media")))
            assertNotNull(engine.onAudio(session, 100, setup("default")))
            assertNotNull(engine.onAudio(session, 102, setup("media")))
            stopped.clear()
            engine.onTeardown(session, 100)
            assertEquals(setOf(AudioStreamId(100, "media"), AudioStreamId(100, "default")), stopped.toSet())
            assertEquals(setOf(CarPlayMediaEngine.StreamKey(session, 102, "media")), streams(engine).keys)
        } finally {
            engine.onSessionClosed(session)
            session.close()
        }
    }

    @Test fun oldSessionTeardownAndCloseCannotStopItsSuccessorsAudio() {
        val stopped = mutableListOf<AudioStreamId>()
        val engine = CarPlayMediaEngine(object : MediaSink, BrowserBufferedAudioPolicy {
            override fun onAudioStopped(id: AudioStreamId) { stopped += id }
        })
        val first = session(); val second = session()
        try {
            engine.onAudio(first, 102, setup("media"))
            engine.onAudio(second, 102, setup("media"))
            stopped.clear()
            engine.onTeardown(first, 102)
            engine.onSessionClosed(first)
            assertTrue(stopped.isEmpty())
            assertNotNull(engine.onFeedback(second))
            assertEquals(setOf(CarPlayMediaEngine.StreamKey(second, 102, "media")), streams(engine).keys)
            engine.onSessionClosed(second)
            assertEquals(listOf(AudioStreamId(102, "media")), stopped)
        } finally {
            engine.onSessionClosed(first); engine.onSessionClosed(second)
            first.close(); second.close()
        }
    }

    @Test fun feedbackAndCleanupStayWithinTheRequestingSessionIncludingProbeClose() {
        val engine = CarPlayMediaEngine(object : MediaSink, BrowserBufferedAudioPolicy {})
        val first = session(); val second = session(); val probe = session()
        try {
            engine.onAudio(first, 100, setup("media"))
            engine.onAudio(second, 101, setup("default"))
            fun feedbackTypes(session: AirPlaySession): List<Int> =
                (engine.onFeedback(session)?.get("streams") as? List<*>).orEmpty().map {
                    ((it as Map<*, *>)["type"] as Number).toInt()
                }
            assertEquals(listOf(100), feedbackTypes(first))
            assertEquals(listOf(101), feedbackTypes(second))
            assertNull(engine.onFeedback(probe))
            engine.onSessionClosed(probe)
            assertEquals(listOf(100), feedbackTypes(first))
            assertEquals(listOf(101), feedbackTypes(second))
            engine.onSessionClosed(first)
            assertEquals(listOf(101), feedbackTypes(second))
        } finally {
            engine.onSessionClosed(first); engine.onSessionClosed(second); engine.onSessionClosed(probe)
            first.close(); second.close(); probe.close()
        }
    }

    private fun setup(audioType: String): Map<String, Any?> = mapOf(
        "audioType" to audioType,
        "audioFormat" to 0x8000L,
        "streamConnectionID" to 42L,
    )

    @Suppress("UNCHECKED_CAST")
    private fun streams(engine: CarPlayMediaEngine): MutableMap<CarPlayMediaEngine.StreamKey, Closeable> =
        CarPlayMediaEngine::class.java.getDeclaredField("streams").apply { isAccessible = true }
            .get(engine) as MutableMap<CarPlayMediaEngine.StreamKey, Closeable>

    private fun session(): AirPlaySession {
        val session = AirPlaySession(
            socket = object : Socket() {
                override fun getRemoteSocketAddress(): SocketAddress = InetSocketAddress("127.0.0.1", 5001)
            },
            config = AirPlayConfig(
                deviceName = "test", deviceId = "02:00:00:00:00:02", btMac = "02:00:00:00:00:01",
                sourceVersion = "1.0", main = AirPlayDisplayConfig(widthPixels = 800, heightPixels = 480),
            ),
            identity = AirPlayIdentity.generate(), pairings = PairingStore(), mfi = null,
            listener = object : AirPlaySessionListener {}, media = object : AirPlayMediaHandler {},
        )
        val secret = ByteArray(32).also(SecureRandom()::nextBytes)
        session.pairVerify.javaClass.getDeclaredField("sharedSecret").apply { isAccessible = true }
            .set(session.pairVerify, secret)
        return session
    }
}
