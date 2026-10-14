package com.shilapi.xcertplay

import android.content.Context
import android.os.Process
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** One log target per app process, shared by UI, background CarPlay and ordinary AirPlay. */
internal object DiagnosticLogs {
    private val initializationLock = Any()
    @Volatile private var current: SessionLogFile? = null

    fun initialize(context: Context, level: DiagnosticLogLevel = DiagnosticLogPolicy.level): SessionLogFile =
        synchronized(initializationLock) {
            DiagnosticLogPolicy.level = level
            current?.let { return@synchronized it }
            val log = SessionLogFile(File(context.applicationContext.filesDir, "logs/diplay.log"))
            log.reset("TiPlay log started ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS Z", Locale.US).format(Date())} " +
                "pid=${Process.myPid()} detail=${level.key} lifecycle=process")
            current = log
            log
        }

    fun append(message: String) = AsyncDiagnosticLog.append(current, message)

    fun integrityLine(): String = current?.integrityLine() ?: "LOG_INTEGRITY initialized=false coverage=unavailable"

    internal fun resetForTest() {
        check(AsyncDiagnosticLog.awaitIdle(2_000))
        synchronized(initializationLock) {
            current?.close()
            current = null
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
        }
    }
}
