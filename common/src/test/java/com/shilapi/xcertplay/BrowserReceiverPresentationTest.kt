package com.shilapi.xcertplay

import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.orchestration.CarPlayStatus
import org.junit.Assert.*
import org.junit.Test

class BrowserReceiverPresentationTest {
    @Test fun authenticatorAndUsbReenumerationDoNotClaimReceiverReadiness() {
        for (state in listOf(CarPlayStatus.WaitingForMfi, CarPlayStatus.MfiReady, CarPlayStatus.WaitingForReenumeration)) {
            assertEquals("preparing", BrowserCarPlayStatus.phase(state))
        }
        assertEquals("searching", BrowserCarPlayStatus.phase(CarPlayStatus.DiscoveringIphone))
        assertEquals("waiting", BrowserCarPlayStatus.phase(CarPlayStatus.WaitingForIphone))
        assertEquals("connecting", BrowserCarPlayStatus.phase(CarPlayStatus.ConnectingBluetooth))
        assertEquals("ready", BrowserCarPlayStatus.phase(CarPlayStatus.RunningWireless))
        assertEquals("failed", BrowserCarPlayStatus.phase(CarPlayStatus.Failed("failure")))
        assertEquals("recovering", BrowserCarPlayStatus.phase(CarPlayStatus.ControlEnded))
    }

    @Test fun enabledAirPlayOnlyClaimsReadyWhenListening() {
        val title = BrowserReceiverPresentation::airPlayTitle
        assertEquals(R.string.settings_airplay_stopped_status, title("stopped", false))
        assertEquals(R.string.settings_airplay_starting_status, title("starting", false))
        assertEquals(R.string.settings_airplay_ready_status, title("listening", false))
        assertEquals(R.string.settings_airplay_permission_status, title("permission", false))
        for (state in listOf("failed", "discovery-failed", "audio-failed", "playback-failed")) {
            assertEquals(R.string.settings_airplay_failed_status, title(state, false))
        }
        assertEquals(R.string.settings_airplay_mirroring_status, title("mirror", false))
        assertEquals(R.string.settings_airplay_playing_status, title("audio", false))
        assertEquals(R.string.settings_airplay_loading_status, title("video", false))
        assertEquals(R.string.settings_airplay_loading_status, title("loading", false))
        assertEquals(R.string.settings_airplay_playing_status, title("playing", false))
        assertEquals(R.string.settings_airplay_paused_status, title("paused", false))
        assertEquals(R.string.settings_airplay_photo_status, title("photo", false))
        for (state in listOf("listening", "starting", "failed", "mirror")) {
            assertEquals(R.string.settings_airplay_disabled_status, title(state, true))
        }
    }
}
