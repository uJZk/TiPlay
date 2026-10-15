package com.shilapi.xcertplay

import android.app.Activity
import android.widget.Toast
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R

internal object DiagnosticCaptureClearUi {
    fun clear(activity: Activity) {
        Thread({
            val result = runCatching { RawTraffic.clear() }
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) Toast.makeText(activity,
                    if (result.isSuccess) R.string.settings_capture_cleared else R.string.settings_capture_clear_failed,
                    Toast.LENGTH_LONG).show()
            }
        }, "tiplay-clear-capture").start()
    }
}
