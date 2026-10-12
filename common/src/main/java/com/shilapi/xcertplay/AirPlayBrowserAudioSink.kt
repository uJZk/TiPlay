package com.shilapi.xcertplay

import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.AuxEffectInfo
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import com.shilapi.xcertplay.web.WebAudioHub
import java.nio.ByteBuffer

/** Media3 PCM output with a monotonic media clock; never opens an Android audio device. */
@OptIn(UnstableApi::class)
internal class AirPlayBrowserAudioSink(private val hub: WebAudioHub,
                                       private val nowNanos: () -> Long = System::nanoTime) : AudioSink {
    private var format: Format? = null
    private var attributes = AudioAttributes.DEFAULT
    private var positionUs = AudioSink.CURRENT_POSITION_NOT_SET
    private var clockAt = 0L
    private var submittedUntilUs = 0L
    private var playing = false
    private var ended = false
    private var resetPacket = true
    private var ownsHub = false

    override fun setListener(listener: AudioSink.Listener) {}
    override fun supportsFormat(format: Format) = getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED
    override fun getFormatSupport(format: Format): Int = if (format.sampleMimeType == MimeTypes.AUDIO_RAW &&
        format.pcmEncoding == C.ENCODING_PCM_16BIT && format.channelCount in 1..2 &&
        format.sampleRate in 8000..96000) AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY else AudioSink.SINK_FORMAT_UNSUPPORTED

    override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
        if (!supportsFormat(inputFormat)) throw AudioSink.ConfigurationException("Browser needs stereo/mono PCM16", inputFormat)
        format = inputFormat
        flush()
        if (!ownsHub) { hub.enabled = true; hub.begin(this); ownsHub = true }
    }

    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        if (positionUs == AudioSink.CURRENT_POSITION_NOT_SET) return positionUs
        val elapsed = if (playing) (nowNanos() - clockAt) / 1000 else 0L
        return minOf(submittedUntilUs, positionUs + elapsed)
    }

    override fun play() {
        if (!playing) { positionUs = getCurrentPositionUs(false); clockAt = nowNanos(); playing = true }
    }
    override fun pause() {
        positionUs = getCurrentPositionUs(false); clockAt = nowNanos(); playing = false
        if (ownsHub) hub.flush(this, 0)
    }
    override fun handleDiscontinuity() {
        positionUs = AudioSink.CURRENT_POSITION_NOT_SET; resetPacket = true
        if (ownsHub) hub.flush(this, 0)
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        val output = format ?: return false
        if (positionUs == AudioSink.CURRENT_POSITION_NOT_SET) {
            positionUs = presentationTimeUs; submittedUntilUs = presentationTimeUs; clockAt = nowNanos()
        }
        // Keep Media3 from decoding the whole item into HTTP/browser queues at once.
        if (presentationTimeUs > getCurrentPositionUs(false) + 80_000) return false
        val frameBytes = output.channelCount * 2
        var frames = 0L
        while (buffer.hasRemaining()) {
            val size = minOf(buffer.remaining(), WebAudioHub.MAX_PCM) / frameBytes * frameBytes
            if (size == 0) { buffer.position(buffer.limit()); break }
            val pcm = ByteArray(size); buffer.get(pcm)
            hub.publish(this, 0, output.sampleRate, output.channelCount, pcm, reset = resetPacket)
            resetPacket = false
            frames += size / frameBytes
            submittedUntilUs = presentationTimeUs + frames * 1_000_000 / output.sampleRate
        }
        return true
    }

    override fun playToEndOfStream() { ended = true }
    override fun isEnded() = ended && !hasPendingData()
    override fun hasPendingData() = positionUs != AudioSink.CURRENT_POSITION_NOT_SET && getCurrentPositionUs(false) < submittedUntilUs
    override fun setPlaybackParameters(playbackParameters: PlaybackParameters) {}
    override fun getPlaybackParameters() = PlaybackParameters.DEFAULT
    override fun setSkipSilenceEnabled(skipSilenceEnabled: Boolean) {}
    override fun getSkipSilenceEnabled() = false
    override fun setAudioAttributes(audioAttributes: AudioAttributes) { attributes = audioAttributes }
    override fun getAudioAttributes() = attributes
    override fun setAudioSessionId(audioSessionId: Int) {}
    override fun setAuxEffectInfo(auxEffectInfo: AuxEffectInfo) {}
    override fun getAudioTrackBufferSizeUs() = 80_000L
    override fun enableTunnelingV21() {}
    override fun disableTunneling() {}
    override fun setVolume(volume: Float) {}
    override fun flush() {
        positionUs = AudioSink.CURRENT_POSITION_NOT_SET; submittedUntilUs = 0; ended = false; resetPacket = true
        if (ownsHub) hub.flush(this, 0)
    }
    override fun reset() {
        flush(); format = null
        if (ownsHub) { hub.end(this); ownsHub = false }
    }
    override fun release() = reset()
}
