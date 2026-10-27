package com.shilapi.xcertplay.airplay

/** Incremental iPhone mode evidence, independent of whether it opens an audio stream. */
internal class AirPlayAudioModeDiagnostics {
    private var owner = "unknown"
    private var speechEntity = "unknown"
    private var speechMode: Int? = null
    private var callEntity = "unknown"
    private var callState: Boolean? = null
    private var navigationEntity = "unknown"
    private var navigationState: Boolean? = null
    private var lastLine: String? = null

    @Synchronized fun onModesChanged(params: Map<String, Any?>) {
        // Lists are incremental: a screen-only or speech-only update must preserve audio state.
        for (entry in (params["resources"] as? List<*>).orEmpty()) {
            val resource = entry as? Map<*, *> ?: continue
            if (resource["resourceID"] == "mainAudio" || exact(resource["resourceID"], 2..2) == 2) {
                entity(resource["entity"])?.let { owner = it }
            }
        }
        for (entry in (params["appStates"] as? List<*>).orEmpty()) {
            val app = entry as? Map<*, *> ?: continue
            when (exact(app["appStateID"], 1..3)) {
                1 -> {
                    entity(app["entity"])?.let { speechEntity = it }
                    exact(app["speechMode"], -1..2)?.let { speechMode = it }
                }
                2 -> {
                    entity(app["entity"])?.let { callEntity = it }
                    (app["state"] as? Boolean)?.let { callState = it }
                }
                3 -> {
                    entity(app["entity"])?.let { navigationEntity = it }
                    (app["state"] as? Boolean)?.let { navigationState = it }
                }
            }
        }
    }

    /** Only fixed words, validated numbers and booleans enter Standard logs; repeated states are quiet. */
    @Synchronized fun changed(config: AirPlayConfig, setups: AirPlayAudioSetupDiagnostics.Snapshot): String? {
        val line = "airplay audio modes audioRoute=${AirPlayAudioDiagnostics.route(config)} audioOwner=$owner " +
            "speechEntity=$speechEntity speechMode=${speechMode ?: "unknown"} " +
            "phoneCallEntity=$callEntity phoneCallState=${callState ?: "unknown"} " +
            "navigationEntity=$navigationEntity navigationState=${navigationState ?: "unknown"} " +
            "audioSetups=${setups.count} activeAudioTypes=${setups.activeTypes.joinToString(",").ifEmpty { "none" }}"
        if (line == lastLine) return null
        lastLine = line
        return line
    }

    private fun entity(value: Any?): String? = when (value) {
        "controller", "accessory" -> value as String
        "n/a" -> "unknown"
        else -> when (exact(value, 0..2)) {
            0 -> "unknown"
            1 -> "controller"
            2 -> "accessory"
            else -> null
        }
    }

    private fun exact(value: Any?, range: IntRange): Int? = (value as? Number)?.toDouble()
        ?.takeIf { it.isFinite() && it % 1.0 == 0.0 && it >= range.first && it <= range.last }?.toInt()
}
