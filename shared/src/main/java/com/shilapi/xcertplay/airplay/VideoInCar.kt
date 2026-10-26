package com.shilapi.xcertplay.airplay

import com.shilapi.xcertplay.compat.Base64Compat

/** Whether the latest video availability update was sent now or retained for a later AirPlay stage. */
internal enum class VideoPlaybackDelivery { SENT, QUEUED, UNCHANGED }

/**
 * Keeps the latest parked-state decision until both SETUP has enabled video playback and the
 * encrypted AirPlay event channel is ready. AirPlay establishes those asynchronously, so dropping
 * an early update can leave the iPhone in audio-only mode for the rest of the session.
 */
internal class VideoPlaybackAvailability(
    private val send: (Boolean) -> Boolean,
) {
    private val stateLock = Any()
    private var desired: Boolean? = null
    private var featureEnabled = false
    private var eventReady = false
    private var lastSent: Boolean? = null
    private var generation = 0L
    private var deliveryOwner: Any? = null

    private data class Delivery(val allowed: Boolean, val generation: Long)

    fun setDesired(allowed: Boolean): VideoPlaybackDelivery {
        synchronized(stateLock) { desired = allowed }
        return flush()
    }

    fun setFeatureEnabled(enabled: Boolean): VideoPlaybackDelivery {
        synchronized(stateLock) {
            if (featureEnabled != enabled) {
                featureEnabled = enabled
                generation++
                lastSent = null
            }
        }
        return flush()
    }

    fun setEventReady(ready: Boolean): VideoPlaybackDelivery {
        synchronized(stateLock) {
            if (eventReady != ready) {
                eventReady = ready
                generation++
                lastSent = null
            }
        }
        return flush()
    }

    /** Resend a changed playback status even when permission itself stayed the same. */
    fun refresh(): VideoPlaybackDelivery {
        synchronized(stateLock) { generation++; lastSent = null }
        return flush()
    }

    private fun flush(): VideoPlaybackDelivery {
        val owner = Any()
        var delivery = synchronized(stateLock) {
            val next = desired ?: return VideoPlaybackDelivery.QUEUED
            if (!featureEnabled || !eventReady || deliveryOwner != null) return VideoPlaybackDelivery.QUEUED
            if (lastSent == next) return VideoPlaybackDelivery.UNCHANGED
            deliveryOwner = owner
            Delivery(next, generation)
        }
        try {
            while (true) {
                // A failed socket write can synchronously retire the channel. Neither a state
                // monitor nor a delivery monitor may be held while invoking that transport.
                val delivered = send(delivery.allowed)
                delivery = synchronized(stateLock) {
                    val current = desired
                    val sameGeneration = generation == delivery.generation
                    if (delivered && sameGeneration && featureEnabled && eventReady) lastSent = delivery.allowed
                    when {
                        current == null || !featureEnabled || !eventReady || (!delivered && sameGeneration) -> {
                            deliveryOwner = null
                            return VideoPlaybackDelivery.QUEUED
                        }
                        lastSent == current -> {
                            deliveryOwner = null
                            return VideoPlaybackDelivery.SENT
                        }
                        // Reentrant or concurrent changes coalesce here. In particular, an old
                        // channel's success or failure cannot suppress delivery on its successor.
                        else -> Delivery(current, generation)
                    }
                }
            }
        } finally {
            // A throwing transport must not strand the pump or clear a newer caller's owner.
            synchronized(stateLock) { if (deliveryOwner === owner) deliveryOwner = null }
        }
    }
}

/**
 * iOS 27 "video in car": while the car is parked, the iPhone hands the head unit a media URL and
 * drives playback; the head unit plays it in its own player. Observed with an iPhone on iOS 27 and
 * checked against Apple's CarPlay Simulator (Additional Tools for Xcode 27) and its AirPlay web app.
 *
 * - SETUP enables the [FEATURE] when configured and proposed by the iPhone.
 * - The iPhone opens a [SETTINGS_CHANNEL_UUID] data stream (see VideoSettingsChannel) and, to play,
 *   a remote control session without a socket ([REMOTE_CONTROL_UUIDS], controlType 1). Its messages
 *   arrive as POST /command with X-Apple-StreamID and {params: {data: bplist}} and are answered the
 *   same way.
 * - requestUI [UI_URL] asks the car to show its player.
 *
 * Media whose key needs FairPlay (Apple TV+) does not play: Apple's receiver passes such key URLs to
 * the iPhone (unhandledURL) and answers its streamingKey with a FairPlay key request, which needs a
 * licensed FairPlay receiver. Plain http(s) media such as Safari's plays.
 */
