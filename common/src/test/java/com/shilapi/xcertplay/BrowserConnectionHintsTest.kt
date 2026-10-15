package com.shilapi.xcertplay

import com.shilapi.xcertplay.host.R
import org.junit.Assert.*
import org.junit.Test

class BrowserConnectionHintsTest {
    @Test fun unavailableSsidDoesNotClaimThatThePhoneIsOnAnotherNetwork() {
        for (ssid in listOf(null, "", "<unknown ssid>", "\"<unknown ssid>\""))
            assertEquals(R.string.settings_hint_wifi_unknown, BrowserConnectionHints.wifi(true, ssid, "Car Wi-Fi"))
    }
    @Test fun wifiFactsDistinguishDisconnectedMismatchAndMatchingWithoutClaimingReadiness() {
        assertEquals(R.string.settings_hint_wifi_disconnected, BrowserConnectionHints.wifi(false, null, "Car Wi-Fi"))
        assertEquals(R.string.settings_hint_wifi_mismatch, BrowserConnectionHints.wifi(true, "Other Wi-Fi", "Car Wi-Fi"))
        assertNull(BrowserConnectionHints.wifi(true, "\"Car Wi-Fi\"", "Car Wi-Fi"))
    }
    @Test fun anEmptyDraftDoesNotProduceAnExtraNetworkFailure() {
        assertNull(BrowserConnectionHints.wifi(false, null, ""))
        assertNull(BrowserConnectionHints.wifi(true, "Other Wi-Fi", " "))
    }
}
