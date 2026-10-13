package com.shilapi.xcertplay

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import com.shilapi.xcertplay.web.WebAudioHub
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.ByteBuffer
import java.io.ByteArrayInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class AirPlayBrowserAudioSinkTest {
    private val format = Format.Builder().setSampleMimeType(MimeTypes.AUDIO_RAW)
        .setPcmEncoding(C.ENCODING_PCM_16BIT).setSampleRate(48000).setChannelCount(2).build()

    @Test fun hlsManifestCapabilityProbeDoesNotDiscardAudioBeforeItsSampleRateIsKnown() {
        val sink = AirPlayBrowserAudioSink(WebAudioHub())
        val master = "#EXTM3U\n" +
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"Default\",DEFAULT=YES,URI=\"audio.m3u8\"\n" +
            "#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS=\"avc1.64001f,mp4a.40.2\",AUDIO=\"audio\"\nvideo.m3u8\n"
        val playlist = HlsPlaylistParser().parse(Uri.parse("mlhls://fixture/master.m3u8"),
            ByteArrayInputStream(master.toByteArray())) as HlsMultivariantPlaylist
        val manifestAudio = playlist.audios.single().format
        assertEquals(Format.NO_VALUE, manifestAudio.sampleRate)
        assertEquals(Format.NO_VALUE, manifestAudio.channelCount)
        // MediaCodecAudioRenderer probes this anticipated output before opening audio segments.
        val manifestPcm = Util.getPcmFormat(C.ENCODING_PCM_16BIT, manifestAudio.channelCount, manifestAudio.sampleRate)
        assertEquals(AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY, sink.getFormatSupport(manifestPcm))
        assertTrue(sink.supportsFormat(format.buildUpon().setSampleRate(Format.NO_VALUE).build()))
        assertThrows(AudioSink.ConfigurationException::class.java) { sink.configure(manifestPcm, 0, null) }
        sink.configure(format, 0, null)
        sink.reset()
    }

    @Test fun unsupportedConcretePcmFormatsAreStillRejected() {
        val sink = AirPlayBrowserAudioSink(WebAudioHub())
        for (unsupported in listOf(format.buildUpon().setChannelCount(6).build(),
            format.buildUpon().setSampleRate(192000).build(),
            format.buildUpon().setPcmEncoding(C.ENCODING_PCM_FLOAT).build())) {
            assertEquals(AudioSink.SINK_FORMAT_UNSUPPORTED, sink.getFormatSupport(unsupported))
            assertThrows(AudioSink.ConfigurationException::class.java) { sink.configure(unsupported, 0, null) }
        }
    }

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
