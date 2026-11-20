package com.shilapi.xcertplay

import android.content.ContextWrapper
import android.content.Intent
import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment
import com.shilapi.xcertplay.web.BrowserVideoCapabilities
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AirPlayMirrorExperimentSettingsTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val prefs get() = app.getSharedPreferences("tiplay_airplay_receiver", 0)

    @Before fun reset() { prefs.edit().clear().commit() }

    @Test fun unsetAndUnknownModesRetainThePublishedBaseline() {
        assertEquals(ReceiverMirrorExperiment.BASELINE, AirPlayMirrorExperimentSettings.get(app))
        prefs.edit().putString("mirror_experiment", "retired-experiment").commit()
        assertEquals(ReceiverMirrorExperiment.BASELINE, AirPlayMirrorExperimentSettings.get(app))
    }

    @Test fun eachChangedModeStartsOnlyTheExistingReceiverApplyPathAndPreservesIdentity() {
        prefs.edit().putString("private", "retained-private").putString("public", "retained-public")
            .putString("pairing", "retained-pairing").putString("device", "retained-device")
            .putStringSet("trusted", setOf("remembered-sender")).commit()
        val preserved = prefs.all.toMap()
        val started = mutableListOf<Intent>()
        val stopped = mutableListOf<Intent>()
        val context = object : ContextWrapper(app) {
            override fun startForegroundService(service: Intent): android.content.ComponentName? {
                started += service
                return service.component
            }
            override fun stopService(service: Intent): Boolean { stopped += service; return true }
        }
        for (mode in listOf(ReceiverMirrorExperiment.H264_ONLY, ReceiverMirrorExperiment.NO_BLE,
                ReceiverMirrorExperiment.LEGACY_PAIRING, ReceiverMirrorExperiment.BASELINE)) {
            assertTrue(AirPlayMirrorExperimentSettings.set(context, mode))
            assertEquals(mode, AirPlayMirrorExperimentSettings.get(app))
            assertFalse(AirPlayMirrorExperimentSettings.set(context, mode))
        }
        assertEquals(4, started.size)
        assertTrue(started.all { it.component?.className == AirPlayReceiverService::class.java.name &&
            it.action == AirPlayReceiverService.ACTION_APPLY_MIRROR_EXPERIMENT })
        assertTrue(stopped.isEmpty())
        preserved.forEach { (key, value) -> assertEquals(value, prefs.all[key]) }
    }

    @Test fun disabledReceiverStoresTheModeWithoutStartingOrStoppingAnyService() {
        prefs.edit().putBoolean("disabled", true).commit()
        var starts = 0
        val context = object : ContextWrapper(app) {
            override fun startForegroundService(service: Intent): android.content.ComponentName? { starts++; return service.component }
        }
        assertTrue(AirPlayMirrorExperimentSettings.set(context, ReceiverMirrorExperiment.NO_BLE))
        assertEquals(ReceiverMirrorExperiment.NO_BLE, AirPlayMirrorExperimentSettings.get(app))
        assertEquals(0, starts)
    }

    @Test fun h264ComparisonRejectsKnownHevcOnlyBrowsersAndKeepsUnknownFallback() {
        val hevcOnly = BrowserVideoCapabilities(false, true, 1920, 1080)
        val h264Only = BrowserVideoCapabilities(true, false, 1920, 1080)
        assertFalse(AirPlayMirrorExperimentSettings.mirrorEnabled(ReceiverMirrorExperiment.H264_ONLY, hevcOnly))
        assertTrue(AirPlayMirrorExperimentSettings.mirrorEnabled(ReceiverMirrorExperiment.H264_ONLY, h264Only))
        assertTrue(AirPlayMirrorExperimentSettings.mirrorEnabled(ReceiverMirrorExperiment.H264_ONLY, null))
        for (mode in ReceiverMirrorExperiment.entries.filter { it != ReceiverMirrorExperiment.H264_ONLY }) {
            assertTrue(AirPlayMirrorExperimentSettings.mirrorEnabled(mode, hevcOnly))
        }
        assertFalse(AirPlayMirrorExperimentSettings.mirrorEnabled(ReceiverMirrorExperiment.BASELINE,
            BrowserVideoCapabilities(false, false, 1920, 1080)))
    }
}
