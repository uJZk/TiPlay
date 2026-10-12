package com.shilapi.xcertplay

import com.shilapi.xcertplay.orchestration.CarPlayStatus

/** Waiting for an arrival or an incoming session is ready, rather than an active search. */
internal object BrowserCarPlayStatus {
    fun waiting(status: CarPlayStatus): Boolean = when (status) {
        CarPlayStatus.WaitingForMfi, CarPlayStatus.MfiReady, CarPlayStatus.WaitingForPairedIphone,
        CarPlayStatus.WaitingForIphone, CarPlayStatus.WaitingForReenumeration, CarPlayStatus.RunningWireless -> true
        else -> false
    }
}
