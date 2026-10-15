package com.shilapi.xcertplay.receiver

/** Legacy RTP transport: declared PCM, ALAC, AAC-LC and AAC-ELD are forwarded for browser decoding. */
internal object ReceiverAudioCapabilities {
    // Pinned UxPlay advertises this transport format mask for stream types 100 and 101.
    const val OUTPUT_FORMATS = 0x3fffffcL
    // Only the existing legacy transport is offered; no buffered audio or RFC2198 capability.
    val featureBits: Long = listOf(9, 18, 19, 20, 21).fold(0L) { bits, bit -> bits or (1L shl bit) }

    fun info(): Map<String, Any?> = mapOf(
        "initialVolume" to 0.0,
        "audioFormats" to listOf(100L, 101L).map { type -> mapOf(
            "type" to type, "audioInputFormats" to 0L, "audioOutputFormats" to OUTPUT_FORMATS,
        ) },
        "audioLatencies" to listOf(100L, 101L).map { type -> mapOf(
            "type" to type, "audioType" to "default",
            "inputLatencyMicros" to 0L, "outputLatencyMicros" to 0L,
        ) },
    )

    /** Validate only the accepted wire format, never infer a decoder or microphone capability. */
    fun validateStream(stream: Map<*, *>) {
        require(integer(stream, "type", 0) == 96L) { "unsupported audio stream type" }
        val format = integer(stream, "audioFormat", 0)
        require(format >= 0 && format and OUTPUT_FORMATS.inv() == 0L) { "unsupported audio format" }
        require(ReceiverMirrorAudioFormat.parse(stream) != null) { "unsupported audio codec configuration" }
        require(integer(stream, "controlPort", 0) in 0L..65535L) { "invalid audio control port" }
    }

    private fun integer(stream: Map<*, *>, name: String, default: Long): Long {
        val value = stream[name] ?: return default
        require(value is Byte || value is Short || value is Int || value is Long) { "invalid audio field" }
        return (value as Number).toLong()
    }
}
