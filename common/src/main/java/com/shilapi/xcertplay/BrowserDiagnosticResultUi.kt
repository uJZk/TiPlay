package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.shilapi.xcertplay.host.R

internal object BrowserDiagnosticResultUi {
    fun saved(activity: Activity, saved: DiagnosticExportStore.SavedReport) {
        val ui = TiPlayNativeUi(activity)
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(24), ui.dp(8), ui.dp(24), ui.dp(8))
            addView(TextView(activity).apply { setText(R.string.settings_report_saved_at) })
            addView(TextView(activity).apply {
                text = saved.savedPath ?: saved.uri.toString()
                setTextIsSelectable(true)
                ui.emphasize(this)
            })
        }
        AlertDialog.Builder(activity).setView(content)
            .setNeutralButton(R.string.share) { _, _ ->
                share(activity, saved)
            }.setNegativeButton(R.string.done, null).show()
    }
    fun share(activity: Activity, saved: DiagnosticExportStore.SavedReport) {
        runCatching {
            activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = saved.mimeType
                putExtra(Intent.EXTRA_STREAM, saved.uri)
                clipData = ClipData.newRawUri(activity.getString(R.string.report_clip_label), saved.uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, activity.getString(R.string.share_diagnostic_report)))
        }.onFailure {
            Toast.makeText(activity, R.string.settings_logs_action_failed, Toast.LENGTH_LONG).show()
        }
    }
}
