package com.shilapi.xcertplay

import android.content.ContextWrapper
import android.content.Intent
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AirPlayReceiverSettingsTest {
    private val app get() = RuntimeEnvironment.getApplication()
    @Before fun reset() { app.getSharedPreferences("tiplay_airplay_receiver", 0).edit().clear().commit() }

    @Test fun receiverStartsByDefaultAndOptOutStopsOnlyTheReceiver() {
        val stopped = mutableListOf<Intent>()
        val started = mutableListOf<Intent>()
        val context = object : ContextWrapper(app) {
            override fun stopService(service: Intent): Boolean { stopped.add(service); return true }
            override fun startForegroundService(service: Intent): android.content.ComponentName? { started.add(service); return service.component }
        }
        assertFalse(AirPlayReceiverSettings.isDisabled(context))
        AirPlayReceiverSettings.sync(context)
        assertEquals(AirPlayReceiverService::class.java.name, started.single().component!!.className)
        AirPlayReceiverSettings.setDisabled(context, true)
        assertTrue(AirPlayReceiverSettings.isDisabled(app))
        assertEquals(AirPlayReceiverService::class.java.name, stopped.single().component!!.className)
        AirPlayReceiverSettings.setDisabled(context, false)
        assertFalse(AirPlayReceiverSettings.isDisabled(app))
        assertEquals(1, stopped.size)
        assertEquals(2, started.size)
    }

    @Test fun disabledReceiverRejectsServiceStartupBeforeListeningOrHoldingLocks() {
        AirPlayReceiverSettings.setDisabled(app, true)
        val controller = Robolectric.buildService(AirPlayReceiverService::class.java).create()
        assertEquals(android.app.Service.START_NOT_STICKY, controller.get().onStartCommand(Intent(app, AirPlayReceiverService::class.java), 0, 1))
        assertEquals("stopped", AirPlayReceiverService.state)
        controller.destroy()
    }

}
