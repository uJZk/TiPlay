package com.shilapi.xcertplay

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import com.shilapi.xcertplay.web.WebAudioHub
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.ByteBuffer

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class AirPlayBrowserAudioSinkTest {
    private val format = Format.Builder().setSampleMimeType(MimeTypes.AUDIO_RAW)
        .setPcmEncoding(C.ENCODING_PCM_16BIT).setSampleRate(48000).setChannelCount(2).build()

    @Test fun largePcmBufferHasItsFullDurationAndAudioClockPacesTheDecoder() {
        var now = 0L
        val sink = AirPlayBrowserAudioSink(WebAudioHub()) { now }
        sink.configure(format, 0, null)
        sink.play()
        assertTrue(sink.handleBuffer(ByteBuffer.wrap(ByteArray(96_000)), 0, 1))
        now = 500_000_000
        assertEquals(500_000L, sink.getCurrentPositionUs(false))
        assertFalse(sink.handleBuffer(ByteBuffer.wrap(ByteArray(1920)), 600_000, 1))
        sink.playToEndOfStream()
        assertTrue(sink.isEnded())
        sink.reset()
    }

    @Test fun pauseImmediatelyFlushesQueuedBrowserAudioAndFreezesTheClock() {
        var now = 0L
        val hub = WebAudioHub()
        val sink = AirPlayBrowserAudioSink(hub) { now }
        sink.configure(format, 0, null)
        hub.subscribe().use { stream ->
            sink.play()
            sink.handleBuffer(ByteBuffer.wrap(ByteArray(1920)), 0, 1)
            now = 5_000_000
            sink.pause()
            val reset = requireNotNull(stream.take(20))
            assertEquals(20, reset.size)
            assertEquals(2, reset[7].toInt())
            now = 100_000_000
            assertEquals(5000L, sink.getCurrentPositionUs(false))
            sink.reset()
        }
    }
}
