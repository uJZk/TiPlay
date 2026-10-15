package com.shilapi.xcertplay

import com.shilapi.xcertplay.host.R

/** Facts supplied by the running host, never inferred from a wireless settings draft. */
internal enum class BrowserConnectionProblem(val message: Int) {
    NEARBY(R.string.settings_hint_nearby),
    LOCATION(R.string.settings_hint_location),
    USB_VPN(R.string.settings_hint_usb_vpn),
    USB_DEVICE(R.string.requesting_iphone_usb_permission),
    MFI_USB(R.string.requesting_mfi_usb_permission),
    FAILED(R.string.settings_hint_failed),
    PREPARATION(R.string.settings_hint_preparation_failed),
}

internal object BrowserConnectionHints {
    fun wifi(hasWifi: Boolean, actualSsid: String?, selectedSsid: String): Int? {
        if (selectedSsid.isBlank()) return null // The editable field owns this missing value.
        if (!hasWifi) return R.string.settings_hint_wifi_disconnected
        val readable = actualSsid?.trim('"')?.takeUnless { it.isBlank() || it == "<unknown ssid>" }
        return when {
            readable == null -> R.string.settings_hint_wifi_unknown
            readable != selectedSsid -> R.string.settings_hint_wifi_mismatch
            else -> null // A matching SSID proves neither browser readiness nor reachability.
        }
    }
}
