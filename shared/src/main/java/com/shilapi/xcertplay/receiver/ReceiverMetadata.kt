package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.RtspMessage
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** SET_PARAMETER metadata is validated and discarded, like the ordinary audio stream. */
internal object ReceiverMetadata {
    fun receive(request: RtspMessage.Request, log: (String) -> Unit): RtspMessage.Response {
        val type = request.headers["content-type"]?.substringBefore(';')?.trim()?.lowercase()
        val body = request.body
        require(body.size <= 1024 * 1024)
        when (type) {
            "image/jpeg" -> {
                require(body.isEmpty() || (body.size >= 4 && body[0] == 0xff.toByte() &&
                    body[1] == 0xd8.toByte() && body[body.lastIndex - 1] == 0xff.toByte() &&
                    body.last() == 0xd9.toByte()))
                log("metadata kind=ARTWORK_JPEG bodyBytes=${body.size}")
            }
            "image/png" -> {
                val magic = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
                require(body.isEmpty() || (body.size >= magic.size && body.copyOfRange(0, magic.size).contentEquals(magic)))
                log("metadata kind=ARTWORK_PNG bodyBytes=${body.size}")
            }
            "application/x-dmap-tagged" -> {
                val fields = dmapFields(body)
                log("metadata kind=DMAP fields=$fields bodyBytes=${body.size}")
            }
            null, "text/parameters" -> {
                val text = decode(body, 0, body.size, Charsets.US_ASCII)
                val lines = text.lineSequence().map(String::trim).filter(String::isNotEmpty).toList()
                require(lines.size <= 16)
                var progress = false
                for (line in lines) {
                    val key = line.substringBefore(':')
                    val value = line.substringAfter(':', "").trim()
                    when (key) {
                        "volume" -> require(value.toDoubleOrNull()?.isFinite() == true)
                        "progress" -> {
                            val samples = value.split('/')
                            require(samples.size == 3 && samples.all {
                                it.toLongOrNull()?.let { number -> number in 0..0xffff_ffffL } == true
                            })
                            progress = true
                        }
                        else -> return RtspMessage.Response(status = 451, statusText = "Parameter Not Understood")
                    }
                }
                if (progress) log("metadata kind=PROGRESS")
            }
            else -> return RtspMessage.Response(status = 415, statusText = "Unsupported Media Type")
        }
        return RtspMessage.Response()
    }

    private fun dmapFields(body: ByteArray): Int {
        var fields = 0
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
                    decode(body, cursor, size.toInt(), Charsets.UTF_8)
                }
                cursor = next
            }
        }
        parse(0, body.size, 0)
        return fields
    }

    private fun decode(bytes: ByteArray, offset: Int, size: Int, charset: java.nio.charset.Charset): String = try {
        charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, offset, size)).toString()
    } catch (_: java.nio.charset.CharacterCodingException) {
        throw IllegalArgumentException("Invalid metadata encoding")
    }
}
