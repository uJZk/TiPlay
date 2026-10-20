package com.shilapi.xcertplay

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import com.shilapi.xcertplay.web.AirPlayBrowserPlayback
import com.shilapi.xcertplay.web.AirPlayVideoPlayback
import com.shilapi.xcertplay.web.AirPlayPhotoPlayback
import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong

/** URL media and original still images are decoded by the browser, without Android re-encoding. */
internal class AirPlayCastPlayer(private val resource: (String, String?) -> ReceiverResource?,
                                private val stateChanged: (String, Long) -> Unit) : Closeable {
    private val main = Handler(Looper.getMainLooper())
    private fun logDiagnostic(message: String) {
        Log.i("tiplay-airplay", message)
        TeslaBrowserLink.persistDiagnostic(message)
    }
    private val diagnostics = AirPlayVideoDiagnostics(::logDiagnostic)
    @Volatile private var browserVideo: AirPlayVideoPlayback? = null
    @Volatile private var browserPhoto: AirPlayPhotoPlayback? = null
    @Volatile private var audioActive = false
    @Volatile private var activeGeneration = 0L
    private val outputLock = Any()
    @Volatile private var outputAllowed = false
    private val requests = AtomicLong()
    private val generation: Long get() = requests.get()
    val playbackEpoch: Long get() = generation
    @Volatile private var closed = false
    private fun live(token: Long) = !closed && generation == token
    private data class QueuedSeek(val playback: AirPlayVideoPlayback, val token: Long, val epoch: Long)
    private var iphoneSeekRequest: QueuedSeek? = null // main thread
    private val iphoneSeek = AirPlaySeekCoalescer(
        schedule = { task, delay -> main.postDelayed(task, delay) }, cancelScheduled = main::removeCallbacks,
    ) { seconds ->
        if (!closed) iphoneSeekRequest?.let { request ->
            if (live(request.epoch) && browserVideo === request.playback && request.playback.dispatchQueuedSeek(request.token)) {
                diagnostics.control(AirPlayVideoDiagnostics.ControlSource.IPHONE, "seek", seconds, generation)
            }
        }
    }
    private var browserControls: Closeable? = null
    val state: ReceiverPlayback get() {
        val epoch = generation
        if (activeGeneration != epoch) return ReceiverPlayback(buffering = true)
        val current = browserVideo?.receiverPlayback() ?: ReceiverPlayback(ready = browserPhoto != null || audioActive)
        return if (generation == epoch && activeGeneration == epoch) current else ReceiverPlayback(buffering = true)
    }

    fun play(item: ReceiverPlay, loadResource: (String, String?) -> ReceiverResource? = resource): Boolean {
        val token = requests.incrementAndGet()
        return main.post {
            if (!live(token)) return@post
            stopNow(AirPlayVideoDiagnostics.StopReason.REPLACED, token)
            val playback = AirPlayVideoPlayback(item, { url, range ->
                if (live(token)) loadResource(url, range) else null
            }, ::logDiagnostic) { event -> main.post {
                if (live(token)) {
                    if (event == "stopped" || event == "failed") stopNow(
                        if (event == "failed") AirPlayVideoDiagnostics.StopReason.BROWSER_FAILED else AirPlayVideoDiagnostics.StopReason.BROWSER_ENDED, token,
                    )
                    stateChanged(event, token)
                }
            } }
            synchronized(outputLock) {
                browserVideo = playback
                playback.setOutputAllowed(outputAllowed)
            }
            activeGeneration = token
            browserControls = AirPlayBrowserPlayback.register(state = playback::state, video = playback,
                control = { action, value -> main.post {
                    if (live(token)) {
                        diagnostics.control(AirPlayVideoDiagnostics.ControlSource.BROWSER, action, value, generation)
                        if (action == "stop") { stopNow(AirPlayVideoDiagnostics.StopReason.BROWSER_STOP, token); stateChanged("stopped", token) }
                        else {
                            if (action == "seek") { iphoneSeek.cancel(); iphoneSeekRequest = null }
                            playback.control(action, value)
                        }
                    }
                } })
            stateChanged("loading", token)
        }
    }

    fun photo(bytes: ByteArray): Boolean {
        val token = requests.incrementAndGet()
        return main.post {
            if (!live(token)) return@post
            stopNow(AirPlayVideoDiagnostics.StopReason.REPLACED, token)
            val photo = AirPlayPhotoPlayback(bytes).also { browserPhoto = it }
            browserControls = AirPlayBrowserPlayback.register(state = {
                AirPlayBrowserPlayback.State(0.0, 0.0, false, true, false, false, "photo", outputAllowed = outputAllowed)
            }, photo = photo, control = { action, _ -> if (action == "stop") main.post {
                if (live(token)) {
                    diagnostics.control(AirPlayVideoDiagnostics.ControlSource.BROWSER, "stop", null, generation)
                    stopNow(AirPlayVideoDiagnostics.StopReason.BROWSER_STOP, token); stateChanged("stopped", token)
                }
            } })
            activeGeneration = token
            stateChanged("photo", token)
        }
    }

    fun seek(seconds: Double) {
        val epoch = generation
        if (activeGeneration != epoch) return
        val playback = browserVideo ?: return
        val token = playback.queueSeek(seconds) ?: return
        main.post {
            if (live(epoch) && browserVideo === playback) {
                iphoneSeekRequest = QueuedSeek(playback, token, epoch)
                iphoneSeek.request(seconds)
            }
        }
    }
    fun audio(afterReady: () -> Unit = {}, stop: () -> Unit): Boolean {
        val token = requests.incrementAndGet()
        return main.post {
            if (!live(token)) return@post
            stopNow(AirPlayVideoDiagnostics.StopReason.REPLACED, token)
            audioActive = true
            browserControls = AirPlayBrowserPlayback.register(state = {
                AirPlayBrowserPlayback.State(0.0, 0.0, true, true, false, false, "audio")
            }, control = { action, _ -> if (action == "stop") main.post {
                if (live(token)) { stopNow(AirPlayVideoDiagnostics.StopReason.BROWSER_STOP, token); stop() }
            } })
            activeGeneration = token
            afterReady()
        }
    }

    fun videoProperty(property: String, value: Any?): Boolean =
        if (activeGeneration == generation) browserVideo?.property(property, value) ?: false else false

    fun rate(value: Double): Boolean {
        if (!ReceiverPlayback.supportsRate(value)) return false
        val request = generation
        val playback = browserVideo ?: return false
        return main.post {
            if (live(request) && activeGeneration == request && browserVideo === playback) {
                diagnostics.control(AirPlayVideoDiagnostics.ControlSource.IPHONE, "rate", value, request)
                playback.control("rate", value)
            }
        }
    }
    fun setOutputAllowed(allowed: Boolean) = synchronized(outputLock) {
        outputAllowed = allowed
        browserVideo?.setOutputAllowed(allowed)
    }

    fun stop(afterStop: () -> Unit = {}): Boolean {
        val token = requests.incrementAndGet()
        return main.post { if (live(token)) { stopNow(AirPlayVideoDiagnostics.StopReason.RECEIVER_STOP, token); afterStop() } }
    }
    private fun stopNow(reason: AirPlayVideoDiagnostics.StopReason, token: Long = generation) {
        if (browserControls != null || browserVideo != null || browserPhoto != null) diagnostics.stopped(reason, generation)
        iphoneSeek.cancel()
        iphoneSeekRequest = null
        browserControls?.close(); browserControls = null
        browserVideo?.close(); browserVideo = null
        browserPhoto?.close(); browserPhoto = null
        audioActive = false
        activeGeneration = token
    }
    override fun close() {
        closed = true; requests.incrementAndGet()
        if (Looper.myLooper() == main.looper) stopNow(AirPlayVideoDiagnostics.StopReason.SHUTDOWN)
        else main.post { stopNow(AirPlayVideoDiagnostics.StopReason.SHUTDOWN) }
    }

}
