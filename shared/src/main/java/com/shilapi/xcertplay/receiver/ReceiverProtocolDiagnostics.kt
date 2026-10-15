package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText

/** Control metadata and sanitized failures; headers, payloads, identities and raw URLs stay out. */
internal class ReceiverProtocolDiagnostics(private val log: (String) -> Unit) {
    enum class Stage { ACCEPT, READ, DISPATCH, WRITE, CLOSE }
    enum class ResourceStage { UNAVAILABLE, QUEUED, REQUEST, REUSED, RESPONSE, COMPLETE, TIMEOUT, CANCELLED, FAILURE }

    fun resource(stage: ResourceStage, requestId: Long = 0, status: Int? = null, bytes: Int? = null) {
        emit("resource stage=$stage request=$requestId" + (status?.let { " status=$it" } ?: "") +
            (bytes?.let { " bodyBytes=$it" } ?: ""))
    }

    fun photo(connection: Long, action: String, bytes: Int) {
        val safeAction = action.takeIf { it in setOf("CACHE_ONLY", "DISPLAY", "CACHE_MISS") } ?: "OTHER"
        emit("c=$connection photo stage=$safeAction bodyBytes=$bytes")
    }

    fun play(connection: Long, item: ReceiverPlay) =
        emit("c=$connection video stage=START start=${position(item.start)} fraction=${item.fraction}")

    fun playbackInfo(connection: Long, state: ReceiverPlayback) {
        val info = state.info()
        val full = info["playbackBufferFull"] == 1L
        val flagType = if (info["readyToPlay"] is Long) "INTEGER" else "OTHER"
        emit("c=$connection video stage=PLAYBACK_INFO duration=${position(state.duration)} " +
            "position=${position(state.position)} rate=${position(state.rate)} ready=${state.ready} " +
            "buffering=${state.buffering} bufferedPosition=${position(state.bufferedPosition)} " +
            "bufferFull=$full seekable=${state.seekable} flagType=$flagType")
    }

    fun finish(reason: ReceiverServer.PlaybackFinishReason, reverseConnection: Long?) =
        emit("video stage=FINISH reason=${reason.wire} reverse=${reverseConnection ?: 0}")

    fun playbackEvent(connection: Long?, state: String, category: String = "video") {
        val safeState = state.takeIf { it in setOf("loading", "playing", "paused", "stopped") } ?: "OTHER"
        emit("${if (category == "photo") "photo" else "video"} stage=EVENT state=$safeState reverse=${connection ?: 0} available=${connection != null}")
    }

    fun stage(connection: Long, stage: Stage) = emit("c=$connection stage=$stage")

    fun reverseReply(connection: Long, reply: RtspMessage.Request) {
        val kind = if (reply.method == "EVENT/1.0") "EVENT" else "HTTP"
        val status = reply.path.toIntOrNull()?.takeIf { it in 100..599 }
        emit("c=$connection stage=REVERSE_REPLY kind=$kind status=${status ?: "INVALID"} bodyBytes=${reply.body.size}")
    }

    fun request(connection: Long, request: RtspMessage.Request) {
        val method = request.method.takeIf { it in METHODS } ?: "OTHER"
        val path = receiverRequestPath(request.path).takeIf { it in PATHS } ?: "OTHER"
        emit("c=$connection stage=REQUEST method=$method path=$path bodyBytes=${request.body.size}")
        if (path in ReceiverVideoControlDiagnostics.paths || path == "OTHER") {
            emit("c=$connection stage=VIDEO_CONTROL ${ReceiverVideoControlDiagnostics.describe(request.path)}")
        }
        if (method == "GET_PARAMETER") {
            val parameters = request.body.toString(Charsets.US_ASCII).lineSequence()
                .filter(String::isNotBlank).take(16).map { line ->
                    when (line.substringBefore(':').trim()) {
                        "volume" -> "volume"
                        "progress" -> "progress"
                        else -> "OTHER"
                    }
                }.joinToString(",")
            val contentType = request.headers["content-type"]?.substringBefore(';')?.trim()
            val type = when {
                contentType == null -> "ABSENT"
                contentType.equals("text/parameters", true) -> "TEXT"
                else -> "OTHER"
            }
            emit("c=$connection stage=PARAMETERS names=[$parameters] contentType=$type")
        }
    }

    fun response(connection: Long, response: RtspMessage.Response) =
        emit("c=$connection stage=RESPONSE status=${response.status ?: 200} bodyBytes=${response.body.size}")

    fun failure(connection: Long, stage: Stage, error: Exception) {
        val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64)
        emit("c=$connection stage=$stage exception=$type errorText=${DiagnosticErrorText.sanitize(runCatching { error.message }.getOrNull())}")
    }

    fun setup(connection: Long, dict: Map<*, *>, verified: Boolean, handshakeBytes: Int) {
        val streams = (dict["streams"] as? List<*>)?.take(16)?.map { entry ->
            when (((entry as? Map<*, *>)?.get("type") as? Number)?.toInt()) {
                110 -> "110"
                96 -> "96"
                103 -> "103"
                else -> "OTHER"
            }
        }.orEmpty().joinToString(",")
        (dict["streams"] as? List<*>)?.take(16)?.forEach { entry ->
            val stream = entry as? Map<*, *> ?: return@forEach
            if ((stream["type"] as? Number)?.toInt() == 96) {
                fun bounded(name: String, maximum: Long): String =
                    (stream[name] as? Number)?.toLong()?.takeIf { it in 0..maximum }?.toString() ?: "ABSENT_OR_INVALID"
                emit("c=$connection stage=AUDIO_SETUP ct=${bounded("ct", 255)} " +
                    "audioFormat=${bounded("audioFormat", 0x3fffffc)} spf=${bounded("spf", 65535)}")
            }
        }
        val timingProtocol = when ((dict["timingProtocol"] as? String)?.uppercase()) {
            null -> if (dict.containsKey("timingProtocol")) "OTHER" else "ABSENT"
            "NTP" -> "NTP"
            "PTP" -> "PTP"
            else -> "OTHER"
        }
        emit("c=$connection stage=SETUP verified=$verified handshakeBytes=$handshakeBytes " +
            "ekeyBytes=${(dict["ekey"] as? ByteArray)?.size ?: 0} " +
            "eivBytes=${(dict["eiv"] as? ByteArray)?.size ?: 0} streams=[$streams] " +
            "timingPortProvided=${dict.containsKey("timingPort")} timingPortZero=${(dict["timingPort"] as? Number)?.toInt() == 0} " +
            "timingProtocol=$timingProtocol")
    }

    private fun emit(message: String) { runCatching { log(message) } }

    private fun position(value: Double): String =
        value.takeIf { it.isFinite() && it in 0.0..1_000_000_000.0 }?.toString() ?: "INVALID"

    companion object {
        private val METHODS = setOf("GET", "POST", "PUT", "OPTIONS", "SETUP", "RECORD", "TEARDOWN",
            "GET_PARAMETER", "SET_PARAMETER", "FLUSH", "ANNOUNCE")
        private val PATHS = setOf("/", "/info", "/server-info", "/pair-setup", "/pair-verify", "/fp-setup",
            "/reverse", "/play", "/photo", "/action", "/stop", "/scrub", "/rate", "/playback-info", "/feedback",
            "/getProperty", "/setProperty", "/fp-setup2", "/auth-setup", "/audioMode", "/command", "/event", "/volume")
    }
}
