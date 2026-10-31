package com.shilapi.xcertplay

import android.app.Activity
import android.content.Context
import android.widget.Toast
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R
import java.io.File

internal enum class DiagnosticLogAction(val stops: Boolean = false, val shares: Boolean = false) {
    SAVE, SHARE(shares = true), STOP_EXPORT(stops = true), STOP_SHARE(stops = true, shares = true), STOP(stops = true)
}

/** One serialized path for save/share/stop; exported files are independent of capture cleanup. */
internal object DiagnosticLogActions {
    @Volatile var busy = false
        private set

    @Synchronized fun perform(activity: Activity, action: DiagnosticLogAction, changed: () -> Unit = {},
                              sharePrepared: ((Result<DiagnosticExportStore.SavedReport?>) -> Unit)? = null) {
        if (busy) return
        busy = true
        changed()
        Thread({
            val result = runCatching { execute(activity.applicationContext, action) }
            busy = false
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    changed()
                    if (action.shares) sharePrepared?.invoke(result)
                    result.fold({ saved ->
                        when {
                            saved == null -> Toast.makeText(activity, R.string.settings_capture_cleared, Toast.LENGTH_SHORT).show()
                            action.shares -> BrowserDiagnosticResultUi.share(activity, saved)
                            else -> BrowserDiagnosticResultUi.saved(activity, saved)
                        }
                    }, {
                        Toast.makeText(activity, R.string.settings_logs_action_failed, Toast.LENGTH_LONG).show()
                    })
                }
            }
        }, "tiplay-log-action").start()
    }

    internal fun execute(context: Context, action: DiagnosticLogAction,
        store: (DiagnosticReportContent, Boolean) -> DiagnosticExportStore.SavedReport = { content, share ->
            if (share) DiagnosticExportStore.saveForSharing(context, content)
            else DiagnosticExportStore.saveWithoutPicker(context, content)
        },
    ): DiagnosticExportStore.SavedReport? {
        if (action.stops) AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.STANDARD)
        if (action == DiagnosticLogAction.STOP) {
            RawTraffic.clear()
            return null
        }
        val report = buildString {
            appendLine("TiPlay Android and webpage logs")
            appendLine("--- Previous Java crash ---")
            appendLine(CrashRecord.report(context))
            appendLine("--- Recent process exits ---")
            appendLine(ProcessExitDiagnostics.report(context))
            DiagnosticLogSnapshot.appendTo(this, File(context.filesDir, "logs"),
                level = if (action.stops) DiagnosticLogLevel.DEBUG else DiagnosticLogLevel.STANDARD)
        }
        val name = "TiPlay-${System.currentTimeMillis()}.${if (action.stops) "zip" else "txt"}"
        val saved = DiagnosticReportContent.prepare(context, name, report, action.stops).use {
            store(it, action.shares)
        }
        // Preserve capture on a failed write; clear only once a usable saved/share file exists.
        if (action.stops) RawTraffic.clear()
        return saved
    }
}
