package com.shilapi.xcertplay.web

/** Byte/SDP decisions for original encoded video. No decoder or encoder is used here. */
internal object BrowserRtcVideoPolicy {
    const val TRACK = "webrtc-track-v1"
    const val UNAVAILABLE = "unavailable"
    data class Codec(val name: String, val parameters: Map<String, String>)

    /** One source PTS anchor preserves cadence even when many AUs arrive in one network burst. */
    class SourceClock {
        private var sourceUs: Long? = null
        private var localNanos = 0L
        fun map(timestampUs: Long, firstLocalNanos: Long): Long? {
            if (sourceUs == null) { sourceUs = timestampUs; localNanos = firstLocalNanos }
            return try {
                Math.addExact(localNanos, Math.multiplyExact(Math.subtractExact(timestampUs, sourceUs!!), 1_000L))
                    .takeIf { it >= 0 }
            } catch (_: ArithmeticException) { null }
        }
    }

    fun codecs(sdp: String): List<Codec> {
        val sections = sdp.replace("\r", "").split("\nm=")
        val videos = sections.drop(1).filter { it.startsWith("video ") && active(it) }
        require(videos.size <= 1) { "multiple-video-tracks" }
        val section = videos.singleOrNull() ?: return emptyList()
        val lines = section.lines()
        if (lines.first().split(' ').getOrNull(1) == "0") return emptyList()
        val payloads = lines.first().split(' ').drop(3)
        val names = lines.filter { it.startsWith("a=rtpmap:") }.associate {
            it.substringAfter(':').substringBefore(' ') to it.substringAfter(' ').substringBefore('/').uppercase()
        }
        val parameters = lines.filter { it.startsWith("a=fmtp:") }.associate { line ->
            line.substringAfter(':').substringBefore(' ') to line.substringAfter(' ').split(';').mapNotNull {
                val key = it.substringBefore('=').trim().lowercase()
                if ('=' !in it || key.isEmpty()) null else key to it.substringAfter('=').trim()
            }.toMap()
        }
        return payloads.mapNotNull { payload ->
            val name = names[payload] ?: return@mapNotNull null
            val params = parameters[payload].orEmpty()
            when {
                name == "H264" && params["packetization-mode"] == "1" &&
                    Regex("[0-9a-fA-F]{6}").matches(params["profile-level-id"] ?: "") -> Codec(name, params)
                name == "H265" -> Codec(name, params)
                else -> null
            }
        }.distinct()
    }

    fun receiveOnlyOffer(sdp: String): Boolean {
        val sections = sdp.replace("\r", "").split("\nm=").drop(1)
        val video = sections.filter { it.startsWith("video ") && active(it) }
        return video.size == 1 && video.single().lines().contains("a=recvonly")
    }

    private fun active(section: String) = section.lineSequence().first().split(' ').getOrNull(1) != "0" &&
        !section.lines().contains("a=inactive")

    /** Video replacement must reuse the authenticated DTLS/SCTP/ICE transport, never replace audio. */
    fun validateReplacement(previous: String, replacement: String) {
        require(replacement.length in 1..48 * 1024 && receiveOnlyOffer(replacement)) { "invalid-video-offer" }
        require(replacement.lineSequence().none { it.startsWith("a=candidate:") &&
            (it.contains(" typ relay") || it.contains(" typ srflx")) }) { "non-local-video-offer" }
        fun sections(sdp: String) = sdp.replace("\r", "").split("\nm=")
        fun fingerprints(sdp: String) = sdp.lineSequence().map { it.trim() }.filter { it.startsWith("a=fingerprint:") }.toSet()
        require(fingerprints(previous).isNotEmpty() && fingerprints(previous) == fingerprints(replacement)) { "video-dtls-changed" }
        fun identity(sdp: String): List<List<String>> {
            val parts = sections(sdp)
            val session = parts.first().lines()
            return parts.drop(1).filter { !it.startsWith("video ") }.map { section ->
                val lines = section.lines()
                listOf(section.lineSequence().first()) + listOf("a=mid:", "a=sctp-port:", "a=max-message-size:", "a=setup:").map { prefix ->
                    lines.firstOrNull { it.startsWith(prefix) } ?: session.firstOrNull { it.startsWith(prefix) }.orEmpty()
                } + lines.filter { it in setOf("a=sendrecv", "a=recvonly", "a=sendonly", "a=inactive") }
            }
        }
        require(identity(previous) == identity(replacement)) { "video-shared-transport-changed" }
        fun bundleTransport(sdp: String): List<String> {
            val parts = sections(sdp)
            val session = parts.first().lines()
            val bundled = session.firstOrNull { it.startsWith("a=group:BUNDLE ") }?.substringAfter(' ')?.split(' ').orEmpty()
            require(bundled.isNotEmpty()) { "video-bundle-required" }
            fun mid(section: String) = section.lines().firstOrNull { it.startsWith("a=mid:") }?.substringAfter(':')
            val master = parts.drop(1).firstOrNull { mid(it) == bundled.first() } ?: error("video-bundle-master")
            val protected = parts.drop(1).filter { it.startsWith("application ") || it.startsWith("video ") && active(it) }
            require(protected.isNotEmpty() && protected.all { mid(it) in bundled }) { "video-bundle-required" }
            return listOf("a=ice-ufrag:", "a=ice-pwd:", "a=fingerprint:", "a=setup:").map { prefix ->
                (master.lines().firstOrNull { it.startsWith(prefix) } ?: session.firstOrNull { it.startsWith(prefix) })
                    ?: error("video-transport-identity-missing")
            }
        }
        require(bundleTransport(previous) == bundleTransport(replacement)) { "video-shared-transport-changed" }
    }

