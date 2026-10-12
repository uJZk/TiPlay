package com.shilapi.xcertplay.network

import android.content.Context
import android.os.Looper
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/** Explicit read of the owner's hotspot via an already chosen root method. Never persists secrets. */
object HotspotConfigurationReader {
    private const val HEADER = "TIPLAY_HOTSPOT_READ_V1"
    private const val MAX_BYTES = 4096
    internal const val TIMEOUT_MILLIS = 8000L

    class Snapshot(val ssid: String, val password: String?) {
        override fun toString() = "Hotspot configuration (redacted)"
    }

    fun readRoot(context: Context): Snapshot? {
        check(Looper.myLooper() != Looper.getMainLooper())
        return runCatching { execute(command(context.applicationContext.packageCodePath)) }.getOrNull()
    }

    internal fun command(apk: String): String {
        require(apk.startsWith('/') && '\u0000' !in apk && '\n' !in apk && '\r' !in apk)
        val quoted = "'" + apk.replace("'", "'\"'\"'") + "'"
        return "CLASSPATH=$quoted app_process /system/bin ${HotspotConfigurationReaderMain::class.java.name}"
    }

    private fun execute(command: String): Snapshot? {
        val process = ProcessBuilder("su").redirectErrorStream(true).start()
        val input = process.inputStream
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(1024)
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MILLIS)
        fun drain(): Boolean {
            while (input.available() > 0) {
                val count = input.read(buffer, 0, minOf(input.available(), buffer.size))
                if (count <= 0) break
                if (output.size() + count > MAX_BYTES) return false
                output.write(buffer, 0, count)
            }
            return true
        }
        try {
            process.outputStream.bufferedWriter().use { it.write("$command\nexit\n") }
            while (System.nanoTime() < deadline) {
                if (!drain()) return null
                if (process.waitFor(20, TimeUnit.MILLISECONDS)) {
                    if (!drain() || process.exitValue() != 0) return null
                    return parse(output.toByteArray().toString(Charsets.UTF_8))
                }
            }
            return null
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            return null
        } finally {
            runCatching { input.close() }
            runCatching { process.outputStream.close() }
            process.destroy()
        }
    }

    internal fun format(ssid: String, password: String?): String =
        "$HEADER|${encode(ssid)}|${password?.let(::encode) ?: "-"}"

    private fun encode(value: String) = value.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it.toInt() and 255) }

    internal fun parse(output: String?): Snapshot? = runCatching {
        val records = output?.lineSequence()?.filter { it.startsWith("$HEADER|") }?.toList() ?: return null
        if (records.size != 1) return null
        val fields = records.single().split('|')
        if (fields.size != 3) return null
        fun decode(value: String): String {
            require(value.length <= 512 && value.length % 2 == 0 && value.all { it in '0'..'9' || it in 'a'..'f' })
            return value.chunked(2).map { it.toInt(16).toByte() }.toByteArray().toString(Charsets.UTF_8)
        }
        val ssid = decode(fields[1])
        require(ssid.isNotBlank() && '\u0000' !in ssid && ssid.toByteArray(Charsets.UTF_8).size <= 32)
        Snapshot(ssid, if (fields[2] == "-") null else decode(fields[2]))
    }.getOrNull()
}
