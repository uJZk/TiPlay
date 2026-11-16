package com.shilapi.xcertplay

import android.Manifest
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Looper
import androidx.lifecycle.ViewModelProvider
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import com.shilapi.xcertplay.orchestration.MfiTarget
import java.util.concurrent.ExecutorService
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.util.ReflectionHelpers

/** Public cold receiving lifecycle; no synthetic browser-ready/controller/request flags. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@LooperMode(LooperMode.Mode.PAUSED)
class SessionForegroundPreparationHostTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private var host: ActivityController<CarPlayHostActivity>? = null
    private var service: ServiceController<DiPlaySessionService>? = null

    @Before fun setUp() {
        SessionForegroundPreparation.consume()
        CarPlayBackgroundSession.clear()
        TeslaBrowserLink.resetForTest()
        for (name in listOf("xcertplay_airplay", "tiplay_carplay", "tiplay_browser_audio"))
            app.getSharedPreferences(name, 0).edit().clear().commit()
        AirPlayPersistence.saveRunMode(app, CarPlayRunMode.PHONE_BROWSER)
        AirPlayPersistence.saveMfiTarget(app, MfiTarget.USB_CH341)
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
    }

    @After fun tearDown() {
        host?.let {
            runCatching { it.pause().stop().destroy() }
            for (field in listOf("teardownExecutor", "airPlayCommandExecutor"))
                ReflectionHelpers.getField<ExecutorService>(it.get(), field).shutdownNow()
        }
        SessionForegroundPreparation.consume()
        CarPlayBackgroundSession.clear()
        service?.destroy()
        TeslaBrowserLink.resetForTest()
    }

    private fun open(intent: Intent = CarPlaySettingsNavigation.mainIntent(app)): CarPlayHostActivity {
        host = Robolectric.buildActivity(CarPlayHostActivity::class.java, intent).setup()
        shadowOf(Looper.getMainLooper()).idle()
        return requireNotNull(host).get()
    }
    private fun startDispatchedService(): DiPlaySessionService {
        var found: Intent? = null
        while (true) {
            val intent = shadowOf(app).nextStartedService ?: break
            if (intent.component?.className == DiPlaySessionService::class.java.name) found = intent
        }
        service = Robolectric.buildService(DiPlaySessionService::class.java, requireNotNull(found))
            .create().startCommand(0, 1)
        return requireNotNull(service).get()
    }
    private fun assertNoEarlySession(activity: CarPlayHostActivity) {
        assertFalse(CarPlayBackgroundSession.hasSession())
        assertNull(CarPlayBackgroundSession.snapshot())
        assertNull(ReflectionHelpers.getField<Any?>(activity, "controller"))
        assertNull(TeslaBrowserLink.readyViewport())
    }

    @Test fun visibleColdMainPreparesBeforeBrowserViewportWithoutStartingAnIphoneController() {
        val activity = open()
        assertTrue(ReflectionHelpers.getField(activity, "browserConnectionRequested"))
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
        startDispatchedService()
        assertNoEarlySession(activity)
    }

    @Test fun settingsOnlyEntryDoesNotPrepareUntilAnExplicitMainIntent() {
        val activity = open(CarPlaySettingsNavigation.menuIntent(app))
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
        requireNotNull(host).newIntent(CarPlaySettingsNavigation.mainIntent(activity))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
    }

    @Test fun settingsOnlyRecreationDoesNotBecomeAReceivingIntent() {
        open(CarPlaySettingsNavigation.menuIntent(app))
        requireNotNull(host).recreate()
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(requireNotNull(host).get())
    }

    @Test fun anIphoneUsbAttachmentCanTurnTheVisibleSettingsHostIntoAReceivingHost() {
        val activity = open(CarPlaySettingsNavigation.menuIntent(app))
        assertFalse(SessionForegroundPreparation.hasPreparation())
        BrowserCarPlaySettings.saveMode(activity, BrowserCarPlaySettings.Mode.ALL)
        val device = mock(UsbDevice::class.java)
        `when`(device.vendorId).thenReturn(0x05ac)
        requireNotNull(host).newIntent(Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            .putExtra(UsbManager.EXTRA_DEVICE, device))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
    }

    @Test fun sameVisibleSettingsCanWithdrawAndRestoreAudioPreparationWithoutAViewport() {
        val activity = open()
        val foreground = startDispatchedService()
        BrowserCarPlayAudioSettings.saveDisabled(activity, true)
        BrowserSettingsChanges.apply(activity)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertTrue(shadowOf(foreground).isStoppedBySelf)
        assertFalse(activity.isFinishing)
        BrowserCarPlayAudioSettings.saveDisabled(activity, false)
        BrowserSettingsChanges.apply(activity)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
    }

    @Test fun CarPlayOptOutRetainsSettingsAndCanRestoreTheVisibleReceivingIntent() {
        val activity = open()
        startDispatchedService()
        BrowserCarPlaySettings.setDisabled(activity, true)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertFalse(activity.isFinishing)
        BrowserCarPlaySettings.setDisabled(activity, false)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
    }

    @Test fun permissionGrantedWhileReturningToMainPreparesWithoutAReadyViewport() {
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO)
        val activity = open()
        assertFalse(SessionForegroundPreparation.hasPreparation())
        requireNotNull(host).pause().stop()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        requireNotNull(host).start().resume().visible()
        requireNotNull(host).postResume()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(activity)
    }

    @Test fun explicitStopDuringActivityRecreationFencesTheReplacementHostBeforeItsPostedResume() {
        open()
        val foreground = startDispatchedService()
        val owner = SessionForegroundPreparation.snapshot()!!.owner
        val stop = shadowOf(shadowOf(foreground).lastForegroundNotification.actions.single().actionIntent).savedIntent
        requireNotNull(host).recreate()
        val replacement = requireNotNull(host).get()
        assertSame(owner, ViewModelProvider(replacement)[SessionForegroundPreparationOwner::class.java])
        requireNotNull(service).withIntent(stop).startCommand(0, 2)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue((owner as SessionForegroundPreparationOwner).cancelled)
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertTrue(replacement.isFinishing)
        requireNotNull(host).newIntent(CarPlaySettingsNavigation.mainIntent(replacement))
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertNoEarlySession(replacement)
    }
}
