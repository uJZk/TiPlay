package com.shilapi.xcertplay.web

import org.webrtc.RTCStatsReport
import java.util.concurrent.TimeUnit

/** Fixed fields only: native report IDs, SDP, addresses and arbitrary values never leave this helper. */
internal object BrowserRtcVideoDiagnostics {
    private const val TWCC = "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01"
    private const val ABS_SEND_TIME = "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"

    fun negotiation(answer: String, mid: String?, senderExtensions: List<String>): Map<String, Any> {
        val sections = if (answer.length <= 48 * 1024) answer.replace("\r", "").split("\nm=").drop(1) else emptyList()
        val active = sections.filter { section ->
            val lines = section.lineSequence().toList()
            val media = lines.firstOrNull()?.split(' ') ?: emptyList()
            media.firstOrNull() == "video" && media.getOrNull(1)?.toIntOrNull()?.let { it != 0 } == true &&
                lines.none { it == "a=inactive" || it == "a=recvonly" } &&
                (mid == null || lines.any { it == "a=mid:$mid" })
        }
        val lines = active.singleOrNull()?.lineSequence()?.toList() ?: emptyList()
        val payloads = lines.firstOrNull()?.split(' ')?.drop(3) ?: emptyList()
        val primary = payloads.firstOrNull { pt -> lines.any { it.startsWith("a=rtpmap:$pt ") &&
            it.substringAfter(' ').substringBefore('/').uppercase() in setOf("H264", "H265") } }
        fun feedback(name: String) = primary != null && lines.any { it == "a=rtcp-fb:$primary $name" || it == "a=rtcp-fb:* $name" }
        fun extension(uri: String) = lines.any { line ->
            if (!line.startsWith("a=extmap:")) false else {
                val fields = line.split(' ')
                val direction = fields.firstOrNull()?.substringAfter('/', "sendrecv")
                fields.getOrNull(1) == uri && direction in setOf("sendrecv", "sendonly")
            }
        }
        return linkedMapOf("state" to if (active.size == 1) "selected" else if (active.isEmpty()) "no-active-video" else "ambiguous",
            "transportCc" to feedback("transport-cc"), "googRemb" to feedback("goog-remb"),
            "sdpTwcc" to extension(TWCC), "sdpAbsSendTime" to extension(ABS_SEND_TIME),
            "senderTwcc" to senderExtensions.contains(TWCC), "senderAbsSendTime" to senderExtensions.contains(ABS_SEND_TIME))
    }

    /** getStats(sender) scopes the report; codec links still exclude inherited repair streams. */
    fun sender(report: RTCStatsReport): Map<String, Any> {
        val stats = report.statsMap.takeIf { it.size <= 4096 } ?: return mapOf("state" to "oversize")
        val outbound = stats.values.filter { stat ->
            val fields = stat.members
            stat.type == "outbound-rtp" && (fields["kind"] ?: fields["mediaType"]) == "video" && fields["isRemote"] != true &&
                (stats[fields["codecId"] as? String]?.members?.get("mimeType") as? String)?.substringAfter('/')?.lowercase() !in setOf("rtx", "red", "ulpfec", "flexfec-03")
        }
        val result = linkedMapOf<String, Any>("state" to if (outbound.size == 1) "selected" else if (outbound.isEmpty()) "no-outbound" else "ambiguous")
        val selected = outbound.singleOrNull() ?: return result
        fun numbers(prefix: String, fields: Map<String, Any>, names: List<String>, seconds: List<String> = emptyList()) {
            for (name in names) {
                val value = (fields[name] as? Number)?.toDouble() ?: continue
                if (!value.isFinite() || value < 0 || value > 9e12) continue
                result[prefix + name + if (name in seconds) "Ms" else ""] = if (name in seconds) value * 1000 else value
            }
        }
        numbers("out.", selected.members, listOf("packetsSent", "bytesSent", "framesEncoded", "framesSent", "keyFramesEncoded", "targetBitrate",
            "retransmittedPacketsSent", "nackCount", "pliCount", "firCount", "totalPacketSendDelay"), listOf("totalPacketSendDelay"))
        (selected.members["qualityLimitationReason"] as? String)?.takeIf { it in setOf("none", "cpu", "bandwidth", "other") }
            ?.let { result["out.qualityLimitationReason"] = it }
        val remote = stats[selected.members["remoteId"] as? String]?.takeIf { it.type == "remote-inbound-rtp" }
        result["remoteReport"] = remote != null
        remote?.let { numbers("remote.", it.members, listOf("packetsLost", "fractionLost", "reportsReceived", "roundTripTimeMeasurements",
            "roundTripTime", "totalRoundTripTime", "jitter"), listOf("roundTripTime", "totalRoundTripTime", "jitter")) }
        val transport = stats[selected.members["transportId"] as? String]?.takeIf { it.type == "transport" }
        val pair = stats[transport?.members?.get("selectedCandidatePairId") as? String]?.takeIf { it.type == "candidate-pair" }
        result["selectedPair"] = pair != null
        pair?.let { numbers("pair.", it.members, listOf("bytesSent", "bytesReceived", "availableOutgoingBitrate", "currentRoundTripTime",
            "responsesReceived"), listOf("currentRoundTripTime")) }
        return result
    }

    /** One request per interval; timed-out or replaced owners cannot publish late callback results. */
    class Sampler(private val intervalNanos: Long = TimeUnit.SECONDS.toNanos(5)) {
        class Request internal constructor(internal val owner: Any, val generation: Int, val startedNanos: Long)
        private var pending: Request? = null
        private var last: Request? = null
        private var closed = false

        @Synchronized fun begin(owner: Any, generation: Int, now: Long): Request? {
            if (closed) return null
            val previous = last
            if (previous != null && previous.owner === owner && previous.generation == generation && now - previous.startedNanos < intervalNanos) return null
            return Request(owner, generation, now).also { pending = it; last = it }
        }

        @Synchronized fun current(request: Request, owner: Any?, generation: Int, now: Long): Boolean =
            !closed && pending === request && request.owner === owner && request.generation == generation && now - request.startedNanos in 0..intervalNanos

        @Synchronized fun complete(request: Request, owner: Any?, generation: Int, now: Long): Boolean {
            val accepted = current(request, owner, generation, now)
            if (pending === request) pending = null
            return accepted
        }

        @Synchronized fun close() { closed = true; pending = null }
    }
}
