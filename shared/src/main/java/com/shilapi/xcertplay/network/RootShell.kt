package com.shilapi.xcertplay.network

import android.os.Looper
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Runs one fixed root script through `su` (Magisk, KernelSU …) and reports how it ended.
 *
 * The script goes to `su`'s stdin instead of `su -c`, whose meaning differs between implementations. It may hold only
 * the characters of the validated tokens TiPlay builds (see [HotspotExtraAddress]), so no shell syntax can ever reach the
 * root shell. The separate USB setup uses a fixed script with a validated package name.
 * Blocking, bounded by a timeout, never on the main thread.
 */
object RootShell {
    sealed interface Result {
        /** The script ran as far as the exit marker; [output] is everything it printed before the marker. */
        data class Done(val exitCode: Int, val output: String) : Result
        /** No `su` binary, root refused, or `su` ended without running the script. */
        data object Unavailable : Result
        data object TimedOut : Result
    }

    const val EXIT_MARKER = "TIPLAY_ROOT_EXIT:"
    const val DEFAULT_TIMEOUT_MILLIS = 8_000L
    /** The first call may wait for the root manager's grant dialog. */
    const val PROMPT_TIMEOUT_MILLIS = 30_000L
    private const val MAX_TIMEOUT_MILLIS = 60_000L
    private const val MAX_OUTPUT_CHARS = 16_384
    private const val MAX_OUTPUT_BYTES = MAX_OUTPUT_CHARS * 4
    private const val DRAIN_INTERVAL_MILLIS = 10L

    // Letters, digits, space and `_ . / -`: enough for `id -u` and `ip -4 addr replace A.B.C.D/32 dev IFACE`.
    private val SAFE_SCRIPT = Regex("[A-Za-z0-9_./ -]{1,256}")
    private val MARKER_LINE = Regex("(?m)^" + Regex.escape(EXIT_MARKER) + "([0-9]{1,3})[ \\t\\r]*$")

    /** Runs [script] as root. Throws [IllegalArgumentException] for a script outside the safe character set. */
    fun run(script: String, timeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS): Result {
        check(!onMainThread()) { "RootShell.run must not run on the main thread" }
        return execute(listOf("su"), script, timeoutMillis)
    }

    internal fun execute(command: List<String>, script: String, timeoutMillis: Long): Result {
        require(SAFE_SCRIPT.matches(script)) { "root script holds characters outside the safe set" }
        require(timeoutMillis in 1..MAX_TIMEOUT_MILLIS) { "timeoutMillis must be in 1..$MAX_TIMEOUT_MILLIS" }
        return executeValidated(command, script, timeoutMillis)
    }

    private fun executeValidated(command: List<String>, script: String, timeoutMillis: Long): Result {
        val process = try {
            ProcessBuilder(command).redirectErrorStream(true).start()
        } catch (_: IOException) {
            return Result.Unavailable
        } catch (_: SecurityException) {
            return Result.Unavailable
        }
        // Only read bytes the pipe already has. A blocking reader can outlive a timed-out shell when a
        // descendant inherits stdout; interrupting a Java stream read does not reliably release it.
        val input = process.inputStream
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(1_024)
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
        fun drain() {
            // Bound each pass even if a descendant continuously writes after the direct process exits.
            var remaining = MAX_OUTPUT_BYTES
            while (remaining > 0) {
                val available = input.available()
                if (available == 0) break
                val count = input.read(buffer, 0, minOf(available, buffer.size, remaining))
                if (count <= 0) break
                output.write(buffer, 0, count)
                remaining -= count
                if (output.size() > MAX_OUTPUT_BYTES) {
                    val tail = output.toByteArray()
                    output.reset()
                    output.write(tail, tail.size - MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
                }
            }
        }
        try {
            // The bounded script is smaller than a pipe buffer, including when su refuses to read stdin.
            runCatching { process.outputStream.bufferedWriter().use { it.write(wrap(script)) } }
            while (true) {
                runCatching { drain() }
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) return Result.TimedOut
                if (process.waitFor(minOf(remaining, TimeUnit.MILLISECONDS.toNanos(DRAIN_INTERVAL_MILLIS)),
                        TimeUnit.NANOSECONDS)) {
                    runCatching { drain() }
                    return parse(output.toByteArray().toString(Charsets.UTF_8).takeLast(MAX_OUTPUT_CHARS))
                }
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            return Result.TimedOut
        } finally {
            // No thread is reading these streams, so closing never waits for a descendant's EOF or a reader lock.
            runCatching { input.close() }
            runCatching { process.outputStream.close() }
            runCatching { process.errorStream.close() }
            if (process.isAlive) process.destroyForcibly()
        }
    }

    /** The text written to `su`: the script, then its exit status behind [EXIT_MARKER]. */
    internal fun wrap(script: String): String =
        "$script\nstatus=\$?\nprintf '\\n%s%s\\n' '$EXIT_MARKER' \"\$status\"\nexit\n"

    /** Only the last marker line counts; without one, `su` never ran the script. */
    internal fun parse(output: String): Result {
        val marker = MARKER_LINE.findAll(output).lastOrNull() ?: return Result.Unavailable
        val code = marker.groupValues[1].toIntOrNull() ?: return Result.Unavailable
        return Result.Done(code, output.substring(0, marker.range.first).trim())
    }

    private fun onMainThread(): Boolean =
        runCatching { Looper.getMainLooper()?.isCurrentThread == true }.getOrDefault(false)
}