object VideoInCar {
    const val FEATURE = "videoPlayback"
    const val UI_URL = "videoplayback:"
    const val SETTINGS_CHANNEL_UUID = "BB493F61-A6B8-4769-8D74-80C23A9F71C4"
    const val PLAYBACK_UUID = "A6B27562-B43A-4F2D-B75F-82391E250194"
    val REMOTE_CONTROL_UUIDS = setOf(
        PLAYBACK_UUID, // video setup
        "E3DC3EA6-E6C3-4B30-847C-B7ACFEBEA654", // overlay UI
    )

    /** CoreMedia errors Apple's receiver reports when an item cannot play. */
    const val ERROR_NETWORK = -17221
    const val ERROR_DECODER = -12911
    const val ERROR_INCOMPATIBLE_ASSET = -12927

    /** Whether video may play now; the host sets it from the car's gear (P only). */
    @Volatile var allowed = false

    /** A URL scheme an app could serve through its resource loader. */
    private val APP_SCHEME = Regex("[a-z][a-z0-9+.-]*")

    /** Android local resources and FairPlay keys must never be opened as remote video. */
    private val NOT_APP_SCHEMES = setOf("file", "content", "asset", "rawresource", "android.resource", "skd")

    /** Shared policy for queue items, playlist children and iPhone loader redirects. */
    fun isPlayableUrl(url: String, iphoneLoadsAppSchemes: Boolean = false): Boolean {
        val scheme = url.substringBefore(':', missingDelimiterValue = "").lowercase()
        return scheme == "http" || scheme == "https" ||
            (iphoneLoadsAppSchemes && APP_SCHEME.matches(scheme) && scheme !in NOT_APP_SCHEMES)
    }

    /** Base64 of the declared legacy bitmap, little-endian with no padding or trailing zero bytes. */
    fun featuresEx(legacyFeatures: Long): String {
        val bytes = ByteArray(Long.SIZE_BYTES) { index -> (legacyFeatures ushr (index * 8)).toByte() }
        return Base64Compat.encode(bytes.dropLastWhile { it == 0.toByte() }.toByteArray()).trimEnd('=')
    }

    /** /info top-level entries. Keep permission and receiver capabilities in their separate dictionaries. */
    fun info(legacyFeatures: Long, allowed: Boolean): Map<String, Any?> = linkedMapOf(
        "videoPlaybackInfo" to linkedMapOf(
            "videoPlaybackAllowed" to allowed,
            "featuresEx" to featuresEx(legacyFeatures),
        ),
        "playbackCapabilities" to linkedMapOf(
            "supportsOfflineHLS" to false,
            "supportsUIForAudioOnlyContent" to false,
            "supportsFPSSecureStop" to false,
        ),
    )

    /** A queued media item the car can play. */
    data class Item(val uuid: Any?, val url: String, val startMillis: Int)

    /**
     * The item of an insertPlayQueueItem message, or null when its media cannot play here. With
     * [iphoneLoadsAppSchemes] an app's own scheme (served by its resource loader) is accepted too, for a
     * player that asks the iPhone for such URLs (unhandledURL).
     */
    fun parseItem(message: Map<String, Any?>, iphoneLoadsAppSchemes: Boolean = false): Item? {
        val item = message["item"] as? Map<*, *> ?: return null
        val url = item["Content-Location"] as? String ?: return null
        if (!isPlayableUrl(url, iphoneLoadsAppSchemes)) return null
        val startSeconds = (item["Start-Position-Seconds"] as? Number)?.toDouble()
            ?: (item["Start-Position"] as? Map<*, *>)?.let(::seconds)
        val startMillis = startSeconds?.let { (it * 1000).toLong().coerceIn(0, Int.MAX_VALUE.toLong()).toInt() } ?: 0
        return Item(item["uuid"], url, startMillis)
    }

    /** The target of a seek message in milliseconds. */
    fun seekMillis(message: Map<String, Any?>): Int? =
        (message["time"] as? Map<*, *>)?.let(::seconds)?.let { (it * 1000).toLong().coerceIn(0, Int.MAX_VALUE.toLong()).toInt() }

    /** The car player's state for [playbackInfoResponse]. */
    data class PlayerState(
        val prepared: Boolean,
        val playing: Boolean,
        val positionSeconds: Double,
        val durationSeconds: Double,
        val bufferedSeconds: Double,
        val buffering: Boolean = false,
        val rate: Double = if (playing) 1.0 else 0.0,
        val seekable: Boolean = durationSeconds > 0,
        val muted: Boolean = false,
    )

