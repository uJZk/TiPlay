package com.shilapi.xcertplay

import java.io.File

/** Export runs off the main thread, drains accepted work and takes one rotation-consistent snapshot. */
internal object DiagnosticLogSnapshot {
    fun appendTo(report: StringBuilder, directory: File, timeoutMillis: Long = 1_500) {
        val flushed = AsyncDiagnosticLog.awaitIdle(timeoutMillis)
        report.appendLine("--- Log collection ---")
        report.appendLine(DiagnosticLogPolicy.reportLine())
        report.appendLine("LOG_EXPORT queueDrained=$flushed historyFiles=${SessionLogFile.REPORT_NAMES.size} " +
            "maxBytesPerFile=${SessionLogFile.MAX_BYTES} retention=rolling; older history expires")
        synchronized(SessionLogFile.storageLock) {
            report.appendLine(DiagnosticLogs.integrityLine())
            for (name in SessionLogFile.REPORT_NAMES) {
                val file = File(directory, name)
                if (!file.isFile) continue
                report.appendLine("--- $name ---")
                runCatching {
                    file.useLines { lines ->
                        lines.forEach(report::appendLine)
                    }
                }.onFailure { error ->
                    report.appendLine("LOG_EXPORT readFailed=true file=$name exception=" +
                        error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64))
                }
            }
        }
    }
}
