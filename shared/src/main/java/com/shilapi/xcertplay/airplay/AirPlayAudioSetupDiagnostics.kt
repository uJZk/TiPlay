package com.shilapi.xcertplay.airplay

/** Retains at most four stream types times eight sanitized audio labels, regardless of SETUP count. */
internal class AirPlayAudioSetupDiagnostics {
    private val lock = Any()
    private var count = 0L
    private val labels = linkedSetOf<String>()
    private val activeTypes = sortedSetOf<Int>()
    private var closed = false

    fun record(type: Int, stream: Map<String, Any?>, accepted: Boolean = false) {
        require(type in AUDIO_STREAM_TYPES)
        val label = AirPlayAudioDiagnostics.streamLabel(type, stream)
        synchronized(lock) {
            count++
            labels.add(label)
            if (accepted && !closed) activeTypes.add(type)
        }
    }

    fun retire(types: List<Int>? = null) = synchronized(lock) {
        if (types == null) activeTypes.clear() else activeTypes.removeAll(types.toSet())
    }

    fun close() = synchronized(lock) {
        closed = true
        activeTypes.clear()
    }

    // Closing can race with SETUP. Capture the count and labels at the same boundary; log outside the lock.
    fun snapshot(): Snapshot = synchronized(lock) { Snapshot(count, labels.toList(), activeTypes.toList()) }

    class Snapshot(val count: Long, val labels: List<String>, val activeTypes: List<Int>) {
        fun summary(config: AirPlayConfig): String =
            "airplay audio summary audioRoute=${AirPlayAudioDiagnostics.route(config)} audioSetups=$count " +
                "streams=${labels.joinToString(",").ifEmpty { "none" }}"
    }

    private companion object {
        // Main, alternate, main high-quality and buffered audio SETUP types.
        val AUDIO_STREAM_TYPES = 100..103
    }
}
