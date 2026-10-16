package com.shilapi.xcertplay.receiver

/** Legacy RTP formats are offered only when the current browser can decode them. */
internal object ReceiverAudioCapabilities {
    const val OUTPUT_FORMATS = 0x3fffffcL

    fun validateFormats(formats: Long) {
        require(formats >= 0 && formats and OUTPUT_FORMATS.inv() == 0L) { "unsupported audio formats" }
    }

    // Legacy audio-format feature groups follow the same offers as /info, without buffered audio or RFC2198.
    fun featureBits(formats: Long): Long {
        validateFormats(formats)
        if (formats == 0L) return 0L
        var features = (1L shl 9) or (1L shl 22)
        for ((mask, bit) in listOf(0x3fffcL to 18, 0x3c0000L to 19, 0xc00000L to 20, 0x3000000L to 21)) {
            if (formats and mask != 0L) features = features or (1L shl bit)
        }
        return features
    }

    fun info(formats: Long): Map<String, Any?> = mapOf(
        "initialVolume" to 0.0,
        "audioFormats" to listOf(100L, 101L).map { type -> mapOf(
            "type" to type, "audioInputFormats" to 0L, "audioOutputFormats" to formats,
        ) },
        "audioLatencies" to listOf(100L, 101L).map { type -> mapOf(
            "type" to type, "audioType" to "default",
            "inputLatencyMicros" to 0L, "outputLatencyMicros" to 0L,
        ) },
    )

    /** Validate only the accepted wire format, never infer a decoder or microphone capability. */
    fun validateStream(stream: Map<*, *>, formats: Long = OUTPUT_FORMATS) {
        validateFormats(formats)
        require(integer(stream, "type", 0) == 96L) { "unsupported audio stream type" }
        val format = integer(stream, "audioFormat", 0)
        require(format >= 0 && format and OUTPUT_FORMATS.inv() == 0L) { "unsupported audio format" }
        val selected = requireNotNull(ReceiverMirrorAudioFormat.parse(stream)) { "unsupported audio codec configuration" }
        val index = ReceiverMirrorAudioFormat.supported.indexOfFirst {
            it.codec == selected.codec && it.sampleRate == selected.sampleRate &&
                it.channels == selected.channels && it.bitDepth == selected.bitDepth
        }
        require(index >= 0 && formats and (1L shl (index + 2)) != 0L) { "browser cannot decode selected audio format" }
        require(integer(stream, "controlPort", 0) in 0L..65535L) { "invalid audio control port" }
    }

    private fun integer(stream: Map<*, *>, name: String, default: Long): Long {
        val value = stream[name] ?: return default
        require(value is Byte || value is Short || value is Int || value is Long) { "invalid audio field" }
        return (value as Number).toLong()
    }
}
