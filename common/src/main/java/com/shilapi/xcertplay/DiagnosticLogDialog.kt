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

/** Minimizing only dismisses this window; all ending actions own capture cleanup. */
internal class DiagnosticLogDialog(
    private val activity: Activity,
    private val changed: () -> Unit = {},
    private val perform: (DiagnosticLogAction) -> Unit = { DiagnosticLogActions.perform(activity, it, changed) },
) {
    companion object {
        private var restartPromptClaimed = false
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
        val builder = AlertDialog.Builder(activity).setTitle(R.string.settings_view_logs).setView(content)
        if (debug) {
            fun action(title: Int, selected: DiagnosticLogAction?) {
                content.addView(Button(activity).apply {
                    setText(title)
                    isAllCaps = false
                    minHeight = ui.dp(48)
                    setOnClickListener {
                        dialog?.dismiss()
                        selected?.let(perform)
                    }
                }, LinearLayout.LayoutParams(-1, -2))
            }
            action(R.string.settings_capture_stop_export, DiagnosticLogAction.STOP_EXPORT)
            action(R.string.settings_capture_stop_share, DiagnosticLogAction.STOP_SHARE)
            action(R.string.settings_capture_discard, DiagnosticLogAction.STOP)
            action(R.string.settings_logs_minimize, null)
        } else {
            builder.setPositiveButton(R.string.save) { _, _ -> perform(DiagnosticLogAction.SAVE) }
                .setNeutralButton(R.string.share) { _, _ -> perform(DiagnosticLogAction.SHARE) }
                .setNegativeButton(R.string.close, null)
        }
        dialog = builder.create().also {
            it.setOnDismissListener { handler.removeCallbacks(update) }
            it.show()
        }
        if (debug) handler.post(update)
    }
    fun close() { dialog?.dismiss(); dialog = null; handler.removeCallbacks(update) }
}
