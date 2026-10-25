package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.widget.TextView
import android.widget.LinearLayout
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R

/** Minimizing only dismisses this window; all ending actions own capture cleanup. */
internal class DiagnosticLogDialog(
    private val activity: Activity,
    private val changed: () -> Unit = {},
    private val perform: (DiagnosticLogAction) -> Unit = { DiagnosticLogActions.perform(activity, it, changed) },
) {
    companion object {
        private var restartPromptClaimed = false
        fun captureStartedInForeground() { restartPromptClaimed = true }
        fun claimRestartPrompt(): Boolean {
            if (restartPromptClaimed || !RawTraffic.enabled) return false
            restartPromptClaimed = true
            return true
        }
    }
    private var dialog: AlertDialog? = null
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private val update = object : Runnable {
        override fun run() {
            if (dialog?.isShowing != true || activity.isDestroyed) return
            val seconds = ((System.currentTimeMillis() - RawTraffic.startedAtMillis) / 1000).coerceAtLeast(0)
            status.text = activity.getString(R.string.settings_capture_progress, seconds / 60, seconds % 60,
                RawTraffic.compressedBytes / 1024) + "\n" +
                activity.getString(if (RawTraffic.integrity()["complete"] == true)
                    R.string.settings_capture_background_hint else R.string.settings_capture_storage_failed)
            handler.postDelayed(this, 1000)
        }
    }
    fun show() {
        if (activity.isFinishing || activity.isDestroyed || dialog?.isShowing == true || DiagnosticLogActions.busy) return
        val debug = AirPlayPersistence.loadDiagnosticLogLevel(activity) == DiagnosticLogLevel.DEBUG
        if (debug) restartPromptClaimed = true
        val ui = TiPlayNativeUi(activity)
        status = TextView(activity).apply {
            val padding = ui.dp(24)
            setPadding(padding, padding, padding, padding)
            if (!debug) setText(R.string.settings_standard_log_description)
        }
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(status)
        }
        if (debug) content.addView(ui.label(activity.getString(R.string.settings_debug_mode_description)).apply {
            setPadding(ui.dp(24), 0, ui.dp(24), ui.dp(16))
        })
        val actions = if (debug) listOf(
            R.string.settings_capture_stop_export to DiagnosticLogAction.STOP_EXPORT,
            R.string.settings_capture_stop_share to DiagnosticLogAction.STOP_SHARE,
            R.string.settings_capture_discard to DiagnosticLogAction.STOP,
            R.string.settings_logs_minimize to null,
        ) else listOf(
            R.string.save to DiagnosticLogAction.SAVE,
            R.string.share to DiagnosticLogAction.SHARE,
            R.string.close to null,
        )
        dialog = DiagnosticDialogUi.show(activity, R.string.settings_view_logs, content,
            actions.map { (title, selected) ->
                DiagnosticDialogUi.Action(title) { selected?.let(perform); true }
            }, onDismiss = { handler.removeCallbacks(update) })
        if (debug) handler.post(update)
    }
    fun close() { dialog?.dismiss(); dialog = null; handler.removeCallbacks(update) }
}
