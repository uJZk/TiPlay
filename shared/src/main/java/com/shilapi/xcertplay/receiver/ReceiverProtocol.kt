package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.airplay.VideoInCar
import java.net.URI
import java.net.URLDecoder

/** Capabilities shared by Bonjour, /info and /server-info. No CarPlay or DRM offer. */
data class ReceiverConfig(val name: String, val deviceId: String, val identity: AirPlayIdentity,
                          val width: Int = 1920, val height: Int = 1080, val fps: Int = 60,
                          val hevcEnabled: Boolean = false, val mirrorEnabled: Boolean = true,
                          val audioOutputFormats: Long = 0L) {
    init { ReceiverAudioCapabilities.validateFormats(audioOutputFormats) }
    // AirPlay and classic AirTunes use one RTSP listener and independent browser audio output.
    val features: Long = ReceiverCapabilities.features(hevcEnabled, mirrorEnabled, audioOutputFormats)
    val txt: Map<String, String> get() = mapOf(
        "deviceid" to deviceId, "features" to ReceiverCapabilities.txtFeatures(features),
        "flags" to "0x4", "model" to "AppleTV3,2", "srcvers" to "220.68", "vv" to "2",
        "pi" to identity.pairingId, "pk" to identity.publicKeyHex, "pw" to "false",
    )
    val raopName: String get() = deviceId.replace(":", "").uppercase() + "@" + name
    /** Offer only classic codecs accepted by the SDP parser and current browser. */
    val raopTxt: Map<String, String> get() {
        fun supports(codec: Int): Boolean {
            val index = ReceiverMirrorAudioFormat.supported.indexOfFirst {
                it.codec == codec && it.sampleRate == 44100 && it.channels == 2 && it.bitDepth == 16
            }
            return index >= 0 && audioOutputFormats and (1L shl (index + 2)) != 0L
        }
        val codecs = buildList {
            if (supports(1)) add("0")
            if (supports(2)) add("1")
        }
        return mapOf("txtvers" to "1", "ch" to "2", "cn" to codecs.joinToString(","),
            "et" to "0,3", "sv" to "false", "tp" to "UDP", "ss" to "16", "sr" to "44100",
            "md" to "0,1,2",
            "pw" to "false", "vn" to "65537", "vs" to "220.68", "am" to "AppleTV3,2",
            "sf" to "0x4", "ft" to ReceiverCapabilities.txtFeatures(features), "pk" to identity.publicKeyHex)
    }
    fun info(): Map<String, Any?> = mapOf(
        "deviceID" to deviceId, "macAddress" to deviceId, "name" to name,
        "features" to features, "model" to "AppleTV3,2", "sourceVersion" to "220.68",
        "statusFlags" to 4L, "pk" to identity.publicKey, "pi" to identity.pairingId, "vv" to 2L,
        "keepAliveLowPower" to false,
        "displays" to listOf(mapOf("uuid" to identity.pairingId, "width" to width, "height" to height,
            "widthPixels" to width, "heightPixels" to height, "widthPhysical" to 0,
            "heightPhysical" to 0, "rotation" to false, "refreshRate" to 1.0 / fps,
            "maxFPS" to fps, "overscanned" to false, "features" to 14L)),
    ) + ReceiverAudioCapabilities.info(audioOutputFormats)
    /** The HTTP video endpoint uses the legacy lower-case keys, unlike RTSP /info. */
    fun serverInfo(): Map<String, Any?> = mapOf(
        "deviceid" to deviceId, "macAddress" to deviceId, "features" to features,
        "model" to "AppleTV3,2", "protovers" to "1.0", "srcvers" to "220.68", "vv" to 2L,
    )
}

data class ReceiverPlay(val url: String, val start: Double, val fraction: Boolean, val iphoneHost: String? = null) {
    companion object {
        fun parse(request: RtspMessage.Request): ReceiverPlay {
            val binary = request.body.take(8).toByteArray().contentEquals("bplist00".toByteArray())
            val fields: Map<*, *> = if (binary) BplistCodec.decode(request.body) as? Map<*, *>
                ?: error("play body must be a dictionary") else request.body.toString(Charsets.UTF_8)
                .lineSequence().mapNotNull { line -> line.indexOf(':').takeIf { it > 0 }?.let {
                    line.substring(0, it).trim() to line.substring(it + 1).trim()
                } }.toMap()
            val url = (fields["Content-Location"] ?: fields["contentLocation"]) as? String ?: error("missing URL")
            val uri = URI(url)
            require(VideoInCar.isPlayableUrl(url, iphoneLoadsAppSchemes = true) && uri.userInfo == null)
            if (uri.scheme?.lowercase() in listOf("http", "https")) require(!uri.host.isNullOrBlank())
            val seconds = fields["Start-Position-Seconds"] ?: fields["startPositionSeconds"]
            val position = seconds ?: fields["Start-Position"] ?: fields["startPosition"]
            val start = if (position == null) 0.0 else requireNotNull(position.toString().toDoubleOrNull())
            require(start.isFinite() && start >= 0 && (seconds != null || start <= 1.0))
            return ReceiverPlay(url, start, seconds == null)
        }
    }
}

data class ReceiverResource(val bytes: ByteArray?, val status: Int?, val location: String?,
                            val headers: Map<String, String> = emptyMap()) {
    /** Only resource metadata crosses FCUP; cookies and authentication never become proxy headers. */
    companion object {
        internal val byteRange = Regex("bytes=(?:[0-9]{1,18}-[0-9]{0,18}|-[0-9]{1,18})")
        internal fun headers(values: Map<*, *>?): Map<String, String> {
            val allowed = listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Deny-Reason")
            return allowed.mapNotNull { name ->
                val entries = values?.entries?.filter { (it.key as? String)?.equals(name, true) == true }.orEmpty()
                val value = entries.singleOrNull()?.value as? String
                value?.takeIf { it.length in 1..1024 && it.none { c -> c == '\r' || c == '\n' || c == '\u0000' } }
                    ?.let { name to it }
            }.toMap()
        }
    }
}

internal fun receiverQuery(path: String): Map<String, String> = path.substringAfter('?', "").split('&')
    .filter { it.contains('=') }.associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8") }

data class ReceiverPlayback(val duration: Double = 0.0, val position: Double = 0.0,
                            val rate: Double = 0.0, val ready: Boolean = false, val buffering: Boolean = false,
                            val bufferedPosition: Double = position, val seekable: Boolean = duration > 0) {
    fun info(): Map<String, Any?> = mapOf(
        // Legacy HTTP video receivers encode these flags as plist integers, as UxPlay does.
        "duration" to duration, "position" to position, "rate" to rate, "readyToPlay" to flag(ready),
        "playbackBufferEmpty" to flag(buffering && bufferedPosition <= position),
        // This describes the current playback buffer, not a complete download of the item.
        "playbackBufferFull" to flag(ready && !buffering && bufferedPosition > position),
        "playbackLikelyToKeepUp" to flag(ready && !buffering),
        "loadedTimeRanges" to if (bufferedPosition > position)
            listOf(mapOf("start" to position, "duration" to bufferedPosition - position)) else emptyList<Map<String, Double>>(),
        "seekableTimeRanges" to if (seekable && duration > 0)
            listOf(mapOf("start" to 0.0, "duration" to duration)) else emptyList<Map<String, Double>>(),
    )

    private fun flag(value: Boolean): Long = if (value) 1L else 0L

    companion object {
        fun supportsRate(rate: Double, allowPause: Boolean = true): Boolean =
            rate.isFinite() && (rate in 0.25..4.0 || allowPause && rate == 0.0)
    }
}