    /** Never advertise a profile different from the immutable source bitstream. */
    fun matches(source: String, codec: Codec): Boolean = when {
        source.startsWith("avc1.") && codec.name == "H264" && codec.parameters["packetization-mode"] == "1" -> {
            val actual = source.substringAfter('.').lowercase()
            val negotiated = codec.parameters["profile-level-id"]?.lowercase().orEmpty()
            actual.length == 6 && negotiated.length == 6 &&
                h264Profile(actual) != null && h264Profile(actual) == h264Profile(negotiated) &&
                (actual.takeLast(2).toIntOrNull(16) ?: 256) <= (negotiated.takeLast(2).toIntOrNull(16) ?: -1)
        }
        source.startsWith("hvc1.") && codec.name == "H265" -> {
            val parts = source.split('.')
            val profile = codec.parameters["profile-id"] ?: "1"
            val tier = codec.parameters["tier-flag"] ?: "0"
            val maximum = codec.parameters["level-id"]?.toIntOrNull() ?: 93
            parts.size >= 4 && parts[1] == profile && parts[3].firstOrNull() == (if (tier == "1") 'H' else 'L') &&
                (parts[3].drop(1).toIntOrNull() ?: Int.MAX_VALUE) <= maximum
        }
        else -> false
    }

    private fun h264Profile(value: String): String? {
        val id = value.take(2).toIntOrNull(16) ?: return null
        val flags = value.substring(2, 4).toIntOrNull(16) ?: return null
        return when {
            id == 66 && flags and 0x40 != 0 || id == 77 && flags and 0x80 != 0 || id == 88 && flags and 0xc0 == 0xc0 -> "constrained-baseline"
            id == 66 || id == 88 && flags and 0x80 != 0 -> "baseline"
            id == 77 -> "main"
            id == 100 && flags and 0x0c == 0x0c -> "constrained-high"
            id == 100 -> "high"
            else -> null
        }
    }

    /** A B-slice cannot be assigned capture-order RTP timestamps by the Java encoder bridge. */
    fun hasH264BSlice(bytes: ByteArray): Boolean {
        var cursor = 0
        while (cursor + 3 < bytes.size) {
            if (bytes[cursor] != 0.toByte() || bytes[cursor + 1] != 0.toByte() || bytes[cursor + 2] != 1.toByte()) {
                cursor++; continue
            }
            val type = bytes[cursor + 3].toInt() and 31
            if (type in 1..5) {
                var end = cursor + 4
                while (end + 2 < bytes.size && !(bytes[end] == 0.toByte() && bytes[end + 1] == 0.toByte() &&
                        (bytes[end + 2] == 1.toByte() || end + 3 < bytes.size && bytes[end + 2] == 0.toByte() && bytes[end + 3] == 1.toByte()))) end++
                if (end + 2 >= bytes.size) end = bytes.size
                val rbsp = ArrayList<Int>()
                var zeros = 0
                for (i in cursor + 4 until minOf(end, cursor + 80)) {
                    val value = bytes[i].toInt() and 255
                    if (zeros >= 2 && value == 3) { zeros = 0; continue }
                    rbsp.add(value); zeros = if (value == 0) zeros + 1 else 0
                }
                var bit = 0
                fun readBit(): Int? = if (bit >= rbsp.size * 8) null else (rbsp[bit / 8] shr (7 - bit++ % 8)) and 1
                fun ue(): Int? {
                    var leading = 0
                    while ((readBit() ?: return null) == 0) if (++leading > 30) return null
                    var value = 1
                    repeat(leading) { value = value * 2 + (readBit() ?: return null) }
                    return value - 1
                }
                ue() ?: return true // Malformed/truncated slice: do not risk the RTP path.
                val sliceType = ue() ?: return true
                if (sliceType % 5 == 1) return true
            }
            cursor += 4
        }
        return false
    }

    fun metadata(record: WebVideoRecord, transport: String, reason: String? = null, generation: Int = 1): WebVideoRecord {
        val fields = (WebJson.parse(String(record.payload, Charsets.UTF_8)) as Map<*, *>).entries
            .associate { it.key.toString() to it.value } + mapOf("videoTransport" to transport, "videoTransportReason" to reason,
                "videoGeneration" to generation)
        return WebVideoRecord(record.kind, record.flags, record.codec, record.sequence, record.epoch, record.timestampUs,
            WebJson.write(fields).toByteArray(Charsets.UTF_8))
    }
}
