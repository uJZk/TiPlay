package com.shilapi.xcertplay

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.receiver.ReceiverAvc
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.AirPlayBrowserPlayback
import com.shilapi.xcertplay.web.AirPlayVideoPlayback
import com.shilapi.xcertplay.media.MediaCodecSupport
import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** URL video is proxied to the browser. Only still photos use the canvas encoder. */
internal class AirPlayCastPlayer(private val resource: (String) -> ReceiverResource?,
                                private val stateChanged: (String) -> Unit) : Closeable {
    private val main = Handler(Looper.getMainLooper())
    private val diagnostics = AirPlayVideoDiagnostics { Log.i("tiplay-airplay", it) }
    private var browserVideo: AirPlayVideoPlayback? = null
    private var video: EncodedVideo? = null
    private var photoFrames: AirPlayPhotoFrames? = null
    @Volatile private var generation = 0L
    val playbackEpoch: Long get() = generation
    private var closed = false
    private var browserControls: Closeable? = null
    val state: ReceiverPlayback get() = browserVideo?.playback ?: ReceiverPlayback()

    fun play(item: ReceiverPlay) = main.post {
        if (closed) return@post
        stopNow()
        TeslaBrowserLink.pauseCarPlayDisplay()
        val token = generation
        val playback = AirPlayVideoPlayback(item, resource) { event -> main.post {
            if (!closed && generation == token) {
                if (event == "stopped" || event == "failed") stopNow()
                stateChanged(event)
            }
        } }
        browserVideo = playback
        browserControls = AirPlayBrowserPlayback.register(state = playback::state, video = playback,
            control = { action, value -> main.post {
                if (!closed && generation == token) {
                    if (action == "stop") { stopNow(); stateChanged("stopped") }
                    else playback.control(action, value)
                }
            } })
        stateChanged("loading")
    }

    fun photo(bytes: ByteArray) = main.post {
        if (closed) return@post
        stopNow()
        TeslaBrowserLink.pauseCarPlayDisplay()
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
            } }, failed = failure)
        } catch (error: Exception) { failure(error) }
    }

    fun seek(seconds: Double) = main.post { browserVideo?.control("seek", seconds) }
    fun rate(value: Double) = main.post { browserVideo?.control(if (value == 0.0) "pause" else "play", null) }
    fun stop() = main.post { stopNow(); TeslaBrowserLink.resumeCarPlayDisplay() }
    private fun fail() { stopNow(); stateChanged("failed") }
    private fun stopNow() {
        browserControls?.close(); browserControls = null
        browserVideo?.close(); browserVideo = null
        generation++
        photoFrames?.close(); photoFrames = null
        video?.close(); video = null
    }
    override fun close() {
        if (Looper.myLooper() == main.looper) { closed = true; stopNow() }
        else main.post { closed = true; stopNow() }
    }

    private class EncodedVideo(private val diagnostics: AirPlayVideoDiagnostics,
                               ready: (android.view.Surface) -> Unit,
                               private val failed: (Exception) -> Unit) : Closeable {
        private val stopped = AtomicBoolean(false)
        private val closing = AtomicBoolean(false)
        private val sink = WebMediaSink(TeslaBrowserLink.hub, 1280, 720, 30,
            com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY,
            com.shilapi.xcertplay.web.BrowserPlaybackMode.AIRPLAY_MIRROR)
        private val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        private val surface: android.view.Surface
        private val bridge: AirPlayVideoSurfaceBridge
        private val thread: Thread
        private val timelineLock = Any()
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
            bridge = try { AirPlayVideoSurfaceBridge(surface, 1280, 720, ready, failed) }
            catch (error: Exception) {
                sink.close(); runCatching { encoder.stop() }; encoder.release(); surface.release(); throw error
            }
            thread = Thread(::drain, "tiplay-airplay-cast-encoder").apply { isDaemon = true; start() }
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
                                        sink.onVideoFrame(110, annexB, info.presentationTimeUs * 1000, System.nanoTime())
                                        frames++
                                        if (frames == 1L || frames % 120 == 0L) diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODED_FRAME, frames)
                                    }
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