    /**
     * The answer to a playbackInfo request, as Apple's web app builds it: the fields sit in "info", times
     * are CMTime dictionaries and ranges are {start, duration}.
     */
    fun playbackInfoResponse(messageId: Any?, itemUuid: Any?, state: PlayerState?): Map<String, Any?> {
        val ready = state?.prepared == true
        val duration = state?.durationSeconds ?: 0.0
        val info = linkedMapOf<String, Any?>(
            "item" to linkedMapOf("uuid" to itemUuid),
            "rate" to (state?.rate?.takeIf { it.isFinite() && it >= 0 } ?: 0.0),
            "readyToPlay" to ready,
            "playbackLikelyToKeepUp" to (ready && state?.buffering != true),
        )
        if (state != null && ready) {
            info["position"] = cmTime(state.positionSeconds)
            if (duration.isFinite() && duration > 0) info["duration"] = cmTime(duration)
            info["seekableTimeRanges"] = if (state.seekable && duration.isFinite() && duration > 0) listOf(range(0.0, duration)) else emptyList<Any>()
            info["loadedTimeRanges"] = loadedRanges(state)
        }
        info["playbackState"] = when {
            state == null || !ready || state.buffering -> "loading"
            state.playing -> "playing"
            else -> "paused"
        }
        info["interstitialInfo"] = linkedMapOf<String, Any?>()
        return linkedMapOf("info" to info, "kind" to "response", "type" to "playbackInfo", "messageID" to messageId).withoutNulls()
    }

    fun seekResponse(messageId: Any?): Map<String, Any?> =
        linkedMapOf("type" to "seek", "kind" to "response", "messageID" to messageId).withoutNulls()

    /**
     * The answer to a property request: {key, value}. What this player does not report has no value,
     * as the web app answers null for properties it does not support (plists have no null).
     */
    fun propertyResponse(messageId: Any?, key: Any?, state: PlayerState?): Map<String, Any?> {
        val ready = state?.prepared == true
        val value: Any? = when (key) {
            "hasEnabledAudio" -> true
            "muted" -> state?.muted ?: false
            "seekableTimeRanges" -> if (ready && state!!.seekable && state.durationSeconds.isFinite() && state.durationSeconds > 0)
                listOf(range(0.0, state.durationSeconds)) else emptyList<Any>()
            "loadedTimeRanges" -> if (ready) loadedRanges(state!!) else null
            else -> null
        }
        return linkedMapOf("key" to key, "value" to value, "kind" to "response", "type" to "property", "messageID" to messageId)
            .withoutNulls()
    }

    /**
     * Tells the iPhone the item cannot play here, as Apple's receiver does before it ends the item:
     * {type: error, error: {domain, code}, uuid}. The iPhone then stops showing it as playing on CarPlay.
     */
    fun errorNotification(itemUuid: Any?, code: Int): Map<String, Any?> =
        linkedMapOf("type" to "error", "error" to linkedMapOf("domain" to "", "code" to code.toLong()), "uuid" to itemUuid)
            .withoutNulls()

    /** Tells the iPhone at once that the car's player started or paused, e.g. from the steering wheel. */
    fun playbackStateNotification(playing: Boolean, itemUuid: Any?): Map<String, Any?> =
        if (playing) {
            linkedMapOf("type" to "playbackState", "name" to "playing", "item" to linkedMapOf("uuid" to itemUuid)).withoutNulls()
        } else {
            linkedMapOf("type" to "playbackState", "name" to "paused")
        }

    /** CMTime as the web app sends it: milliseconds, flags 1 (valid). */
    fun cmTime(seconds: Double): Map<String, Any?> =
        linkedMapOf("value" to Math.round(seconds * 1000), "timescale" to 1000L, "flags" to 1L, "epoch" to 0L)

    private fun loadedRanges(state: PlayerState): List<Map<String, Any?>> {
        val start = state.positionSeconds
        val end = state.bufferedSeconds
        return if (start.isFinite() && start >= 0 && end.isFinite() && end > start) listOf(range(start, end - start))
        else emptyList()
    }

    private fun range(start: Double, duration: Double) = linkedMapOf("start" to cmTime(start), "duration" to cmTime(duration))

    /** Plists have no null; a missing key stands for it, as the iPhone reads it. */
    private fun Map<String, Any?>.withoutNulls(): Map<String, Any?> {
        fun strip(value: Any?): Any? = when (value) {
            is Map<*, *> -> value.entries.filter { it.value != null }.associateTo(linkedMapOf()) { it.key.toString() to strip(it.value) }
            is List<*> -> value.filterNotNull().map(::strip)
            else -> value
        }
        @Suppress("UNCHECKED_CAST")
        return strip(this) as Map<String, Any?>
    }

    private fun seconds(time: Map<*, *>): Double? {
        val value = (time["value"] as? Number)?.toDouble() ?: return null
        val timescale = (time["timescale"] as? Number)?.toDouble()?.takeIf { it > 0 } ?: return null
        return value / timescale
    }
}
