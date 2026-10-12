package com.shilapi.xcertplay

import android.content.ContextWrapper
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import com.shilapi.xcertplay.host.R
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

    @Test fun optOutStopsOnlyTheReceiverAndOptInDoesNotAutomaticallyStartIt() {
        val stopped = mutableListOf<Intent>()
        val context = object : ContextWrapper(app) {
            override fun stopService(service: Intent): Boolean { stopped.add(service); return true }
            override fun startService(service: Intent): android.content.ComponentName? = error("must not automatically start")
        }
        assertFalse(AirPlayReceiverSettings.isDisabled(context))
        AirPlayReceiverSettings.setDisabled(context, true)
        assertTrue(AirPlayReceiverSettings.isDisabled(app))
        assertEquals(AirPlayReceiverService::class.java.name, stopped.single().component!!.className)
        AirPlayReceiverSettings.setDisabled(context, false)
        assertFalse(AirPlayReceiverSettings.isDisabled(app))
        assertEquals(1, stopped.size)
    }

    @Test fun receiverPageDisablesStartAndRechecksTheSettingOnReturn() {
        AirPlayReceiverSettings.setDisabled(app, true)
        val controller = Robolectric.buildActivity(AirPlayReceiverActivity::class.java).setup()
        val activity = controller.get()
        val root = activity.findViewById<View>(android.R.id.content)
        val start = views(root).filterIsInstance<Button>().single { it.text == activity.getString(R.string.settings_airplay_start) }
        assertFalse(start.isEnabled)
        assertTrue(views(root).filterIsInstance<TextView>().any { it.text == activity.getString(R.string.settings_airplay_disabled) })
        controller.pause()
        AirPlayReceiverSettings.setDisabled(app, false)
        controller.resume()
        assertTrue(start.isEnabled)
        controller.pause().stop().destroy()
    }

    @Test fun disabledReceiverRejectsServiceStartupBeforeListeningOrHoldingLocks() {
        AirPlayReceiverSettings.setDisabled(app, true)
        val controller = Robolectric.buildService(AirPlayReceiverService::class.java).create()
        assertEquals(android.app.Service.START_NOT_STICKY, controller.get().onStartCommand(Intent(app, AirPlayReceiverService::class.java), 0, 1))
        assertEquals("stopped", AirPlayReceiverService.state)
        controller.destroy()
    }

    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }
}
