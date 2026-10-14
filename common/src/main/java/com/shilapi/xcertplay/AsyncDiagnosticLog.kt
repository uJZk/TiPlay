package com.shilapi.xcertplay

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Queued entries retain only their exact file target and a redacted, bounded metadata string. */
internal object AsyncDiagnosticLog {
    private data class Entry(val target: SessionLogFile, val line: String)
    private val writer = BoundedDiagnosticWriter<Entry>(
        onDropped = { it.target.complete(droppedFromQueue = true) },
        onWriteFailure = { it.target.recordWriteFailure(IllegalStateException()) },
    ) { entry ->
        try {
            entry.target.appendReserved(entry.line)
        } finally {
            entry.target.complete()
        }
    }

    fun append(target: SessionLogFile?, message: String, nowMillis: Long = System.currentTimeMillis()) {
        if (target == null) return
        val safe = target.prepare(message) ?: return
        val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS Z", Locale.US).format(Date(nowMillis))
        if (!target.reserve()) return
        val enqueued = runCatching { writer.enqueue(Entry(target, "$timestamp  $safe")) }.getOrDefault(false)
        if (!enqueued) target.complete(droppedFromQueue = true)
    }

    internal fun awaitIdle(timeoutMillis: Long): Boolean = writer.awaitIdle(timeoutMillis)
}
