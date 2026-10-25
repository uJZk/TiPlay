package com.shilapi.xcertplay

import android.app.Activity
import android.content.ClipboardManager
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import java.io.File
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.shilapi.xcertplay.host.R

internal object BrowserDiagnosticResultUi {
    fun saved(activity: Activity, saved: DiagnosticExportStore.SavedReport) {
        val ui = TiPlayNativeUi(activity)
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(24), ui.dp(24), ui.dp(24), ui.dp(24))
            addView(TextView(activity).apply {
                text = saved.savedPath ?: saved.uri.toString()
                setTextIsSelectable(true)
                ui.emphasize(this)
            })
        }
        DiagnosticDialogUi.show(activity, R.string.diagnostic_report_saved, content, listOf(
            DiagnosticDialogUi.Action(R.string.settings_report_copy_path) {
                activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(
                    ClipData.newPlainText(activity.getString(R.string.settings_report_copy_path),
                        saved.savedPath ?: saved.uri.toString()))
                Toast.makeText(activity, R.string.settings_report_path_copied, Toast.LENGTH_SHORT).show()
                false
            },
            DiagnosticDialogUi.Action(R.string.settings_report_open_folder) {
                val opened = runCatching {
                    val folder = folderUri(saved.savedPath) ?: error("Folder unavailable")
                    activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(folder, DocumentsContract.Document.MIME_TYPE_DIR))
                }.isSuccess
                if (!opened) Toast.makeText(activity, R.string.settings_report_open_folder_failed, Toast.LENGTH_LONG).show()
                opened
            },
            DiagnosticDialogUi.Action(R.string.close),
        ))
    }

    /** File managers receive the parent document, never the report file or its MIME type. */
    internal fun folderUri(savedPath: String?): Uri? {
        val folder = savedPath?.let { File(it).parentFile?.canonicalFile } ?: return null
        val primary = Environment.getExternalStorageDirectory().canonicalFile
        val (volume, relative) = if (folder.toPath().startsWith(primary.toPath())) {
            "primary" to folder.relativeTo(primary).path.trim('/')
        } else {
            val parts = folder.path.split('/').filter(String::isNotEmpty)
            if (parts.size < 2 || parts[0] != "storage" || !Regex("[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}").matches(parts[1])) return null
            parts[1] to parts.drop(2).joinToString("/")
        }
        // Android 11+ Files cannot browse another app's private external directory.
        if (Build.VERSION.SDK_INT >= 30 && (relative == "Android/data" || relative.startsWith("Android/data/"))) return null
        return DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "$volume:$relative")
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
