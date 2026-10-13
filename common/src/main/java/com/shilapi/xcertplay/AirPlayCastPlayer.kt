package com.shilapi.xcertplay

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.C
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.DecoderCounters
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.receiver.ReceiverAvc
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.AirPlayBrowserPlayback
import com.shilapi.xcertplay.media.MediaCodecSupport
import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Decode MP4/HLS on Android, encode to H.264 and publish through the existing canvas transport. */
@OptIn(UnstableApi::class)
internal class AirPlayCastPlayer(private val context: Context, private val resource: (String) -> ReceiverResource?,
                                private val stateChanged: (String) -> Unit) : Closeable {
    private val main = Handler(Looper.getMainLooper())
    private val diagnostics = AirPlayVideoDiagnostics { Log.i("tiplay-airplay", it) }
    private var player: ExoPlayer? = null
    private var video: EncodedVideo? = null
    private var photoFrames: AirPlayPhotoFrames? = null
    private var generation = 0L
    private var closed = false
    private var requestedPlaying = true
    private var requestedSeek: Double? = null
    private var browserControls: Closeable? = null
    @Volatile private var seekable = false
    @Volatile var state = ReceiverPlayback()
        private set

    fun play(item: ReceiverPlay) = main.post {
        if (closed) return@post
        stopNow()
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.START)
        val token = generation
        browserControls = AirPlayBrowserPlayback.register(state = {
            val playback = state
            AirPlayBrowserPlayback.State(playback.duration, playback.position, playback.rate != 0.0,
                playback.ready, playback.buffering, seekable)
        }, control = { action, value -> main.post {
            if (!closed && generation == token) when (action) {
                "play" -> setPlaying(true)
                "pause" -> setPlaying(false)
                "seek" -> { requestedSeek = value; player?.seekTo((requireNotNull(value) * 1000).toLong()) }
                "stop" -> { stopNow(); stateChanged("stopped") }
            }
        } })
        try {
            video = EncodedVideo(diagnostics, ready = { surface -> main.post readyPost@ {
                if (closed || generation != token) return@readyPost
                try { startPlayer(item, token, surface) }
                catch (error: Exception) { diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, error); fail() }
            } }, failed = { error -> main.post {
                if (!closed && generation == token) { diagnostics.failure(AirPlayVideoDiagnostics.Stage.ENCODED_FRAME, error); fail() }
            } })
        } catch (error: Exception) { diagnostics.failure(AirPlayVideoDiagnostics.Stage.START, error); fail() }
    }

    fun photo(bytes: ByteArray) = main.post {
        if (closed) return@post
        stopNow()
        val token = generation
        browserControls = AirPlayBrowserPlayback.register(state = {
            AirPlayBrowserPlayback.State(0.0, 0.0, false, true, false, false, "photo")
        }, control = { action, _ -> if (action == "stop") main.post {
            if (!closed && generation == token) { stopNow(); stateChanged("stopped") }
        } })
        val failure: (Exception) -> Unit = { error -> main.post {
            if (!closed && generation == token) { diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, error); fail() }
        } }
        try {
            video = EncodedVideo(diagnostics, ready = { surface -> main.post {
                if (!closed && generation == token) photoFrames = AirPlayPhotoFrames(surface, bytes, failure)
            } }, failed = failure, timedVideo = false)
        } catch (error: Exception) { failure(error) }
    }

    private fun startPlayer(item: ReceiverPlay, token: Long, surface: android.view.Surface) {
        val next = video ?: return
        val http = DefaultHttpDataSource.Factory().setConnectTimeoutMs(5000).setReadTimeoutMs(10_000)
        val playlistDetected = AtomicBoolean(false)
        var hlsSourceSelected = false
        val data = DataSource.Factory {
            AirPlayVideoDataSource(http.createDataSource(), diagnostics, { playlistDetected.set(true) }, resource)
        }
        val audio = AirPlayBrowserAudioSink(TeslaBrowserLink.audioHub, diagnostics, timelineChanged = next::resetTimeline)
        val renderers = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(context: Context, enableFloatOutput: Boolean,
                                        enableAudioTrackPlaybackParams: Boolean): AudioSink =
                audio
        }
        val exo = ExoPlayer.Builder(context, renderers).setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(data)).build()
        player = exo
        exo.setVideoFrameMetadataListener { presentationTimeUs, releaseTimeNs, _, _ ->
            next.frameMetadata(presentationTimeUs, releaseTimeNs,
                audio.presentationTimeNanos(presentationTimeUs) ?: releaseTimeNs)
        }
        exo.setVideoSurface(surface)
        exo.setVideoScalingMode(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT)
        exo.addAnalyticsListener(object : AnalyticsListener {
            override fun onAudioCodecError(eventTime: AnalyticsListener.EventTime, audioCodecError: Exception) {
                if (generation == token) diagnostics.failure(AirPlayVideoDiagnostics.Stage.AUDIO_CODEC, audioCodecError)
            }
            override fun onVideoCodecError(eventTime: AnalyticsListener.EventTime, videoCodecError: Exception) {
                if (generation == token) diagnostics.failure(AirPlayVideoDiagnostics.Stage.VIDEO_CODEC, videoCodecError)
            }
            override fun onVideoDisabled(eventTime: AnalyticsListener.EventTime, decoderCounters: DecoderCounters) {
                // Release increments generation before renderer callbacks; counters still describe this player.
                diagnostics.decoded(decoderCounters.renderedOutputBufferCount,
                    decoderCounters.skippedOutputBufferCount, decoderCounters.droppedBufferCount)
            }
        })
        var initialSeekDone = false
        exo.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                if (generation == token) {
                    diagnostics.stage(AirPlayVideoDiagnostics.Stage.VIDEO_TRACKS,
                        tracks.groups.count { it.type == C.TRACK_TYPE_VIDEO && it.isSelected }.toLong())
                    diagnostics.stage(AirPlayVideoDiagnostics.Stage.AUDIO_TRACKS,
                        tracks.groups.count { it.type == C.TRACK_TYPE_AUDIO && it.isSelected }.toLong())
                }
            }
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (generation == token) {
                    diagnostics.videoSize(videoSize.width, videoSize.height)
                    next.setVideoSize(videoSize)
                }
            }
            override fun onRenderedFirstFrame() {
                if (generation == token) diagnostics.stage(AirPlayVideoDiagnostics.Stage.VIDEO_FIRST_FRAME)
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (generation != token) return
                diagnostics.stage(when (playbackState) {
                    Player.STATE_READY -> AirPlayVideoDiagnostics.Stage.READY
                    Player.STATE_ENDED -> AirPlayVideoDiagnostics.Stage.ENDED
                    else -> AirPlayVideoDiagnostics.Stage.BUFFERING
                })
                if (playbackState == Player.STATE_READY && !initialSeekDone) {
                    initialSeekDone = true
                    val seconds = requestedSeek ?: if (item.fraction && exo.duration > 0) item.start.coerceAtMost(1.0) * exo.duration / 1000.0 else item.start
                    if (seconds > 0) exo.seekTo((seconds * 1000).toLong())
                }
                update()
                stateChanged(when (playbackState) {
                    Player.STATE_ENDED -> "stopped"
                    Player.STATE_BUFFERING -> "loading"
                    else -> if (exo.isPlaying) "playing" else "paused"
                })
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (generation == token) {
                diagnostics.stage(if (isPlaying) AirPlayVideoDiagnostics.Stage.PLAYING else AirPlayVideoDiagnostics.Stage.PAUSED)
                update(); stateChanged(if (isPlaying) "playing" else "paused")
            } }
            override fun onPlayerError(error: PlaybackException) { if (generation == token) {
                // An app's opaque URL may select the progressive source before FCUP returns HLS.
                // Retry only a positively identified playlist, once, with the correct source type.
                if (error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED &&
                    playlistDetected.get() && !hlsSourceSelected) {
                    hlsSourceSelected = true
                    diagnostics.stage(AirPlayVideoDiagnostics.Stage.SOURCE_HLS)
                    exo.setMediaItem(MediaItem.Builder().setUri(item.url)
                        .setMimeType(MimeTypes.APPLICATION_M3U8).build())
                    exo.playWhenReady = requestedPlaying
                    exo.prepare()
                    return
                }
                diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, error, error.errorCode)
                // Cause types distinguish resource, DRM and codec failures without their messages.
                (error.cause as? Exception)?.let { diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, it) }
                fail()
            } }
        })
        exo.setMediaItem(MediaItem.fromUri(item.url))
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.PREPARE)
        exo.playWhenReady = requestedPlaying
        exo.prepare()
        poll(token)
    }

    private fun poll(token: Long) {
        if (closed || token != generation) return
        update()
        main.postDelayed({ poll(token) }, 250)
    }

    private fun update() {
        val current = player ?: return
        seekable = current.isCurrentMediaItemSeekable && current.duration > 0
        state = ReceiverPlayback(
            duration = (current.duration.coerceAtLeast(0) / 1000.0),
            position = current.currentPosition.coerceAtLeast(0) / 1000.0,
            rate = if (current.isPlaying) 1.0 else 0.0,
            ready = current.playbackState == Player.STATE_READY,
            buffering = current.playbackState == Player.STATE_BUFFERING,
        )
    }

    fun seek(seconds: Double) = main.post { if (!closed) {
        requestedSeek = seconds
        player?.seekTo((seconds * 1000).toLong()); update()
    } }
    fun rate(value: Double) = main.post { if (!closed) {
        setPlaying(value != 0.0); update()
    } }

    private fun setPlaying(playing: Boolean) {
        val current = player
        // Pause flushes the browser, including decoded PCM ahead of the Media3 clock.
        // Re-prime both renderers at that position so resume does not skip the discarded soundtrack.
        if (playing && !requestedPlaying && current != null) current.seekTo(current.currentPosition)
        requestedPlaying = playing
        current?.playWhenReady = playing
    }
    fun stop() = main.post { stopNow() }
    private fun fail() { stopNow(); stateChanged("failed") }
    private fun stopNow() {
        browserControls?.close(); browserControls = null
        seekable = false
        if (player != null || video != null) diagnostics.stage(AirPlayVideoDiagnostics.Stage.STOP)
        generation++
        photoFrames?.close(); photoFrames = null
        player?.release(); player = null
        video?.close(); video = null
        requestedPlaying = true; requestedSeek = null
        state = ReceiverPlayback()
    }
    override fun close() {
        if (Looper.myLooper() == main.looper) { closed = true; stopNow() }
        else main.post { closed = true; stopNow() }
    }

    private class EncodedVideo(private val diagnostics: AirPlayVideoDiagnostics,
                               ready: (android.view.Surface) -> Unit,
                               private val failed: (Exception) -> Unit,
                               private val timedVideo: Boolean = true) : Closeable {
        private val stopped = AtomicBoolean(false)
        private val closing = AtomicBoolean(false)
        private val sink = WebMediaSink(TeslaBrowserLink.hub, 1280, 720, 30,
            com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY,
            com.shilapi.xcertplay.web.BrowserPlaybackMode.AIRPLAY_VIDEO)
        private val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        private val surface: android.view.Surface
        private val bridge: AirPlayVideoSurfaceBridge
        private val thread: Thread
        private val frameTimes = AirPlayCastFrameTimes()
        private val timelineLock = Any()
        private val submittedTimes = linkedSetOf<Long>()
        private var configRecord: ByteArray? = null

        init {
            var allocatedSurface: android.view.Surface? = null
            try {
                val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1280, 720).apply {
                    setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                    setInteger(MediaFormat.KEY_BIT_RATE, 6_000_000)
                    setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                }
                encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                surface = encoder.createInputSurface().also { allocatedSurface = it }
                encoder.start()
                diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODER_READY)
            } catch (error: Exception) { allocatedSurface?.release(); encoder.release(); sink.close(); throw error }
            sink.setVideoRecoveryHandler(110) {
                if (!closing.get()) runCatching {
                    encoder.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
                }
            }
            sink.onScreenStreamActive(110, true)
            sink.setVideoClockHandler(110) { it.takeIf { nanos -> nanos > 0 } }
            bridge = try { AirPlayVideoSurfaceBridge(surface, 1280, 720, ready, failed,
                if (timedVideo) ::framePresentation else null) }
            catch (error: Exception) {
                sink.close(); runCatching { encoder.stop() }; encoder.release(); surface.release(); throw error
            }
            thread = Thread(::drain, "tiplay-airplay-cast-encoder").apply { isDaemon = true; start() }
        }

        fun setVideoSize(size: VideoSize) = bridge.setVideoSize(size.width, size.height,
            size.pixelWidthHeightRatio, size.unappliedRotationDegrees)

        fun frameMetadata(mediaUs: Long, releaseNanos: Long, presentationNanos: Long) = synchronized(timelineLock) {
            frameTimes.add(mediaUs, releaseNanos, presentationNanos)
        }

        private fun framePresentation(surfaceNanos: Long): Long? = synchronized(timelineLock) {
            frameTimes.take(surfaceNanos)?.also {
                submittedTimes.add(it / 1000)
                while (submittedTimes.size > 120) submittedTimes.remove(submittedTimes.first())
            }
        }

        fun resetTimeline() = synchronized(timelineLock) {
            if (closing.get()) return@synchronized
            frameTimes.clear()
            submittedTimes.clear()
            sink.onScreenStreamActive(110, false)
            sink.onScreenStreamActive(110, true)
            configRecord?.let { sink.onVideoConfig(110, it) }
            runCatching { encoder.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) }) }
        }

        private fun drain() {
            val info = MediaCodec.BufferInfo()
            var frames = 0L
            try {
                while (!stopped.get()) {
                    val index = encoder.dequeueOutputBuffer(info, 20_000)
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val format = encoder.outputFormat
                        val buffers = listOfNotNull(format.getByteBuffer("csd-0"), format.getByteBuffer("csd-1"))
                            .map { buffer -> ByteArray(buffer.remaining()).also { buffer.duplicate().get(it) } }
                        synchronized(timelineLock) {
                            configRecord = ReceiverAvc.record(*buffers.toTypedArray())
                            sink.onVideoCodec(110, VideoCodec.H264)
                            sink.onVideoConfig(110, requireNotNull(configRecord))
                        }
                        diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODER_CONFIG)
                    } else if (index >= 0) {
                        try {
                            val buffer = encoder.getOutputBuffer(index)
                            if (buffer != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                                buffer.position(info.offset); buffer.limit(info.offset + info.size)
                                val bytes = ByteArray(info.size); buffer.get(bytes)
                                val annexB = if (bytes.size >= 4 && bytes[0] == 0.toByte() && bytes[1] == 0.toByte() &&
                                    (bytes[2] == 1.toByte() || (bytes[2] == 0.toByte() && bytes[3] == 1.toByte()))) bytes
                                    else MediaCodecSupport.toAnnexB(bytes)
                                if (annexB.isNotEmpty()) {
                                    synchronized(timelineLock) {
                                        // Reset also retires frames already queued in the encoder. Surface submit
                                        // registers before swap; a reset between registration and swap invalidates it.
                                        if (!timedVideo || submittedTimes.remove(info.presentationTimeUs))
                                            sink.onVideoFrame(110, annexB, info.presentationTimeUs * 1000, System.nanoTime())
                                    }
                                    frames++
                                    if (frames == 1L || frames % 120 == 0L) diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODED_FRAME, frames)
                                }
                            }
                        } finally { encoder.releaseOutputBuffer(index, false) }
                    }
                }
            } catch (error: Exception) { if (!closing.get()) failed(error) }
            finally {
                sink.close()
                // Normal close has already released GL while draining stayed alive. A codec
                // failure still requests GL cleanup here; only this thread tears down the codec.
                val released = CountDownLatch(1)
                bridge.close { released.countDown() }
                runCatching { released.await(2, TimeUnit.SECONDS) }
                // A failed codec can leave eglSwapBuffers blocked; bounded codec teardown
                // releases that consumer so owner-thread cleanup can finish without an ANR.
                runCatching { encoder.stop() }; encoder.release(); surface.release()
            }
        }

        override fun close() {
            if (!closing.compareAndSet(false, true)) return
            sink.close()
            bridge.close { stopped.set(true); thread.interrupt() }
        }
    }
}
