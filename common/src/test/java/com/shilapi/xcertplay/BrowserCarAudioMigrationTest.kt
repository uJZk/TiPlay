package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserCarAudioMigrationTest {
    @Test fun eachLegacyBrowserChoiceSurvivesWithoutCollidingWithTheUpstreamBoolean() {
        val context = RuntimeEnvironment.getApplication()
        val prefs = context.getSharedPreferences("xcertplay_airplay", 0)
        for (mode in CarBluetoothAudio.entries) {
            prefs.edit().clear().putString("car_bluetooth_audio", mode.name).commit()
            BrowserSettingsPolicy.activate(context)
            assertEquals(mode, CarBluetoothAudio.load(context))
            assertFalse(AirPlayPersistence.loadCarBluetoothAudio(context))
            AirPlayPersistence.saveCarBluetoothAudio(context, true)
            assertEquals(mode, CarBluetoothAudio.load(context))
            CarBluetoothAudio.save(context, CarBluetoothAudio.OFF)
            assertTrue(AirPlayPersistence.loadCarBluetoothAudio(context))
        }
    }

    @Test fun anUpstreamBooleanIsPreservedAndDoesNotEnableBrowserAudioRouting() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("xcertplay_airplay", 0).edit().clear().putBoolean("car_bluetooth_audio", true).commit()
        BrowserSettingsPolicy.activate(context)
        assertEquals(CarBluetoothAudio.OFF, CarBluetoothAudio.load(context))
        assertTrue(AirPlayPersistence.loadCarBluetoothAudio(context))
    }
}
