package com.shilapi.xcertplay

import android.os.Handler
import android.os.Looper
import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.orchestration.CarPlayVideoListener
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverResource
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** CarPlay video controls over the existing browser URL player. No Android video activity. */
internal class BrowserVideoInCar(private val send: (Long, Map<String, Any?>) -> Boolean) : CarPlayVideoListener {
    private val main = Handler(Looper.getMainLooper())
    private companion object {
        val sender = Executors.newSingleThreadExecutor { task ->
            Thread(task, "tiplay-browser-video-reply").apply { isDaemon = true }
        }
    }
    private val requestIds = AtomicLong()
    private val resources = ConcurrentHashMap<Long, CompletableFuture<Map<*, *>>>()
    private var stream: Long? = null
    private var item: VideoInCar.Item? = null
    private var loaded = false
    @Volatile private var generation = 0L
    private var rate = 0.0
    private var player: AirPlayCastPlayer? = null

    // Vehicle state integration is deferred for the phone + browser product.
    override fun readParked(): Boolean = true

    override fun onVideoAllowedChanged(allowed: Boolean) {
        if (!allowed) main.post { stop() }
    }

    override fun onVideoUiRequested() { main.post { show() } }

    override fun onVideoSessionEnded() { main.post { stop(); stream = null } }

    override fun onVideoMessage(streamId: Long, message: Map<String, Any?>) {
        // Resource replies must bypass the UI queue: proxy loaders can be waiting for them.
        if (message["type"] == "unhandledURL") {
            val response = message["response"] as? Map<*, *> ?: return
            val id = (response["FCUP_Response_RequestID"] as? Number)?.toLong() ?: return
            resources[id]?.complete(response)
            return
        }
        main.post { handle(streamId, message) }
    }

    private fun handle(streamId: Long, message: Map<String, Any?>) {
        stream = streamId
        val request = message["kind"] == "request"
        when (message["type"]) {
            "insertPlayQueueItem" -> {
                stop()
                item = VideoInCar.parseItem(message, iphoneLoadsAppSchemes = true)
                if (item == null) reply(streamId, VideoInCar.errorNotification(
                    (message["item"] as? Map<*, *>)?.get("uuid"), VideoInCar.ERROR_INCOMPATIBLE_ASSET))
            }
            "setRate" -> {
                val next = (message["rate"] as? Number)?.toDouble() ?: return
                if (!com.shilapi.xcertplay.receiver.ReceiverPlayback.supportsRate(next)) return
                rate = next
                if (rate > 0) show()
                val target = player
                main.post { if (player === target) target?.rate(next) }
            }
            "seek" -> VideoInCar.seekMillis(message)?.let { position ->
                item = item?.copy(startMillis = position)
                val target = player
                main.post { if (player === target) target?.seek(position / 1000.0) }
            }
            "setProperty" -> (message["property"] as? String)?.let { name ->
                player?.videoProperty(name, message["value"])
            }
            "stop", "removePlayQueueItem" -> stop()
        }
        if (!request) return
        val state = player?.state?.let {
            VideoInCar.PlayerState(it.ready, it.rate > 0, it.position, it.duration, it.bufferedPosition)
        }
        val response = when (message["type"]) {
            "playbackInfo" -> VideoInCar.playbackInfoResponse(message["messageID"], item?.uuid, state)
            "property" -> VideoInCar.propertyResponse(message["messageID"], message["property"], state)
            else -> message.filterKeys { it in setOf("type", "messageID", "controlMessage", "property") } + ("kind" to "response")
        }
        reply(streamId, response)
    }

    private fun show() {
        val queued = item ?: return
        if (loaded || !VideoInCar.allowed) return
        val ownerStream = stream ?: return
        val token = ++generation
        val next = AirPlayCastPlayer({ url, range -> loadResource(ownerStream, queued.uuid, url, range) }) { event, _ ->
            if (generation == token) {
                if (event == "failed") reply(ownerStream, VideoInCar.errorNotification(queued.uuid, VideoInCar.ERROR_INCOMPATIBLE_ASSET))
                if (event == "stopped") reply(ownerStream, VideoInCar.playbackStateNotification(false, queued.uuid))
                if (event == "failed" || event == "stopped") stop()
                else if (event == "playing" || event == "paused")
                    reply(ownerStream, VideoInCar.playbackStateNotification(event == "playing", queued.uuid))
            }
        }
        player = next
        loaded = true
        next.setOutputAllowed(false)
        TeslaBrowserLink.pauseCarPlayDisplay { available ->
            if (generation == token) next.setOutputAllowed(available)
        }
        next.play(ReceiverPlay(queued.url, queued.startMillis / 1000.0, fraction = false))
        // play() creates the browser entry on main; queue the initial rate after that entry.
        main.post { if (generation == token) next.rate(rate) }
    }

    private fun stop() {
        generation++
        loaded = false
        item = null
        rate = 0.0
        resources.values.forEach { it.cancel(false) }
        resources.clear()
        val previous = player
        player = null
        previous?.close()
        if (previous != null) TeslaBrowserLink.resumeCarPlayDisplay()
    }

    private fun loadResource(ownerStream: Long, uuid: Any?, url: String, range: String?): ReceiverResource? {
        val id = requestIds.incrementAndGet()
        val answer = CompletableFuture<Map<*, *>>()
        resources[id] = answer
        val request = linkedMapOf<String, Any?>("FCUP_Response_URL" to url,
            "FCUP_Response_IsContentKeyRequest" to false, "FCUP_Response_RequestID" to id)
        if (range != null) request["FCUP_Response_Headers"] = mapOf("Range" to range)
        reply(ownerStream, mapOf("type" to "unhandledURL", "kind" to "request", "request" to request,
            "item" to if (uuid == null) emptyMap<String, Any?>() else mapOf("uuid" to uuid)))
        return try {
            val response = answer.get(10, TimeUnit.SECONDS)
            val headers = response["FCUP_Response_Headers"] as? Map<*, *>
            ReceiverResource(response["FCUP_Response_Data"] as? ByteArray,
                (response["FCUP_Response_StatusCode"] as? Number)?.toInt(),
                (headers?.get("Location") ?: headers?.get("location")) as? String,
                listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges").mapNotNull { name ->
                    val value = headers?.entries?.singleOrNull { (it.key as? String)?.equals(name, true) == true }?.value as? String
                    value?.takeIf { it.length in 1..1024 && it.none { c -> c == '\r' || c == '\n' || c == '\u0000' } }?.let { name to it }
                }.toMap())
        } catch (_: Exception) { null } finally { resources.remove(id) }
    }

    private fun reply(streamId: Long, message: Map<String, Any?>) {
        sender.execute { runCatching { send(streamId, message) } }
    }
}
