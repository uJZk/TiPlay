package com.shilapi.xcertplay.media

/** Claim and revocation share one lock. No platform operation runs under it. */
internal class MicrophoneCaptureLease<T> {
    class Grant<T>(val input: T)
    private var current: Grant<T>? = null
    private var claimed: Grant<T>? = null

    @Synchronized fun offer(input: T): Grant<T> = Grant(input).also { current = it }
    @Synchronized fun claim(): Grant<T>? {
        if (claimed != null) return null
        return current?.also { claimed = it }
    }
    @Synchronized fun revoke() { current = null }
    @Synchronized fun current(grant: Grant<T>): Boolean = current === grant && claimed === grant
    @Synchronized fun finish(grant: Grant<T>) { if (claimed === grant) claimed = null }
    @Synchronized fun retiring(): Boolean = claimed != null
}

internal fun verifiedMicrophoneRoute(expectedPort: Int, actualPort: Int?, actualType: Int?,
    actualAddress: String?, selectedAddress: String?): Boolean = expectedPort > 0 && actualPort != null && actualPort > 0 &&
    actualType == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO &&
    actualPort == expectedPort && bluetoothVoiceAddressIdentity(selectedAddress) == "valid" &&
    sameBluetoothSelection(selectedAddress, actualAddress)
