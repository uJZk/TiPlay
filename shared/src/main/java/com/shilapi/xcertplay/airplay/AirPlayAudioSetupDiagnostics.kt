package com.shilapi.xcertplay.airplay

/** Retains at most four stream types times eight sanitized audio labels, regardless of SETUP count. */
internal class AirPlayAudioSetupDiagnostics {
    private val lock = Any()
    private var count = 0L
    private val labels = linkedSetOf<String>()

    fun record(type: Int, stream: Map<String, Any?>) {
        require(type in AUDIO_STREAM_TYPES)
        val label = AirPlayAudioDiagnostics.streamLabel(type, stream)
        synchronized(lock) {
            count++
            labels.add(label)
        }
    }

    // Closing can race with SETUP. Capture the count and labels at the same boundary; log outside the lock.
    fun snapshot(): Snapshot = synchronized(lock) { Snapshot(count, labels.toList()) }

    class Snapshot(val count: Long, val labels: List<String>) {
        fun summary(config: AirPlayConfig): String =
            "airplay audio summary audioRoute=${AirPlayAudioDiagnostics.route(config)} audioSetups=$count " +
                "streams=${labels.joinToString(",").ifEmpty { "none" }}"
    }

    private companion object {
        // Main, alternate, main high-quality and buffered audio SETUP types.
        val AUDIO_STREAM_TYPES = 100..103
    }
}
