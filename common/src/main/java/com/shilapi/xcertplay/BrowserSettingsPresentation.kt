package com.shilapi.xcertplay

import android.app.AlertDialog
import android.content.Context
import android.widget.Button
import com.shilapi.xcertplay.airplay.AirPlayDisplaySettings
import com.shilapi.xcertplay.host.R

/** Browser controls use the same draft and explicit reconnect action as the host menu. */
internal object BrowserSettingsPresentation {
    fun connectionMode(context: Context, wireless: () -> Boolean, changed: (Boolean) -> Unit) = Button(context).apply {
        isAllCaps = false
        fun refresh() {
            text = "${context.getString(R.string.settings_iphone_connection_mode)} · " +
                context.getString(if (wireless()) R.string.default_connection_wireless else R.string.default_connection_usb)
        }
        refresh()
        setOnClickListener {
            AlertDialog.Builder(context)
                .setTitle(R.string.settings_iphone_connection_mode)
                .setSingleChoiceItems(arrayOf(context.getString(R.string.default_connection_wireless),
                    context.getString(R.string.default_connection_usb)), if (wireless()) 0 else 1) { dialog, index ->
                    changed(index == 0)
                    refresh()
                    dialog.dismiss()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .create().also { TiPlayExpressiveUi(context).showDialog(it) }
        }
    }

    fun frameRate(context: Context, current: () -> Int, changed: (Int) -> Unit) = Button(context).apply {
        isAllCaps = false
        fun refresh() { text = "${context.getString(R.string.frame_rate)} · ${current()} fps" }
        refresh()
        setOnClickListener {
            val rates = (AirPlayDisplaySettings.MIN_FPS..AirPlayDisplaySettings.MAX_FPS
                step AirPlayDisplaySettings.FPS_STEP).toList()
            AlertDialog.Builder(context)
                .setTitle(R.string.frame_rate)
                .setSingleChoiceItems(rates.map { "$it fps" }.toTypedArray(), rates.indexOf(current())) { dialog, index ->
                    changed(rates[index])
                    refresh()
                    dialog.dismiss()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .create().also { TiPlayExpressiveUi(context).showDialog(it) }
        }
    }

    fun summary(context: Context, fps: Int, hevc: Boolean, widthMm: Int): String {
        val canvas = TeslaBrowserCanvas.plan(TeslaBrowserLink.lastViewport(context), widthMm)
        return buildString {
            append(context.getString(R.string.settings_browser_canvas)).append(": ")
                .append(canvas.width).append(" × ").append(canvas.height).append('\n')
            append(context.getString(R.string.preview_frame_rate)).append(fps).append(" fps\n")
            append(context.getString(R.string.preview_video_transport)).append(if (hevc) "HEVC (H.265)" else "H.264")
        }
    }
}
