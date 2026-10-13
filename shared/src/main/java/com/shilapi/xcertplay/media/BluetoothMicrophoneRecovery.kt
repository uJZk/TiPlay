package com.shilapi.xcertplay.media

/** Bounded recovery of missing capture data; silence containing PCM is healthy input. */
internal class BluetoothMicrophoneRecovery(private val now: () -> Long = System::nanoTime) {
    enum class Action { CONTINUE, WAIT, RESTART, FAIL }
    private var lastAudio = now()
    var restarts = 0
        private set

    fun read(count: Int): Action {
        val current = now()
        if (count > 0) {
            lastAudio = current
            return Action.CONTINUE
        }
        if (count == 0 && current - lastAudio < 1_000_000_000L) return Action.WAIT
        if (restarts >= 3) return Action.FAIL
        restarts++
        lastAudio = current
        return Action.RESTART
    }
}
