package com.shilapi.xcertplay

import android.content.Context
import android.content.Intent
import android.os.Build
import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment
import com.shilapi.xcertplay.web.BrowserVideoCapabilities

/** Receiver-only comparison mode; persistent sender identity and CarPlay settings stay independent. */
internal object AirPlayMirrorExperimentSettings {
    private const val PREFS = "tiplay_airplay_receiver"
    private const val MODE = "mirror_experiment"

    fun get(context: Context): ReceiverMirrorExperiment = ReceiverMirrorExperiment.fromId(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(MODE, null),
    )

    /** Unknown browser support keeps the existing fallback; a known HEVC-only page cannot take H.264. */
    fun mirrorEnabled(mode: ReceiverMirrorExperiment, capabilities: BrowserVideoCapabilities?): Boolean =
        capabilities?.let { if (mode.h264Only) it.h264 else it.h264 || it.hevc } ?: true

    /** Applying a different mode retires the current ordinary AirPlay session in the existing service. */
    fun set(context: Context, mode: ReceiverMirrorExperiment): Boolean {
        if (get(context) == mode) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(MODE, mode.id).apply()
        if (!AirPlayReceiverSettings.isDisabled(context) && AirPlayPersistence.isPhoneBrowserMode(context) &&
            LocalNetworkPermission.state(context) != LocalNetworkPermission.State.DENIED) {
            val service = Intent(context, AirPlayReceiverService::class.java)
                .setAction(AirPlayReceiverService.ACTION_APPLY_MIRROR_EXPERIMENT)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
        }
        return true
    }
}
