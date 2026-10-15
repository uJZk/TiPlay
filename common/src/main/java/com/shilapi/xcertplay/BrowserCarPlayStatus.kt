package com.shilapi.xcertplay

import com.shilapi.xcertplay.orchestration.CarPlayStatus
import com.shilapi.xcertplay.host.R

/** The phase used by both the short phone title and the paired browser. */
internal object BrowserCarPlayStatus {
    /** A receiver phase, independent of whether the browser has decoded its first frame. */
    fun phase(status: CarPlayStatus?): String = when (status) {
        CarPlayStatus.DiscoveringIphone -> "searching"
        CarPlayStatus.WaitingForPairedIphone, CarPlayStatus.WaitingForIphone -> "waiting"
        CarPlayStatus.RunningWireless -> "ready"
        CarPlayStatus.ConnectingBluetooth, CarPlayStatus.SelectingConfiguration,
        CarPlayStatus.OpeningDataPaths, CarPlayStatus.Pairing, CarPlayStatus.ConnectingControl,
        CarPlayStatus.AttachingNetwork, CarPlayStatus.RunningControl,
        CarPlayStatus.WirelessActive, CarPlayStatus.WirelessActiveFallback -> "connecting"
        is CarPlayStatus.Failed -> "failed"
        CarPlayStatus.ControlEnded -> "recovering"
        else -> "preparing"
    }

    fun title(phase: String): Int = when (phase) {
        "disabled" -> R.string.settings_carplay_disabled
        "connected" -> R.string.carplay_connected
        "ready" -> R.string.settings_carplay_ready
        "searching" -> R.string.settings_carplay_searching
        "waiting", "blocked" -> R.string.settings_carplay_waiting_status
        "connecting" -> R.string.settings_carplay_connecting_status
        "failed" -> R.string.settings_carplay_failed_status
        "recovering" -> R.string.settings_carplay_recovering_status
        "stopping" -> R.string.settings_carplay_stopping_status
        else -> R.string.settings_carplay_preparing_status
    }
}
