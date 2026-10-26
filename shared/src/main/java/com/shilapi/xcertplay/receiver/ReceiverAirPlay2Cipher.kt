package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream

/** HAP's authenticated 1024-byte framing, with independent read/write nonce counters. */
internal class ReceiverAirPlay2Cipher(readKey: ByteArray, writeKey: ByteArray) : Closeable {
    private val readingKey = readKey.copyOf().also { require(it.size == 32) }
    private val writingKey = writeKey.copyOf().also { require(it.size == 32) }
    private var readCounter = 0L
    private var writeCounter = 0L
    @Volatile private var closed = false
    private val readLock = Any()
    private val writeLock = Any()

    /** Reads exactly one authenticated frame; never reads bytes from the following RTSP message. */
    fun read(input: InputStream): ByteArray? = synchronized(readLock) {
        check(!closed)
        try {
            val low = input.read()
            if (low < 0) return null
            val high = input.read()
            if (high < 0) throw EOFException("truncated AirPlay control header")
            val length = low or (high shl 8)
            require(length in 1..1024) { "invalid AirPlay control frame size" }
            val sealed = ByteArray(length + 16)
            var offset = 0
            while (offset < sealed.size) {
                val count = input.read(sealed, offset, sealed.size - offset)
                if (count < 0) throw EOFException("truncated AirPlay control frame")
                if (count == 0) continue
                offset += count
            }
            check(readCounter != -1L) { "AirPlay control counter exhausted" }
            val bytes = AirPlayCrypto.chachaOpen(readingKey, AirPlayCrypto.nonce64(readCounter), sealed,
                byteArrayOf(low.toByte(), high.toByte()))
            readCounter++
            return bytes
        } catch (error: Exception) {
            close()
            throw IOException("invalid AirPlay encrypted control frame", error)
        }
    }

    fun encrypt(bytes: ByteArray): ByteArray = synchronized(writeLock) {
        check(!closed)
        val output = ByteArrayOutputStream()
        var offset = 0
        try {
            while (offset < bytes.size) {
                check(writeCounter != -1L) { "AirPlay control counter exhausted" }
                val length = minOf(1024, bytes.size - offset)
                val header = byteArrayOf(length.toByte(), (length ushr 8).toByte())
                output.write(header)
                output.write(AirPlayCrypto.chachaSeal(writingKey, AirPlayCrypto.nonce64(writeCounter),
                    bytes.copyOfRange(offset, offset + length), header))
                offset += length
                writeCounter++
            }
            return output.toByteArray()
        } catch (error: Exception) {
            close()
            throw IOException("AirPlay encrypted control write failed", error)
        }
    }

    fun input(raw: InputStream): InputStream = object : InputStream() {
        private var frame = ByteArray(0)
        private var offset = 0
        override fun read(): Int {
            if (offset >= frame.size) {
                frame = this@ReceiverAirPlay2Cipher.read(raw) ?: return -1
                offset = 0
            }
            return frame[offset++].toInt() and 255
        }
        override fun read(bytes: ByteArray, destination: Int, length: Int): Int {
            require(destination >= 0 && length >= 0 && destination <= bytes.size - length)
            if (length == 0) return 0
            val first = read()
            if (first < 0) return -1
            bytes[destination] = first.toByte()
            val remaining = minOf(length - 1, frame.size - offset)
            frame.copyInto(bytes, destination + 1, offset, offset + remaining)
            offset += remaining
            return remaining + 1
        }
    }

    override fun close() {
        closed = true
        readingKey.fill(0)
        writingKey.fill(0)
    }
}
