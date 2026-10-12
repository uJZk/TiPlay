package com.shilapi.xcertplay

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.receiver.ReceiverAvc
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.media.MediaCodecSupport
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean

/** Decode MP4/HLS on Android, encode to H.264 and publish through the existing canvas transport. */
@OptIn(UnstableApi::class)
internal class AirPlayCastPlayer(private val context: Context, private val resource: (String) -> ReceiverResource?,
                                private val stateChanged: (String) -> Unit) : Closeable {
    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var video: EncodedVideo? = null
    private var generation = 0L
    private var closed = false
    @Volatile var state = ReceiverPlayback()
        private set

    fun play(item: ReceiverPlay) = main.post {
        if (closed) return@post
        stopNow()
        val token = generation
        try {
            val next = EncodedVideo { main.post { if (generation == token) fail() } }
            video = next
            val http = DefaultHttpDataSource.Factory().setConnectTimeoutMs(5000).setReadTimeoutMs(10_000)
            val data = DataSource.Factory { AirPlayVideoDataSource(http.createDataSource(), resource) }
            val exo = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(data)).build()
            player = exo
            exo.volume = 0f // browser product does not take over the car's audio route
            exo.setVideoSurface(next.surface)
            exo.setVideoScalingMode(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT)
            var initialSeekDone = false
            exo.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (generation != token) return
                    if (playbackState == Player.STATE_READY && !initialSeekDone) {
                        initialSeekDone = true
                        val seconds = if (item.fraction && exo.duration > 0) item.start.coerceAtMost(1.0) * exo.duration / 1000.0 else item.start
                        if (seconds > 0) exo.seekTo((seconds * 1000).toLong())
                    }
                    update()
                    stateChanged(when (playbackState) {
                        Player.STATE_ENDED -> "stopped"
                        Player.STATE_BUFFERING -> "loading"
                        else -> if (exo.isPlaying) "playing" else "paused"
                    })
                }
                override fun onIsPlayingChanged(isPlaying: Boolean) { if (generation == token) { update(); stateChanged(if (isPlaying) "playing" else "paused") } }
                override fun onPlayerError(error: PlaybackException) { if (generation == token) fail() }
            })
            exo.setMediaItem(MediaItem.fromUri(item.url))
            exo.prepare(); exo.play()
            poll(token)
        } catch (_: Exception) { fail() }
    }

    private fun poll(token: Long) {
        if (closed || token != generation) return
        update()
        main.postDelayed({ poll(token) }, 250)
    }

    private fun update() {
        val current = player ?: return
        state = ReceiverPlayback(
            duration = (current.duration.coerceAtLeast(0) / 1000.0),
            position = current.currentPosition.coerceAtLeast(0) / 1000.0,
            rate = if (current.isPlaying) 1.0 else 0.0,
            ready = current.playbackState == Player.STATE_READY,
            buffering = current.playbackState == Player.STATE_BUFFERING,
        )
    }

    fun seek(seconds: Double) = main.post { if (!closed) { player?.seekTo((seconds * 1000).toLong()); update() } }
    fun rate(value: Double) = main.post { if (!closed) { if (value == 0.0) player?.pause() else player?.play(); update() } }
    fun stop() = main.post { stopNow() }
    private fun fail() { stopNow(); stateChanged("failed") }
    private fun stopNow() {
        generation++
        player?.release(); player = null
        video?.close(); video = null
        state = ReceiverPlayback()
    }
    override fun close() {
        if (Looper.myLooper() == main.looper) { closed = true; stopNow() }
        else main.post { closed = true; stopNow() }
    }

    private class EncodedVideo(private val failed: () -> Unit) : Closeable {
        private val stopped = AtomicBoolean(false)
        private val sink = WebMediaSink(TeslaBrowserLink.hub, 1280, 720, 30)
        private val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val surface: android.view.Surface
        private val thread: Thread

        init {
            try {
                val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1280, 720).apply {
                    setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                    setInteger(MediaFormat.KEY_BIT_RATE, 6_000_000)
                    setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                }
                encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                surface = encoder.createInputSurface()
                encoder.start()
            } catch (error: Exception) { encoder.release(); sink.close(); throw error }
            sink.setVideoRecoveryHandler(110) {
                if (!stopped.get()) runCatching {
                    encoder.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
                }
            }
            sink.onScreenStreamActive(110, true)
            thread = Thread(::drain, "tiplay-airplay-cast-encoder").apply { isDaemon = true; start() }
        }

        private fun drain() {
            val info = MediaCodec.BufferInfo()
            try {
                while (!stopped.get()) {
                    val index = encoder.dequeueOutputBuffer(info, 20_000)
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val format = encoder.outputFormat
                        val buffers = listOfNotNull(format.getByteBuffer("csd-0"), format.getByteBuffer("csd-1"))
                            .map { buffer -> ByteArray(buffer.remaining()).also { buffer.duplicate().get(it) } }
                        sink.onVideoCodec(110, VideoCodec.H264)
                        sink.onVideoConfig(110, ReceiverAvc.record(*buffers.toTypedArray()))
                    } else if (index >= 0) {
                        try {
                            val buffer = encoder.getOutputBuffer(index)
                            if (buffer != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                                buffer.position(info.offset); buffer.limit(info.offset + info.size)
                                val bytes = ByteArray(info.size); buffer.get(bytes)
                                val annexB = if (bytes.size >= 4 && bytes[0] == 0.toByte() && bytes[1] == 0.toByte() &&
                                    (bytes[2] == 1.toByte() || (bytes[2] == 0.toByte() && bytes[3] == 1.toByte()))) bytes
                                    else MediaCodecSupport.toAnnexB(bytes)
                                if (annexB.isNotEmpty()) sink.onVideoFrame(110, annexB)
                            }
                        } finally { encoder.releaseOutputBuffer(index, false) }
                    }
                }
            } catch (_: Exception) { if (!stopped.get()) failed() }
            finally {
                sink.close()
                runCatching { encoder.stop() }; encoder.release(); surface.release()
            }
        }

        override fun close() {
            if (!stopped.compareAndSet(false, true)) return
            sink.close()
            // Drain owns codec release; no cross-thread stop during dequeueOutputBuffer.
            thread.interrupt()
        }
    }
}
