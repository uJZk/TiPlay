package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** A sender update: null fields are absent; empty text and artwork explicitly clear old values. */
data class ReceiverAudioMetadataUpdate(
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val durationMillis: Long? = null,
    val artwork: ReceiverAudioArtwork? = null,
    val progress: ReceiverAudioProgress? = null,
)

data class ReceiverAudioArtwork(val bytes: ByteArray, val contentType: String?)

/** Unsigned wire RTP coordinates. A consumer must unwrap them with the negotiated sample rate. */
data class ReceiverAudioProgress(val start: Long, val current: Long, val end: Long)

/** SET_PARAMETER metadata is validated atomically without changing local volume or transport. */
internal object ReceiverMetadata {
    fun receive(request: RtspMessage.Request, log: (String) -> Unit): RtspMessage.Response =
        receive(request, log, {})

    fun receive(request: RtspMessage.Request, log: (String) -> Unit,
                update: (ReceiverAudioMetadataUpdate) -> Unit): RtspMessage.Response {
        val type = request.headers["content-type"]?.substringBefore(';')?.trim()?.lowercase()
        val body = request.body
        require(body.size <= 1024 * 1024)
        val parsed = when (type) {
            "image/jpeg" -> {
                require(body.isEmpty() || (body.size >= 4 && body[0] == 0xff.toByte() &&
                    body[1] == 0xd8.toByte() && body[body.lastIndex - 1] == 0xff.toByte() &&
                    body.last() == 0xd9.toByte()))
                log("metadata kind=ARTWORK_JPEG bodyBytes=${body.size}")
                artwork(body, type)
            }
            "image/png" -> {
                val magic = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
                require(body.isEmpty() || (body.size >= magic.size && body.copyOfRange(0, magic.size).contentEquals(magic)))
                log("metadata kind=ARTWORK_PNG bodyBytes=${body.size}")
                artwork(body, type)
            }
            "image/none" -> {
                require(body.isEmpty())
                log("metadata kind=ARTWORK_CLEAR bodyBytes=0")
                artwork(body, null)
            }
            "application/x-dmap-tagged" -> {
                val (fields, metadata) = dmap(body)
                log("metadata kind=DMAP fields=$fields bodyBytes=${body.size}")
                metadata
            }
            null, "text/parameters" -> {
                val text = decode(body, 0, body.size, Charsets.US_ASCII)
                val lines = text.lineSequence().map(String::trim).filter(String::isNotEmpty).toList()
                require(lines.size <= 16)
                var progress: ReceiverAudioProgress? = null
                val keys = mutableSetOf<String>()
                for (line in lines) {
                    val key = line.substringBefore(':')
                    val value = line.substringAfter(':', "").trim()
                    require(keys.add(key)) { "duplicate metadata parameter" }
                    when (key) {
                        // Local browser/vehicle gain owns volume; this compatibility command has no side effect.
                        "volume" -> require(value.toDoubleOrNull()?.isFinite() == true)
                        "progress" -> {
                            val samples = value.split('/')
                            require(samples.size == 3 && samples.all {
                                it.matches(Regex("[0-9]{1,10}")) &&
                                    it.toLongOrNull()?.let { number -> number in 0..0xffff_ffffL } == true
                            })
                            progress = ReceiverAudioProgress(samples[0].toLong(), samples[1].toLong(), samples[2].toLong())
                        }
                        else -> return RtspMessage.Response(status = 451, statusText = "Parameter Not Understood")
                    }
                }
                if (progress != null) log("metadata kind=PROGRESS")
                ReceiverAudioMetadataUpdate(progress = progress)
            }
            else -> return RtspMessage.Response(status = 415, statusText = "Unsupported Media Type")
        }
        if (parsed != ReceiverAudioMetadataUpdate()) update(parsed)
        return RtspMessage.Response()
    }

    private fun artwork(bytes: ByteArray, type: String?) = ReceiverAudioMetadataUpdate(
        artwork = ReceiverAudioArtwork(bytes.copyOf(), if (bytes.isEmpty()) null else type),
    )

    private fun dmap(body: ByteArray): Pair<Int, ReceiverAudioMetadataUpdate> {
        var fields = 0
        val text = mutableMapOf<String, String>()
        var duration: Long? = null
        fun parse(start: Int, end: Int, depth: Int) {
            require(depth <= 8)
            var cursor = start
            while (cursor < end) {
                require(end - cursor >= 8 && ++fields <= 1024)
                val tag = body.copyOfRange(cursor, cursor + 4).toString(Charsets.US_ASCII)
                require(tag.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' })
                var size = 0L
                for (index in cursor + 4 until cursor + 8) size = (size shl 8) or (body[index].toLong() and 255)
                cursor += 8
                require(size <= end - cursor)
                val next = cursor + size.toInt()
                if (tag in setOf("mlit", "mdcl", "mlcl", "msrv", "mupd", "mcon")) {
                    parse(cursor, next, depth + 1)
                } else if (tag in setOf("minm", "asar", "asal", "asgn")) {
                    require(size <= 4096)
                    val value = decode(body, cursor, size.toInt(), Charsets.UTF_8)
                        .filterNot(Char::isISOControl).trim()
                    require(text.put(tag, value) == null) { "duplicate metadata field" }
                } else if (tag == "astm") {
                    require(size == 4L && duration == null)
                    duration = (cursor until next).fold(0L) { value, index ->
                        (value shl 8) or (body[index].toLong() and 255)
                    }
                }
                cursor = next
            }
        }
        parse(0, body.size, 0)
        return fields to ReceiverAudioMetadataUpdate(title = text["minm"], artist = text["asar"],
            album = text["asal"], durationMillis = duration)
    }

    private fun decode(bytes: ByteArray, offset: Int, size: Int, charset: java.nio.charset.Charset): String = try {
        charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, offset, size)).toString()
    } catch (_: java.nio.charset.CharacterCodingException) {
        throw IllegalArgumentException("Invalid metadata encoding")
    }
}
