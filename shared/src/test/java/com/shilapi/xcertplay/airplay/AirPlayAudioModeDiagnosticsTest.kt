package com.shilapi.xcertplay.airplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AirPlayAudioModeDiagnosticsTest {
    private val config = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480))
    private val setups = AirPlayAudioSetupDiagnostics()

    @Test fun audioOwnershipAndNavigationRemainVisibleWithoutAnAudioSetup() {
        val diagnostics = AirPlayAudioModeDiagnostics()
        diagnostics.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 2L, "entity" to 1L)),
            "appStates" to listOf(mapOf("appStateID" to 1L, "entity" to 2L, "speechMode" to -1L),
                mapOf("appStateID" to 2L, "state" to false),
                mapOf("appStateID" to 3L, "entity" to 1L, "state" to true))))
        assertEquals("airplay audio modes audioRoute=tiplay audioOwner=controller " +
            "speechEntity=accessory speechMode=-1 phoneCallEntity=unknown phoneCallState=false " +
            "navigationEntity=controller navigationState=true audioSetups=0 activeAudioTypes=none",
            diagnostics.changed(config, setups.snapshot()))
        assertNull(diagnostics.changed(config, setups.snapshot()))
    }

    @Test fun incrementalUpdatesKeepUnrelatedModesAndOnlyAcceptedAudioRemainsActive() {
        val diagnostics = AirPlayAudioModeDiagnostics()
        diagnostics.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to "mainAudio", "entity" to "accessory")),
            "appStates" to listOf(mapOf("appStateID" to 3, "entity" to "controller"))))
        diagnostics.changed(config, setups.snapshot())
        diagnostics.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 1, "entity" to 1)),
            "appStates" to listOf(mapOf("appStateID" to 1, "speechMode" to 2))))
        setups.record(100, mapOf("audioType" to "speechRecognition"), accepted = true)
        setups.record(101, mapOf("audioType" to "default"), accepted = false)
        val line = diagnostics.changed(config, setups.snapshot())!!
        assertTrue(line.contains("audioOwner=accessory"))
        assertTrue(line.contains("speechMode=2"))
        assertTrue(line.contains("navigationEntity=controller"))
        assertTrue(line.endsWith("audioSetups=2 activeAudioTypes=100"))
        setups.retire(listOf(101))
        assertNull(diagnostics.changed(config, setups.snapshot()))
        setups.retire(listOf(100))
        assertTrue(diagnostics.changed(config, setups.snapshot())!!.endsWith("audioSetups=2 activeAudioTypes=none"))
    }

    @Test fun malformedAndPrivateValuesCannotEnterTheLogOrEraseValidatedState() {
        val diagnostics = AirPlayAudioModeDiagnostics()
        diagnostics.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 2, "entity" to 1))))
        val first = diagnostics.changed(config, setups.snapshot())
        diagnostics.onModesChanged(mapOf("resources" to listOf("secret", mapOf("resourceID" to 2.5, "entity" to 2),
            mapOf("resourceID" to 2, "entity" to "secret")), "appStates" to listOf(
            mapOf("appStateID" to 1, "entity" to Double.NaN, "speechMode" to 1.5),
            mapOf("appStateID" to 2, "entity" to Double.POSITIVE_INFINITY, "state" to "secret"),
            mapOf("appStateID" to 3.5, "entity" to 2, "state" to true))))
        assertNull(diagnostics.changed(config, setups.snapshot()))
        assertFalse(first!!.contains("secret"))
        diagnostics.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 2, "entity" to "n/a"))))
        assertTrue(diagnostics.changed(config, setups.snapshot())!!.contains("audioOwner=unknown"))
    }
}
