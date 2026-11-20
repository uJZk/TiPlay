package com.shilapi.xcertplay.receiver

/** Independent ordinary-AirPlay comparisons; CarPlay and audio routing do not use these modes. */
enum class ReceiverMirrorExperiment(val id: String) {
    BASELINE("baseline"),
    H264_ONLY("h264_only"),
    NO_BLE("no_ble"),
    LEGACY_PAIRING("legacy_pairing");

    val h264Only: Boolean get() = this == H264_ONLY
    val bluetoothDiscoveryEnabled: Boolean get() = this != NO_BLE
    val legacyPairingAdvertised: Boolean get() = this == LEGACY_PAIRING

    companion object {
        fun fromId(id: String?): ReceiverMirrorExperiment = entries.firstOrNull { it.id == id } ?: BASELINE
    }
}
