package com.shilapi.xcertplay

import java.io.Closeable
import java.io.File
import java.util.concurrent.atomic.AtomicLong

/** Private rolling metadata logs. Pending accepted writes retain their target through close. */
internal class SessionLogFile(val file: File) : Closeable {
    private val stateLock = Any()
    private var closing = false
    private var pending = 0
    private val written = AtomicLong()
    private val filtered = AtomicLong()
    private val privacyFiltered = AtomicLong()
    private val dropped = AtomicLong()
    private val writeFailures = AtomicLong()
    private val rejectedAfterClose = AtomicLong()
    @Volatile private var lastFailure = "none"
    private var reportedLoss = 0L // guarded by storageLock

    fun reset(header: String) = synchronized(storageLock) {
        if (synchronized(stateLock) { closing }) return@synchronized
        runCatching {
            val directory = file.parentFile
            if (directory != null && !directory.isDirectory && !directory.mkdirs()) {
                throw java.io.IOException("Diagnostic storage unavailable")
            }
            rotate()
            file.writeText("")
        }.onFailure(::recordWriteFailure)
        append(header)
    }

    fun append(line: String) {
        val safe = prepare(line) ?: return
        if (!reserve()) return
        try {
            appendReserved(safe)
        } finally {
            complete()
        }
    }

    internal fun prepare(message: String): String? {
        val safe = DiagnosticRedactor.redact(message)
        if (safe == null) {
            privacyFiltered.incrementAndGet()
            return null
        }
        if (!DiagnosticLogPolicy.shouldRecord(safe)) {
            filtered.incrementAndGet()
            return null
        }
        return safe
    }

    internal fun reserve(): Boolean = synchronized(stateLock) {
        if (closing) {
            rejectedAfterClose.incrementAndGet()
            return@synchronized false
        }
        pending++
        true
    }

    internal fun appendReserved(safe: String) = synchronized(storageLock) {
        runCatching {
            val lost = dropped.get() + writeFailures.get() + rejectedAfterClose.get()
            // Persist recovery evidence so a later process can still see earlier logging gaps.
            val marker = if (lost > reportedLoss) "LOG_INTEGRITY_LOSS queueDropped=${dropped.get()} " +
                "writeFailures=${writeFailures.get()} rejectedAfterClose=${rejectedAfterClose.get()} " +
                "coverage=partial scope=acceptedMetadata retention=rolling\n" else ""
            val bytes = (marker + safe + "\n").toByteArray(Charsets.UTF_8)
            if (file.length() + bytes.size > MAX_BYTES) {
                rotate()
                file.writeText("LOG_CONTINUATION retention=rolling\n")
            }
            file.appendBytes(bytes)
            reportedLoss = lost
            written.incrementAndGet()
        }.onFailure(::recordWriteFailure)
        Unit
    }

    internal fun complete(droppedFromQueue: Boolean = false) {
        if (droppedFromQueue) dropped.incrementAndGet()
        synchronized(stateLock) { pending-- }
    }

    internal fun recordWriteFailure(error: Throwable) {
        writeFailures.incrementAndGet()
        lastFailure = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64).ifEmpty { "OTHER" }
    }

    fun integrityLine(): String {
        val (pendingCount, closingNow) = synchronized(stateLock) { pending to closing }
        val lost = dropped.get() + writeFailures.get() + rejectedAfterClose.get()
        return "LOG_INTEGRITY written=${written.get()} filtered=${filtered.get()} privacyFiltered=${privacyFiltered.get()} " +
            "queueDropped=${dropped.get()} writeFailures=${writeFailures.get()} rejectedAfterClose=${rejectedAfterClose.get()} " +
            "pending=$pendingCount closing=$closingNow coverage=${if (lost == 0L && pendingCount == 0) "complete" else "partial"} " +
            "lastWriteFailure=$lastFailure scope=acceptedMetadata retention=rolling"
    }

    private fun rotate() {
        if (!file.exists() || file.length() == 0L) return
        for (index in ARCHIVE_NAMES.lastIndex downTo 1) {
            val source = File(file.parentFile, ARCHIVE_NAMES[index - 1])
            val destination = File(file.parentFile, ARCHIVE_NAMES[index])
            if (source.exists()) source.copyTo(destination, overwrite = true)
        }
        file.copyTo(File(file.parentFile, ARCHIVE_NAMES.first()), overwrite = true)
    }
    /** Reject new entries; entries already accepted by the async queue can still finish. */
    override fun close() { synchronized(stateLock) { closing = true } }

    companion object {
        // Covers rotation and report snapshots across old and new target objects.
        internal val storageLock = Any()
        const val MAX_BYTES = 512 * 1024L
        private val ARCHIVE_NAMES = listOf("previous.log") + (2..7).map { "previous-$it.log" }
        val REPORT_NAMES = ARCHIVE_NAMES.reversed() + "diplay.log"
    }
}
