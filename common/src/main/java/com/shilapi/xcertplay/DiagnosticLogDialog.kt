package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.widget.TextView
import android.widget.LinearLayout
import android.widget.Button
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R

/** Closing the window leaves any unfinished capture intact. */
internal class DiagnosticLogDialog(
    private val activity: Activity,
    private val changed: () -> Unit = {},
    private val perform: (DiagnosticLogAction) -> Unit = { DiagnosticLogActions.perform(activity, it, changed) },
    private val prepareShare: (DiagnosticLogAction, (Result<DiagnosticExportStore.SavedReport?>) -> Unit) -> Unit =
        { action, completed -> DiagnosticLogActions.perform(activity, action, changed, completed) },
    private val shareAgain: (DiagnosticExportStore.SavedReport) -> Unit = { BrowserDiagnosticResultUi.share(activity, it) },
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
    private var sharedReport: DiagnosticExportStore.SavedReport? = null
    private var preparingShare = false
    private var dialogEpoch = 0L
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
        val epoch = ++dialogEpoch
        sharedReport = null
        preparingShare = false
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
            R.string.close to null,
        ) else listOf(
            R.string.save to DiagnosticLogAction.SAVE,
            R.string.share to DiagnosticLogAction.SHARE,
            R.string.close to null,
        )
        dialog = DiagnosticDialogUi.show(activity, R.string.settings_view_logs, content,
            actions.map { (title, selected) ->
                DiagnosticDialogUi.Action(title) {
                    when {
                        selected == null -> true
                        selected.shares -> {
                            val saved = sharedReport
                            if (saved != null) shareAgain(saved)
                            else if (!preparingShare && !DiagnosticLogActions.busy) {
                                preparingShare = true
                                prepareShare(selected) { result ->
                                    if (dialogEpoch == epoch) preparingShare = false
                                    result.getOrNull()?.takeIf { dialogEpoch == epoch }?.let { report ->
                                        sharedReport = report
                                        if (dialog?.isShowing == true) {
                                            handler.removeCallbacks(update)
                                            status.setText(R.string.diagnostic_report_saved)
                                            dialog?.window?.decorView?.findViewWithTag<Button>(title)
                                                ?.setText(R.string.settings_report_share_again)
                                            if (debug) dialog?.window?.decorView
                                                ?.findViewWithTag<Button>(R.string.settings_capture_stop_export)?.isEnabled = false
                                        }
                                    }
                                }
                            }
                            false
                        }
                        else -> { perform(selected); true }
                    }
                }
            }, onDismiss = { dialogEpoch++; handler.removeCallbacks(update) })
        if (debug) handler.post(update)
    }
    fun close() { dialog?.dismiss(); dialog = null; handler.removeCallbacks(update) }
}
