package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.widget.TextView
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R

/** Dismissal hides UI only; capture belongs to the process, not this window. */
internal class DiagnosticCaptureDialog(private val activity: Activity, private val export: () -> Unit) {
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
        if (!RawTraffic.enabled || activity.isFinishing || activity.isDestroyed || dialog?.isShowing == true) return
        restartPromptClaimed = true
        status = TextView(activity).apply {
            val padding = TiPlayNativeUi(activity).dp(24)
            setPadding(padding, padding, padding, padding)
        }
        dialog = AlertDialog.Builder(activity).setTitle(R.string.settings_capture_running)
            .setView(status)
            .setPositiveButton(R.string.settings_capture_stop_export) { _, _ ->
                AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
                export()
            }.setNegativeButton(R.string.settings_capture_background, null).create().also {
                it.setOnDismissListener { handler.removeCallbacks(update) }
                it.show()
            }
        handler.post(update)
    }
    fun close() { dialog?.dismiss(); dialog = null; handler.removeCallbacks(update) }
}
