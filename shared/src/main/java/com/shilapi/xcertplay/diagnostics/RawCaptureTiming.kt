package com.shilapi.xcertplay.diagnostics

/** Constant-space capture overhead, updated under the journal monitor and read without it.
 * Concurrent status reads are approximate; completed calls are never blocked by a reader.
 */
internal class RawCaptureTiming {
    @Volatile private var calls = 0L
    @Volatile private var waitNanos = 0L
    @Volatile private var appendNanos = 0L
    @Volatile private var waitMaxNanos = 0L
    @Volatile private var appendMaxNanos = 0L
    @Volatile private var waitMaxSource = "none"
    @Volatile private var appendMaxSource = "none"

    fun completed(channel: String, wait: Long, append: Long) {
        val waited = wait.coerceAtLeast(0)
        val appended = append.coerceAtLeast(0)
        waitNanos += waited
        appendNanos += appended
        if (waited > waitMaxNanos || appended > appendMaxNanos) {
            val source = sourceCategory(channel)
            if (waited > waitMaxNanos) { waitMaxSource = source; waitMaxNanos = waited }
            if (appended > appendMaxNanos) { appendMaxSource = source; appendMaxNanos = appended }
        }
        calls++
    }

    fun snapshot(): Map<String, Any> = mapOf(
        "scope" to "current-or-last-capture-session", "completedCalls" to calls,
        "lockWaitTotalMs" to waitNanos / 1e6, "lockWaitMaxMs" to waitMaxNanos / 1e6,
        "appendTotalMs" to appendNanos / 1e6, "appendMaxMs" to appendMaxNanos / 1e6,
        "lockWaitMaxSource" to waitMaxSource, "appendMaxSource" to appendMaxSource,
    )

    companion object {
        private val SOURCES = setOf("capture", "iphone", "browser", "usb", "android-audio", "car-bluetooth")
        fun sourceCategory(channel: String): String = channel.substringBefore('/').takeIf { it in SOURCES } ?: "other"
    }
}
