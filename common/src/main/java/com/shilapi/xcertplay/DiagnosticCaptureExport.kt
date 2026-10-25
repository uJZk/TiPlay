package com.shilapi.xcertplay

import android.app.Activity
import android.widget.Toast
import com.shilapi.xcertplay.host.R
import java.io.File

/** Shared capture export for the main and advanced phone pages. Failed exports retain data. */
internal object DiagnosticCaptureExport {
    @Volatile private var busy = false
    @Synchronized fun save(activity: Activity) {
        if (busy) return
        busy = true
        val context = activity.applicationContext
        Toast.makeText(activity, R.string.saving_report, Toast.LENGTH_SHORT).show()
        Thread({
            val result = runCatching {
                val report = buildString {
                    appendLine("TiPlay Android and browser diagnostic report")
                    DiagnosticLogSnapshot.appendTo(this, File(context.filesDir, "logs"), level = DiagnosticLogLevel.DEBUG)
                }
                DiagnosticReportContent.prepare(context, "TiPlay-${System.currentTimeMillis()}.zip", report, true).use {
                    DiagnosticExportStore.saveWithoutPicker(context, it)
                }
            }
            busy = false
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    result.fold({ BrowserDiagnosticResultUi.saved(activity, it) }, {
                        Toast.makeText(activity, R.string.settings_report_save_failed, Toast.LENGTH_LONG).show()
                    })
                }
            }
        }, "tiplay-capture-export").start()
    }
}
