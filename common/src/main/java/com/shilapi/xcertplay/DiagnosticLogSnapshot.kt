package com.shilapi.xcertplay

import java.io.File
import java.util.concurrent.TimeUnit

/** Export runs off the main thread, drains accepted work and takes one rotation-consistent snapshot. */
internal object DiagnosticLogSnapshot {
    fun appendTo(report: StringBuilder, directory: File, timeoutMillis: Long = 1_500,
                 level: DiagnosticLogLevel = DiagnosticLogPolicy.level) {
        val deadline = System.nanoTime() + timeoutMillis.coerceAtLeast(0) * 1_000_000L
        val flushed = AsyncDiagnosticLog.awaitIdle(timeoutMillis)
        report.appendLine("--- Log collection ---")
        report.appendLine(DiagnosticLogPolicy.reportLine(level))
        report.appendLine("LOG_EXPORT queueDrained=$flushed historyFiles=${SessionLogFile.REPORT_NAMES.size} " +
            "maxBytesPerFile=${SessionLogFile.MAX_BYTES} retention=rolling; older history expires")
        val locked = try {
            SessionLogFile.storageLock.tryLock((deadline - System.nanoTime()).coerceAtLeast(0), TimeUnit.NANOSECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
        if (!locked) {
            report.appendLine("LOG_EXPORT historySkipped=true reason=storage-lock-unavailable coverage=partial")
            return
        }
        try {
            report.appendLine(DiagnosticLogs.integrityLine())
            for (name in SessionLogFile.REPORT_NAMES) {
                if (System.nanoTime() >= deadline) {
                    report.appendLine("LOG_EXPORT historySkipped=true reason=snapshot-deadline coverage=partial")
                    break
                }
                val file = File(directory, name)
                if (!file.isFile) continue
                report.appendLine("--- $name ---")
                runCatching {
                    file.useLines { lines ->
                        lines.forEach { line ->
                            val selected = if (level == DiagnosticLogLevel.DEBUG) line
                                else DiagnosticRedactor.redact(line)?.takeIf {
                                    DiagnosticLogPolicy.shouldRecord(it, DiagnosticLogLevel.STANDARD)
                                }
                            selected?.let(report::appendLine)
                        }
                    }
                }.onFailure { error ->
                    report.appendLine("LOG_EXPORT readFailed=true file=$name exception=" +
                        error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64))
                }
            }
        } finally { SessionLogFile.storageLock.unlock() }
    }
}
