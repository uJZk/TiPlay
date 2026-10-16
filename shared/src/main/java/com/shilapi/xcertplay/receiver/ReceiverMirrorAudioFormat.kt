package com.shilapi.xcertplay.receiver

/** One negotiated wire format, independent of CarPlay's audio codecs. */
data class ReceiverMirrorAudioFormat(
    val codec: Int, val sampleRate: Int, val channels: Int,
    val samplesPerFrame: Int = if (codec == 8) 480 else if (codec == 4) 1024 else 352,
    val bitDepth: Int = 16,
) {
    fun codecConfig(): ByteArray {
        require(codec in listOf(2, 4, 8))
        if (codec == 2) return java.nio.ByteBuffer.allocate(24).apply {
            putInt(samplesPerFrame); put(0); put(bitDepth.toByte()); put(40); put(10); put(14)
            put(channels.toByte()); putShort(255); putInt(0); putInt(0); putInt(sampleRate)
        }.array()
        val index = if (sampleRate == 44100) 4 else 3
        val bits = mutableListOf<Int>()
        fun put(value: Int, length: Int) { for (bit in length - 1 downTo 0) bits += (value ushr bit) and 1 }
        if (codec == 8) { put(31, 5); put(7, 6) } else put(2, 5)
        put(index, 4); put(channels, 4)
        if (codec == 8) {
            put(if (samplesPerFrame == 480) 1 else 0, 1)
            put(0, 3) // section/resilience flags
            put(0, 1) // ldSbrPresentFlag
            put(0, 4) // ELDEXT_TERM
            put(0, 2) // epConfig
        } else { put(if (samplesPerFrame == 960) 1 else 0, 1); put(0, 2) }
        return ByteArray((bits.size + 7) / 8) { byte ->
            (0..7).fold(0) { value, bit -> (value shl 1) or bits.getOrElse(byte * 8 + bit) { 0 } }.toByte()
        }
    }

    companion object {
        /** Keep the wire bit order: PCM 2..17, ALAC 18..21, AAC-LC 22..23 and AAC-ELD 24..25. */
        val supported: List<ReceiverMirrorAudioFormat> = buildList {
            for (rate in listOf(8000, 16000, 24000, 32000, 44100, 48000)) {
                for (depth in if (rate >= 44100) listOf(16, 24) else listOf(16)) {
                    for (channels in 1..2) add(ReceiverMirrorAudioFormat(1, rate, channels, bitDepth = depth))
                }
            }
            for (rate in listOf(44100, 48000)) for (depth in listOf(16, 24))
                add(ReceiverMirrorAudioFormat(2, rate, 2, bitDepth = depth))
            for (codec in listOf(4, 8)) for (rate in listOf(44100, 48000))
                add(ReceiverMirrorAudioFormat(codec, rate, 2))
        }

        fun parse(stream: Map<*, *>): ReceiverMirrorAudioFormat? {
            fun integer(name: String): Int? {
                val value = stream[name] ?: return null
                if (value !is Byte && value !is Short && value !is Int && value !is Long) return null
                return (value as Number).toLong().takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
            }
            for (key in listOf("ct", "sr", "ch", "spf", "ss")) {
                if (stream.containsKey(key) && integer(key) == null) return null
            }
            val rawMask = stream["audioFormat"]
            if (rawMask != null && rawMask !is Byte && rawMask !is Short && rawMask !is Int && rawMask !is Long) return null
            val mask = (rawMask as? Number)?.toLong() ?: 0
            val selected = if (mask == 0L) null else {
                if (mask and ReceiverAudioCapabilities.OUTPUT_FORMATS.inv() != 0L || java.lang.Long.bitCount(mask) != 1) return null
                supported.getOrNull(java.lang.Long.numberOfTrailingZeros(mask) - 2) ?: return null
            }
            val codec = integer("ct")?.takeUnless { it == 0 } ?: selected?.codec ?: return null
            val format = ReceiverMirrorAudioFormat(codec, integer("sr") ?: selected?.sampleRate ?: 44100,
                integer("ch") ?: selected?.channels ?: 2,
                integer("spf")?.takeUnless { it == 0 } ?: if (codec == 8) 480 else if (codec == 4) 1024 else 352,
                integer("ss") ?: selected?.bitDepth ?: 16)
            if (selected != null && (format.codec != selected.codec || format.sampleRate != selected.sampleRate ||
                    format.channels != selected.channels || format.bitDepth != selected.bitDepth)) return null
            if (supported.none { it.codec == format.codec && it.sampleRate == format.sampleRate &&
                    it.channels == format.channels && it.bitDepth == format.bitDepth }) return null
            if (format.samplesPerFrame !in when (codec) { 8 -> listOf(480, 512); 4 -> listOf(960, 1024); else -> 1..4096 }) return null
            return format
        }
    }
}
