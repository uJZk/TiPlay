package com.shilapi.xcertplay.receiver

/** Only ordinary receiver paths implemented by TiPlay belong in its discovery profile. */
internal object ReceiverCapabilities {
    fun features(hevcEnabled: Boolean, mirrorEnabled: Boolean = true): Long {
        // Video/HLS, mirror, received metadata, legacy pairing and the shared RTSP audio port.
        // Legacy FairPlay transport authentication is required for mirror setup; it does not promise DRM video.
        val bits = listOf(0, 1, 4, 7, 13, 14, 16, 22, 27, 30)
        val base = bits.filter { mirrorEnabled || it != 7 }.fold(ReceiverAudioCapabilities.featureBits) { mask, bit -> mask or (1L shl bit) }
        return if (hevcEnabled && mirrorEnabled) base or (1L shl 42) else base
    }

    fun txtFeatures(features: Long): String =
        "0x${(features and 0xffff_ffffL).toString(16)},0x${(features ushr 32).toString(16)}"
}
