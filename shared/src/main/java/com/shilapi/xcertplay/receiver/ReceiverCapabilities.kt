package com.shilapi.xcertplay.receiver

/** Only ordinary receiver paths implemented by TiPlay belong in its discovery profile. */
internal object ReceiverCapabilities {
    fun features(hevcEnabled: Boolean, mirrorEnabled: Boolean = true,
                 audioOutputFormats: Long = 0L, legacyPairingAdvertised: Boolean = false): Long {
        // Video/HLS, mirror, received metadata, legacy pairing and the shared RTSP audio port.
        // Legacy FairPlay transport authentication is required for mirror setup; it does not promise DRM video.
        val bits = listOf(0, 1, 4, 7, 13, 14, 16, 30)
        val pairing = if (audioOutputFormats != 0L)
            (1L shl 15) or (1L shl 17) else 0L
        // The comparison reoffers the implemented legacy handshake without requiring it.
        // Transient pairing remains available only in the existing audio-only profile.
        val legacyPairing = if (!mirrorEnabled || legacyPairingAdvertised) 1L shl 27 else 0L
        val audioPairing = if (!mirrorEnabled)
            (if (audioOutputFormats != 0L) (1L shl 38) or (1L shl 48) else 0L) else 0L
        val base = bits.filter { mirrorEnabled || it != 7 }.fold(ReceiverAudioCapabilities.featureBits(audioOutputFormats) or pairing or legacyPairing or audioPairing) { mask, bit -> mask or (1L shl bit) }
        return if (hevcEnabled && mirrorEnabled) base or (1L shl 42) else base
    }

    fun txtFeatures(features: Long): String =
        "0x${(features and 0xffff_ffffL).toString(16)},0x${(features ushr 32).toString(16)}"
}
