package com.shilapi.xcertplay.network

import android.net.wifi.WifiInfo
import com.shilapi.xcertplay.orchestration.ManualHotspotSecurity
import com.shilapi.xcertplay.transport.Iap2WirelessSecurity
import java.io.IOException

/** A transition AP can negotiate either PSK or SAE; both are valid for that selected mode. */
internal object ExistingWifiSecurity {
    fun validate(selected: ManualHotspotSecurity, observed: Int) {
        if (observed == WifiInfo.SECURITY_TYPE_UNKNOWN) return
        val matches = when (selected) {
            ManualHotspotSecurity.OPEN -> observed == WifiInfo.SECURITY_TYPE_OPEN
            ManualHotspotSecurity.WPA2 -> observed == WifiInfo.SECURITY_TYPE_PSK
            ManualHotspotSecurity.WPA3_TRANSITION -> observed == WifiInfo.SECURITY_TYPE_PSK || observed == WifiInfo.SECURITY_TYPE_SAE
            ManualHotspotSecurity.WPA3 -> observed == WifiInfo.SECURITY_TYPE_SAE
        }
        if (!matches) throw IOException("Connected Wi-Fi security does not match the selected type; check Wi-Fi settings and saved details")
    }

    fun advertised(selected: ManualHotspotSecurity): Iap2WirelessSecurity = when (selected) {
        ManualHotspotSecurity.OPEN -> Iap2WirelessSecurity.NONE
        ManualHotspotSecurity.WPA2 -> Iap2WirelessSecurity.WPA_WPA2
        ManualHotspotSecurity.WPA3_TRANSITION -> Iap2WirelessSecurity.WPA3_TRANSITION
        ManualHotspotSecurity.WPA3 -> Iap2WirelessSecurity.WPA3_ONLY
    }
}
