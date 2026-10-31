package com.shilapi.xcertplay.network

import java.io.IOException
import java.io.InputStream
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

/** A status line has a byte budget and one deadline; a slow drip cannot renew the timeout. */
internal fun readBonjourStatusLine(
    input: InputStream,
    timeoutMillis: Long,
    configureTimeout: (Int) -> Unit,
    maxBytes: Int = 1024,
    nanoTime: () -> Long = System::nanoTime,
): String {
    require(timeoutMillis > 0 && maxBytes > 0)
    val deadline = nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
    val line = ByteArray(maxBytes)
    val chunk = ByteArray(minOf(128, maxBytes + 1))
    var size = 0
    while (true) {
        val remaining = deadline - nanoTime()
        if (remaining <= 0) throw SocketTimeoutException("Bonjour status deadline exceeded")
        configureTimeout(((remaining + 999_999L) / 1_000_000L).coerceIn(1, Int.MAX_VALUE.toLong()).toInt())
        val count = input.read(chunk, 0, minOf(chunk.size, maxBytes + 1 - size))
        if (nanoTime() >= deadline) throw SocketTimeoutException("Bonjour status deadline exceeded")
        if (count < 0) throw IOException("Bonjour probe returned an incomplete status line")
        if (count == 0) throw IOException("Bonjour probe made no read progress")
        for (index in 0 until count) {
            val value = chunk[index]
            if (value == '\n'.code.toByte()) {
                val length = if (size > 0 && line[size - 1] == '\r'.code.toByte()) size - 1 else size
                return String(line, 0, length, StandardCharsets.US_ASCII)
            }
            if (size == maxBytes) throw IOException("Bonjour status line exceeds byte limit")
            line[size++] = value
        }
    }
}
