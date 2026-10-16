package com.shilapi.xcertplay.transport

/** One pending availability reply; a display loan must not require the iPhone to repeat it. */
internal class WirelessStartSessionRequest(
    private val allowed: () -> Boolean,
    private val beforeSend: () -> Unit,
    private val send: () -> Unit,
) {
    private var pending = false

    fun request() { pending = true }

    fun dispatch(): Boolean {
        if (!pending || !allowed()) return false
        beforeSend()
        // Hotspot validation can overlap a new AirPlay request. Admit the actual send last.
        if (!allowed()) return false
        send()
        pending = false
        return true
    }
}
