package com.shilapi.xcertplay

import android.os.Handler
import android.os.Looper
import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.orchestration.CarPlayVideoListener
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** CarPlay video controls over the browser URL player; every item owns its player and screen loan. */
internal class BrowserVideoInCar(
    private val send: (Long, Map<String, Any?>) -> Boolean,
    private val dependencies: Dependencies,
    private val playbackStatus: (Long, String) -> Boolean = { _, _ -> true },
) : CarPlayVideoListener {
    constructor(send: (Long, Map<String, Any?>) -> Boolean) : this(send, Dependencies())
    constructor(send: (Long, Map<String, Any?>) -> Boolean, status: (Long, String) -> Boolean) :
        this(send, Dependencies(), status)

    /** Tests use the production command/resource path without requiring a real browser. */
    internal interface Player : Closeable {
        val state: ReceiverPlayback
        val retired: Boolean get() = false
        fun play(item: ReceiverPlay, initialRate: Double, initialMuted: Boolean): Boolean
        fun rate(value: Double): Boolean
        fun seek(seconds: Double)
        fun property(name: String, value: Any?): Boolean
        fun setOutputAllowed(allowed: Boolean)
        fun setVideoShown(shown: Boolean)
    }

    internal class Dependencies(
        val player: ((String, String?) -> ReceiverResource?, (String) -> Unit) -> Player = { resource, event ->
            val target = AirPlayCastPlayer(resource) { kind, _ -> event(kind) }
            object : Player {
                override val state get() = target.state
                override val retired get() = target.retired
                override fun play(item: ReceiverPlay, initialRate: Double, initialMuted: Boolean) =
                    target.play(item, initialRate = initialRate, initialMuted = initialMuted)
                override fun rate(value: Double) = target.rate(value)
                override fun seek(seconds: Double) = target.seek(seconds)
                override fun property(name: String, value: Any?) = target.videoProperty(name, value)
                override fun setOutputAllowed(allowed: Boolean) { target.setOutputAllowed(allowed) }
                override fun setVideoShown(shown: Boolean) { target.setVideoShown(shown) }
                override fun close() = target.close()
            }
        },
        val borrow: (Any, (Boolean) -> Unit) -> Unit = { owner, available ->
            TeslaBrowserLink.pauseCarPlayDisplay(owner, available)
        },
        val release: (Any) -> Unit = { owner -> TeslaBrowserLink.resumeCarPlayDisplay(owner); Unit },
        val dispatchReply: ((Runnable) -> Unit)? = null,
    )

    private class Entry(val generation: Long, val epoch: Long, val stream: Long, var item: VideoInCar.Item) {
        var rate = 0.0
        var wantsPicture = true
        var audioOnly = false
        var muted = false
        var lastStatus: String? = null
        var player: Player? = null
        var loan: Any? = null
    }

    private class Resource(val entry: Entry, val future: CompletableFuture<Map<*, *>>)

    private val main = Handler(Looper.getMainLooper())
    private val lifecycle = Any()
    private val epochs = AtomicLong()
    private val generations = AtomicLong()
    private val requestIds = AtomicLong()
    private val retiredStreams = ConcurrentHashMap.newKeySet<Long>()
    private val resources = ConcurrentHashMap<Long, Resource>()
    // A blocked/retired connection cannot keep an unbounded queue or block a different controller.
    private val sender = ThreadPoolExecutor(0, 1, 5, TimeUnit.SECONDS, ArrayBlockingQueue(64), { task ->
        Thread(task, "tiplay-browser-video-reply").apply { isDaemon = true }
    })
    @Volatile private var current: Entry? = null
    private var sourceGeneration = 0L // lifecycle lock
    private var sourceEnded = false // lifecycle lock
    private var allowed = VideoInCar.allowed // Main thread; vehicle gear integration is deferred.

    override fun readParked(): Boolean = true

    private fun adopt(generation: Long): Boolean {
        if (generation < sourceGeneration || generation == sourceGeneration && sourceEnded) return false
        if (generation > sourceGeneration) {
            sourceGeneration = generation
            sourceEnded = false
            retireEpoch()
        }
        return true
    }

    override fun onVideoSessionStarted(generation: Long) {
        synchronized(lifecycle) { adopt(generation) }
    }

    override fun onVideoMessage(generation: Long, streamId: Long, message: Map<String, Any?>) {
        synchronized(lifecycle) { if (adopt(generation)) onVideoMessage(streamId, message) }
    }

    override fun onVideoUiRequested(generation: Long) {
        synchronized(lifecycle) { if (adopt(generation)) onVideoUiRequested() }
    }

    override fun onVideoStreamEnded(generation: Long, streamId: Long) {
        synchronized(lifecycle) { if (adopt(generation)) onVideoStreamEnded(streamId) }
    }

    override fun onVideoSessionEnded(generation: Long) {
        synchronized(lifecycle) {
            if (generation < sourceGeneration || generation == sourceGeneration && sourceEnded) return
            sourceGeneration = generation
            sourceEnded = true
            retireEpoch()
        }
    }

    private fun enqueue(block: (Long) -> Unit) = synchronized(lifecycle) {
        val epoch = epochs.get()
        main.post { if (epochs.get() == epoch) block(epoch) }
        Unit
    }

    override fun onVideoAllowedChanged(allowed: Boolean) = enqueue {
        this.allowed = allowed
        current?.let(::updatePicture)
    }

    override fun onVideoUiRequested() = enqueue {
        current?.let { entry ->
            entry.wantsPicture = true
            ensurePlayer(entry)
            updatePicture(entry)
        }
    }

    override fun onVideoSessionEnded() = synchronized(lifecycle) {
        retireEpoch()
    }

    private fun retireEpoch() {
        val epoch = epochs.incrementAndGet()
        generations.incrementAndGet()
        retiredStreams.clear()
        resources.values.forEach { it.future.cancel(false) }
        resources.clear()
        sender.queue.clear()
        main.post { if (epochs.get() == epoch) retireCurrent() }
    }

    override fun onVideoStreamEnded(streamId: Long) = synchronized(lifecycle) {
        val epoch = epochs.get()
        retiredStreams.add(streamId)
        resources.values.filter { it.entry.stream == streamId }.forEach { it.future.cancel(false) }
        main.post {
            if (epochs.get() == epoch && current?.stream == streamId) retireCurrent()
        }
        Unit
    }

    override fun onVideoMessage(streamId: Long, message: Map<String, Any?>) {
        if (message["type"] == "unhandledURL") {
            val response = message["response"] as? Map<*, *> ?: return
            val value = response["FCUP_Response_RequestID"] as? Number ?: return
            val id = value.toLong().takeIf { it > 0 && it.toDouble() == value.toDouble() } ?: return
            synchronized(lifecycle) {
                val pending = resources[id] ?: return
                if (pending.entry.stream == streamId && live(pending.entry) && matchesItem(pending.entry, message))
                    pending.future.complete(response)
            }
            return
        }
        if (message["kind"] == "response") return
        enqueue { epoch -> if (streamId !in retiredStreams) handle(epoch, streamId, message) }
    }

    private fun live(entry: Entry): Boolean =
        current === entry && entry.epoch == epochs.get() && entry.stream !in retiredStreams

    private fun matchesItem(entry: Entry, message: Map<String, Any?>): Boolean {
        val uuid = (message["item"] as? Map<*, *>)?.get("uuid") ?: message["uuid"] ?: return true
        return if (uuid is ByteArray && entry.item.uuid is ByteArray) uuid.contentEquals(entry.item.uuid as ByteArray)
        else uuid == entry.item.uuid
    }

    private fun handle(epoch: Long, streamId: Long, message: Map<String, Any?>) {
        val type = message["type"] as? String ?: return
        if (type == "insertPlayQueueItem") {
            retireCurrent()
            val generation = generations.incrementAndGet()
            val item = VideoInCar.parseItem(message, iphoneLoadsAppSchemes = true)
            if (item == null) reply(epoch, streamId, VideoInCar.errorNotification(
                (message["item"] as? Map<*, *>)?.get("uuid"), VideoInCar.ERROR_INCOMPATIBLE_ASSET), generation)
            else current = Entry(generation, epoch, streamId, item).apply {
                muted = (message["item"] as? Map<*, *>)?.get("muted") == true
            }
        }
        val entry = current?.takeIf { it.stream == streamId && matchesItem(it, message) }
        if (entry != null) when (type) {
            "setRate" -> {
                val next = (message["rate"] as? Number)?.toDouble()
                if (next != null && ReceiverPlayback.supportsRate(next)) {
                    entry.rate = next
                    if (next > 0) ensurePlayer(entry)
                    applyControls(entry)
                }
            }
            "seek" -> VideoInCar.seekMillis(message)?.let { position ->
                entry.item = entry.item.copy(startMillis = position)
                applyControls(entry, seek = true)
            }
            "setProperty" -> if (message["property"] == "muted" && message["value"] is Boolean) {
                entry.muted = message["value"] as Boolean
                applyControls(entry)
            } else (message["property"] as? String)?.let { entry.player?.property(it, message["value"]) }
            "changeVideoPlaybackToAudioOnly" -> {
                entry.wantsPicture = false
                ensurePlayer(entry)
                updatePicture(entry)
            }
            "stop", "removePlayQueueItem" -> retireCurrent()
        }
        if (message["kind"] != "request") return
        val active = entry?.takeIf(::live)
        val state = active?.player?.state?.let {
            VideoInCar.PlayerState(it.ready, it.rate > 0, it.position, it.duration, it.bufferedPosition,
                buffering = it.buffering, rate = it.rate, seekable = it.seekable, muted = active.muted)
        }
        val response = when (type) {
            "playbackInfo" -> VideoInCar.playbackInfoResponse(message["messageID"], active?.item?.uuid, state)
            "property" -> if (message["property"] == "muted" && active != null) {
                mapOf("type" to "property", "kind" to "response", "key" to "muted", "value" to active.muted) +
                    message.filterKeys { it == "messageID" }
            } else VideoInCar.propertyResponse(message["messageID"], message["property"], state)
            else -> message.filterKeys { it in setOf("type", "messageID", "controlMessage", "property") } +
                ("kind" to "response")
        }
        reply(epoch, streamId, response)
    }

    private fun ensurePlayer(entry: Entry) {
        if (!live(entry) || retireIfReplaced(entry) || entry.player != null) return
        val next = try { dependencies.player({ url, range -> loadResource(entry, url, range) }) { event ->
            main.post {
                if (live(entry)) {
                    when (event) {
                        "failed" -> {
                            reply(entry.epoch, entry.stream, VideoInCar.errorNotification(entry.item.uuid,
                                VideoInCar.ERROR_INCOMPATIBLE_ASSET), entry.generation)
                            retireCurrent()
                        }
                        "stopped" -> {
                            reply(entry.epoch, entry.stream,
                                VideoInCar.playbackStateNotification(false, entry.item.uuid), entry.generation)
                            retireCurrent()
                        }
                        "playing", "paused" -> reply(entry.epoch, entry.stream,
                            VideoInCar.playbackStateNotification(event == "playing", entry.item.uuid), entry.generation)
                    }
                }
            }
        } } catch (_: RuntimeException) {
            fail(entry)
            return
        }
        entry.player = next
        val accepted = runCatching {
            next.setVideoShown(false)
            next.setOutputAllowed(false)
            status(entry, "idle")
            next.play(ReceiverPlay(entry.item.url, entry.item.startMillis / 1000.0, fraction = false), entry.rate, entry.muted)
        }.getOrDefault(false)
        if (!accepted) {
            fail(entry)
            return
        }
        applyControls(entry)
        updatePicture(entry)
    }

    private fun applyControls(entry: Entry, seek: Boolean = false) {
        val target = entry.player ?: return
        // play() queues the production browser entry; commands may already be queued ahead of it.
        main.post {
            if (live(entry) && entry.player === target) {
                if (retireIfReplaced(entry)) return@post
                target.rate(entry.rate)
                target.property("muted", entry.muted)
                if (seek) target.seek(entry.item.startMillis / 1000.0)
            }
        }
    }

    private fun updatePicture(entry: Entry) {
        val target = entry.player ?: return
        if (!live(entry) || retireIfReplaced(entry)) return
        if (!entry.wantsPicture || !allowed) {
            entry.audioOnly = true
            val owner = entry.loan
            entry.loan = null // Delayed revocation of this loan must not pause the permitted audio.
            target.setVideoShown(false)
            target.setOutputAllowed(true)
            if (owner != null) dependencies.release(owner)
            status(entry, "audioOnly")
            return
        }
        if (entry.loan != null) return
        val owner = Any()
        entry.loan = owner
        target.setVideoShown(false)
        target.setOutputAllowed(entry.audioOnly)
        try {
            dependencies.borrow(owner) { available -> main.post {
                if (live(entry) && entry.player === target && entry.loan === owner) {
                    target.setVideoShown(available)
                    target.setOutputAllowed(available || entry.audioOnly)
                    if (available) entry.audioOnly = false
                    status(entry, if (available) "video" else if (entry.audioOnly) "audioOnly" else "idle")
                }
            } }
        } catch (_: RuntimeException) { fail(entry) }
    }

    private fun fail(entry: Entry) {
        if (!live(entry)) return
        reply(entry.epoch, entry.stream, VideoInCar.errorNotification(entry.item.uuid,
            VideoInCar.ERROR_INCOMPATIBLE_ASSET), entry.generation)
        retireCurrent()
    }

    private fun retireIfReplaced(entry: Entry): Boolean {
        if (entry.player?.retired != true) return false
        if (live(entry)) {
            reply(entry.epoch, entry.stream, VideoInCar.playbackStateNotification(false, entry.item.uuid), entry.generation)
            retireCurrent()
        }
        return true
    }

    private fun retireCurrent() {
        val entry = synchronized(lifecycle) {
            val previous = current ?: return
            current = null
            resources.entries.filter { it.value.entry === previous }.forEach { (id, pending) ->
                resources.remove(id, pending)
                pending.future.cancel(false)
            }
            previous
        }
        val owner = entry.loan
        entry.loan = null
        entry.player?.let {
            runCatching { it.setVideoShown(false) }
            runCatching { it.setOutputAllowed(false) }
            runCatching { it.close() }
        }
        entry.player = null
        if (owner != null) runCatching { dependencies.release(owner) }
        status(entry, "idle")
    }

    private fun loadResource(entry: Entry, url: String, range: String?): ReceiverResource? {
        val id = requestIds.incrementAndGet()
        val pending = Resource(entry, CompletableFuture())
        synchronized(lifecycle) {
            if (!live(entry) || resources.size >= MAX_RESOURCES) return null
            resources[id] = pending
        }
        val request = linkedMapOf<String, Any?>("FCUP_Response_URL" to url,
            "FCUP_Response_IsContentKeyRequest" to false, "FCUP_Response_RequestID" to id)
        if (range != null) request["FCUP_Response_Headers"] = mapOf("Range" to range)
        val message = mapOf("type" to "unhandledURL", "kind" to "request", "request" to request,
            "item" to if (entry.item.uuid == null) emptyMap<String, Any?>() else mapOf("uuid" to entry.item.uuid))
        dispatch({ resources[id] === pending && live(entry) }, { pending.future.cancel(false) }) {
            send(entry.stream, message)
        }
        return try {
            val response = pending.future.get(10, TimeUnit.SECONDS)
            if (!live(entry)) return null
            val headers = response["FCUP_Response_Headers"] as? Map<*, *>
            ReceiverResource(response["FCUP_Response_Data"] as? ByteArray,
                (response["FCUP_Response_StatusCode"] as? Number)?.toInt(),
                (headers?.get("Location") ?: headers?.get("location")) as? String,
                listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges").mapNotNull { name ->
                    val value = headers?.entries?.singleOrNull { (it.key as? String)?.equals(name, true) == true }?.value as? String
                    value?.takeIf { it.length in 1..1024 && it.none { c -> c == '\r' || c == '\n' || c == '\u0000' } }?.let { name to it }
                }.toMap())
        } catch (_: Exception) { null } finally { resources.remove(id, pending) }
    }

    private fun reply(epoch: Long, stream: Long, message: Map<String, Any?>, generation: Long? = null) {
        dispatch({ epochs.get() == epoch && stream !in retiredStreams &&
            (generation == null || generations.get() == generation) }, {}) { send(stream, message) }
    }

    private fun status(entry: Entry, value: String) {
        if (entry.lastStatus == value) return
        entry.lastStatus = value
        dispatch({ epochs.get() == entry.epoch && entry.stream !in retiredStreams &&
            generations.get() == entry.generation }, {}) { playbackStatus(entry.stream, value) }
    }

    private fun dispatch(valid: () -> Boolean, failed: () -> Unit, write: () -> Boolean) {
        val task = Runnable {
            if (!valid() || !runCatching(write).getOrDefault(false)) failed()
        }
        try {
            val custom = dependencies.dispatchReply
            if (custom == null) sender.execute(task) else custom(task)
        } catch (_: RuntimeException) { failed() }
    }

    private companion object { const val MAX_RESOURCES = 32 }
}
