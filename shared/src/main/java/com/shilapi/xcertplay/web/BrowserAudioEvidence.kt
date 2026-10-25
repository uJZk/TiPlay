package com.shilapi.xcertplay.web

/** Debug capture only. Waveforms are bytes, never interpolated into metadata log lines. */
internal object BrowserAudioEvidence {
    private const val LIMIT = 12 * 1024
    private val reasons = setOf("frame-discontinuity", "frame-invalid", "callback-budget", "output-edge", "output-invalid",
        "output-range", "packet-gap", "arrival-gap", "packet-reset", "packet-format", "decoder-error", "decoded-range", "decoded-invalid", "processor-error", "clock-step",
        "underrun", "source-deadline", "clock-generation", "suspended", "sender-deadline", "network-buffer", "device-clock-jump")
    private val keys = setOf("schema", "id", "sampleRate", "clock", "causes", "blocks", "incomplete", "attempts", "suppressed",
        "main", "reasonCounts", "pageVersion", "timeOriginMs", "laneFields", "pcmFormat", "waveformOmittedBlocks")
    private val name = Regex("[A-Za-z][A-Za-z0-9_.-]{0,47}")
    private val base64 = Regex("[A-Za-z0-9+/]*={0,2}")
    private fun scalar(value: Any?): Boolean = value == null || value is Boolean ||
        value is Number && value.toDouble().isFinite() && kotlin.math.abs(value.toDouble()) <= 9_007_199_254_740_991.0 ||
        value is String && value.length <= 64 && name.matches(value)
    private fun flat(value: Any?, max: Int): Map<*, *>? = (value as? Map<*, *>)?.takeIf { map ->
        map.size <= max && map.all { (key, item) -> key is String && name.matches(key) && scalar(item) }
    }
    fun parse(value: Any?): Map<String, Any?>? {
        val input = value as? Map<*, *> ?: return null
        if (input.keys.any { it !in keys } || (input["schema"] as? Number)?.toDouble() != 1.0) return null
        fun whole(key: String, minimum: Long = 0, maximum: Long = 9_007_199_254_740_991): Boolean {
            val n = (input[key] as? Number)?.toDouble() ?: return false
            return n.isFinite() && n >= minimum && n <= maximum && n % 1.0 == 0.0
        }
        if (!whole("id", 1) || !whole("sampleRate", 8000, 96000) || !whole("attempts") || !whole("suppressed") ||
            !whole("waveformOmittedBlocks", 0, 6) || input["incomplete"] !is Boolean || input["clock"] !in setOf("monotonic", "wall") ||
            input["pcmFormat"] != "f32le" || flat(input["main"], 96) == null) return null
        if (input["pageVersion"] != null && (input["pageVersion"] !is String || !name.matches(input["pageVersion"] as String))) return null
        if (input["timeOriginMs"] != null && !scalar(input["timeOriginMs"])) return null
        val laneFields = listOf("type", "epoch", "sourceFrame", "inputFrame", "queueBytes", "phaseErrorMs", "appliedPpm", "requestedPpm",
            "ratio", "consumedFrames", "producedFrames", "dspCalls", "sourceTimeMs", "nextPacketFirst", "nextPacketEnd", "tempoActive",
            "inputPeak", "inputMaxStep", "dspPeak", "dspNonFinite", "dspMaxStep")
        if (input["laneFields"] != laneFields) return null
        val causes = input["causes"] as? List<*> ?: return null
        if (causes.isEmpty() || causes.size > 4 || causes.any { flat(it, 48)?.get("reason") !in reasons }) return null
        if (input["reasonCounts"] != null) {
            val counts = input["reasonCounts"] as? Map<*, *> ?: return null
            if (counts.keys.any { it !in reasons } || counts.values.any { it !is Number || !it.toDouble().isFinite() || it.toDouble() < 0 || it.toDouble() % 1.0 != 0.0 }) return null
        }
        val blocks = input["blocks"] as? List<*> ?: return null
        if (blocks.size > 6) return null
        for (raw in blocks) {
            val row = raw as? Map<*, *> ?: return null
            val pcm = row["pcm"] as? String ?: return null
            if (pcm.length > 1368 || pcm.length % 4 != 0 || !base64.matches(pcm) || flat(row - setOf("pcm", "lanes"), 32) == null) return null
            val lanes = row["lanes"] as? List<*> ?: return null
            if (lanes.size > 84 || lanes.size % laneFields.size != 0 || lanes.any { it != null && (it !is Number || !it.toDouble().isFinite() || kotlin.math.abs(it.toDouble()) > 9_007_199_254_740_991.0) }) return null
            fun integer(key: String, max: Int): Int? = (row[key] as? Number)?.toDouble()?.takeIf {
                it.isFinite() && it >= 0 && it <= max && it % 1.0 == 0.0
            }?.toInt()
            val frames = integer("waveFrames", 128) ?: return null
            val channels = integer("waveChannels", 2) ?: return null
            val samples = integer("waveSamples", 256) ?: return null
            if (samples != frames * channels) return null
            if (pcm.isNotEmpty() && try { java.util.Base64.getDecoder().decode(pcm).size != samples * 4 } catch (_: IllegalArgumentException) { true }) return null
        }
        if (WebJson.write(input).toByteArray(Charsets.UTF_8).size > LIMIT) return null
        @Suppress("UNCHECKED_CAST")
        return input as Map<String, Any?>
    }
}
