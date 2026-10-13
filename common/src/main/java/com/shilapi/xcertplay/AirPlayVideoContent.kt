package com.shilapi.xcertplay

/** App resource URLs do not necessarily carry the extension Media3 uses for source selection. */
internal object AirPlayVideoContent {
    enum class Kind { HLS, OTHER }

    fun kind(bytes: ByteArray): Kind {
        val start = if (bytes.size >= 3 && bytes[0] == 0xef.toByte() &&
            bytes[1] == 0xbb.toByte() && bytes[2] == 0xbf.toByte()) 3 else 0
        val signature = "#EXTM3U".toByteArray(Charsets.US_ASCII)
        return if (bytes.size >= start + signature.size &&
            signature.indices.all { bytes[start + it] == signature[it] }) Kind.HLS else Kind.OTHER
    }
}
