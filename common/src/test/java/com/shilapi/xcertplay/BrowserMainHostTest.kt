package com.shilapi.xcertplay

import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Handler
import android.os.Looper
import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.orchestration.*
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.MockedConstruction
import org.mockito.Mockito.mockConstruction
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.mockito.Mockito.verify
import org.mockito.Mockito.never
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.android.util.concurrent.PausedExecutorService

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class BrowserMainHostTest {
    private lateinit var activity: CarPlayHostActivity
    private lateinit var controllers: MockedConstruction<CarPlayController>

    @Before fun setUp() {
        RuntimeEnvironment.getApplication().getSharedPreferences("tiplay_carplay", 0).edit().clear().commit()
        activity = Robolectric.buildActivity(CarPlayHostActivity::class.java).get()
        controllers = mockConstruction(CarPlayController::class.java) { mock, _ ->
            `when`(mock.phoneBrowserMode()).thenReturn(true)
        }
        (field("teardownExecutor") as ExecutorService).shutdownNow()
        setField("teardownExecutor", PausedExecutorService())
        setField("airPlayIdentity", AirPlayIdentity.generate())
        setField("microphonePermissionResolved", true)
        val sizeClass = Class.forName("com.shilapi.xcertplay.CarPlayHostActivity\$DisplaySize")
        val size = sizeClass.getDeclaredConstructor(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.newInstance(1920, 990)
        setField("activeDisplaySize", size)
        CarPlayBackgroundSession::class.java.getDeclaredField("owner").apply { isAccessible = true }
            .set(CarPlayBackgroundSession, activity)
        AirPlayPersistence.saveMfiTarget(activity, MfiTarget.USB_CH341)
        AirPlayPersistence.saveWirelessHotspotMode(activity, WirelessHotspotMode.WIFI_P2P)
        invoke("loadPersistedSettings")
        invoke("buildContentView")
    }

    @After fun tearDown() {
        (field("shuttingDown") as AtomicBoolean).set(true)
        (field("mainHandler") as Handler).removeCallbacksAndMessages(null)
        (field("teardownExecutor") as ExecutorService).shutdownNow()
        (field("airPlayCommandExecutor") as ExecutorService).shutdownNow()
        CarPlayBackgroundSession.clear()
        controllers.close()
    }

    @Test fun idleMainPageDoesNotStartCarPlayBeforeTheUserRequestsConnection() {
        setField("browserConnectionRequested", false)
        setField("wirelessPermissionsReady", true)
        setField("microphonePermissionResolved", true)
        setField("locationPermissionAvailable", true)
        setField("pendingDisplaySize", null)
        invoke("maybeStartCarPlay")
        assertTrue(controllers.constructed().isEmpty())
        assertNull(field("controller"))
    }

    @Test fun disablingCarPlayClosesTheStackAndBlocksPendingStartup() {
        attachController()
        BrowserCarPlaySettings.setDisabled(activity, true)
        invoke("applyBrowserSettings")
        assertNull(field("controller"))
        assertFalse(field("browserConnectionRequested") as Boolean)
        invoke("maybeStartCarPlay")
        assertNull(field("controller"))
    }

    @Test fun disablingDuringPrerequisiteWaitUpdatesStatusWithoutAController() {
        setField("browserConnectionRequested", true)
        setField("wirelessEnabled", true)
        invoke("updateDebugOverlays")
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        assertEquals("CarPlay searching | AirPlay ready", main.status.text.toString())
        BrowserCarPlaySettings.setDisabled(activity, true)
        invoke("applyBrowserSettings")
        assertEquals("CarPlay disabled | AirPlay ready", main.status.text.toString())
        assertNull(field("controller"))
    }

    @Test fun phoneMainPageKeepsDraftAndControllerWhileAdvancedValuesRefresh() {
        val controller = attachController()
        `when`(controller.phoneBrowserMode()).thenReturn(true)
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        main.draft.localSsid = "Unsaved hotspot"
        AirPlayPersistence.saveFps(activity, 35)
        AirPlayPersistence.saveHevcEnabled(activity, false)
        AirPlayPersistence.saveRightHandDrive(activity, true)
        invoke("openSettingsMenu")
        invoke("onResume")
        assertEquals("Unsaved hotspot", main.draft.localSsid)
        assertEquals(35, field("fps"))
        assertFalse(field("hevcEnabled") as Boolean)
        assertTrue(field("rightHandDrive") as Boolean)
        assertSame(controller, field("controller"))
        assertEquals(0, field("restartGeneration"))
        assertFalse(field("menuOpen") as Boolean) // Main page does not gate session recovery.
        report(CarPlayStatus.StartingHotspot)
        assertEquals("CarPlay searching | AirPlay ready", main.status.text.toString())
        main.draft.save(activity)
        assertEquals(35, AirPlayPersistence.loadFps(activity))
        assertFalse(AirPlayPersistence.loadHevcEnabled(activity))
    }

    @Test fun wirelessWaitingIsReadyAndActiveBluetoothAttemptsAreSearching() {
        attachController()
        setField("wirelessEnabled", true)
        setField("browserConnectionRequested", true)
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        report(CarPlayStatus.WaitingForPairedIphone)
        assertEquals("CarPlay ready | AirPlay ready", main.status.text.toString())
        report(CarPlayStatus.ConnectingBluetooth)
        assertEquals("CarPlay searching | AirPlay ready", main.status.text.toString())
        report(CarPlayStatus.RunningWireless)
        assertEquals("CarPlay ready | AirPlay ready", main.status.text.toString())
    }

    @Test fun idleReadinessDoesNotClaimReadyBeforeAnIphoneIsSelected() {
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        main.draft.wireless = true
        main.draft.phoneAddress = null
        setField("browserConnectionRequested", false)
        invoke("updateDebugOverlays")
        assertEquals("CarPlay ready | AirPlay ready", main.status.text.toString())
    }

    @Test fun savingConnectionDraftDoesNotOverwriteCustomResolution() {
        val draft = (field("browserMainPage") as BrowserMainSettingsMenu).draft
        draft.wireless = false
        for (percent in listOf(73, 157, 160)) {
            AirPlayPersistence.saveDisplayScalePercent(activity, percent)
            draft.save(activity)
            assertEquals(percent, AirPlayPersistence.loadDisplayScalePercent(activity))
        }
    }

    @Test fun savedSettingsRestartTheRunningSessionImmediatelyAndPreserveIncompleteMainEdits() {
        val oldController = attachController()
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        main.draft.localSsid = "Unsaved hotspot"
        main.draft.localPassword = "unsavedsecret"
        main.draft.externalSsid = "Unsaved car Wi-Fi"
        main.draft.externalPassword = "othersecret"
        main.draft.phoneAddress = "02:00:00:00:00:99"
        main.draft.wireless = !main.draft.wireless
        val unsaved = main.draft.copy()
        AirPlayPersistence.saveFps(activity, 35)
        AirPlayPersistence.saveHevcEnabled(activity, false)
        AirPlayPersistence.saveRightHandDrive(activity, true)

        invoke("applyBrowserSettings")

        assertEquals(1, field("restartGeneration"))
        assertNull(field("controller"))
        assertTrue(field("handshakeResetInProgress") as Boolean)
        assertTrue(field("browserConnectionRequested") as Boolean)
        assertEquals(35, field("fps"))
        assertFalse(field("hevcEnabled") as Boolean)
        assertTrue(field("rightHandDrive") as Boolean)
        assertSame(main, field("browserMainPage"))
        assertEquals(unsaved, main.draft)
        assertNotEquals(unsaved.localSsid, AirPlayPersistence.loadManualHotspotSsid(activity))
        assertNotEquals(unsaved.phoneAddress, DiPlayPreferences.phoneAddress(activity))


        // Startup is deliberately held so this assertion observes the real old-stack teardown.
        setField("pendingDisplaySize", null)
        setField("wirelessPermissionsReady", false)
        (field("teardownExecutor") as PausedExecutorService).runAll()
        shadowOf(Looper.getMainLooper()).idle()
        verify(oldController).close()
        assertEquals(unsaved, main.draft)
    }

    @Test fun returningFromAdvancedIsOnlyNavigationAndPreservesIncompleteMainEdits() {
        val controller = attachController()
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        main.draft.localSsid = "Unsaved main-page hotspot"
        val unsaved = main.draft.copy()
        AirPlayPersistence.saveFps(activity, 35)
        PendingReconnect.mark(controller)

        newIntent(CarPlaySettingsNavigation.mainIntent(activity))
        invoke("onResume")

        assertSame(controller, field("controller"))
        assertEquals(0, field("restartGeneration"))
        assertEquals(unsaved, main.draft)
        assertEquals(35, field("fps"))
        assertTrue(PendingReconnect.isPending(controller))
        verify(controller, never()).close()
    }

    @Test fun phoneBrowserModeKeepsBydVehicleDataAndOutputsOutOfTheRuntime() {
        com.shilapi.xcertplay.hud.BydOutputSettings.setBatteryToIphone(activity, true)
        com.shilapi.xcertplay.hud.BydOutputSettings.setWheelSpeedToIphone(activity, true)
        setField("locationReportingEnabled", true)
        AirPlayPersistence.saveRunMode(activity, CarPlayRunMode.PHONE_BROWSER)
        val phone = invoke("createRuntimeConfig") as CarPlayRuntimeConfig
        assertFalse(phone.headUnitIntegrations)
        assertFalse(phone.identification.vehicleStatusEnabled)
        assertFalse(phone.identification.vehicleSpeedEnabled)
        assertTrue(phone.locationReportingEnabled)
    }

    @Test fun localRuntimeDoesNotRequestCh341Devices() {
        AirPlayPersistence.saveMfiTarget(activity, MfiTarget.LOCAL)
        invoke("loadPersistedSettings")
        val config = invoke("createRuntimeConfig") as CarPlayRuntimeConfig
        assertEquals(MfiTarget.LOCAL, config.mfiTarget)
        assertTrue(config.ch341Devices.isEmpty())
    }

    @Test fun ch341AttachmentKeepsTheWirelessSession() {
        val controller = attachController()
        AirPlayPersistence.saveWirelessEnabled(activity, true)
        invoke("loadPersistedSettings")
        val device = mock(UsbDevice::class.java)
        `when`(device.vendorId).thenReturn(0x1a86)
        `when`(device.productId).thenReturn(0x5512)
        val intent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).putExtra(UsbManager.EXTRA_DEVICE, device)
        activity.javaClass.getDeclaredMethod("onNewIntent", Intent::class.java)
            .apply { isAccessible = true }.invoke(activity, intent)
        assertTrue(AirPlayPersistence.loadWirelessEnabled(activity))
        assertTrue(field("wirelessEnabled") as Boolean)
        assertSame(controller, field("controller"))
        assertFalse((field("shuttingDown") as AtomicBoolean).get())
        assertFalse(activity.isFinishing)
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun iphoneAttachmentSwitchesToWiredTransportWithoutFinishing() {
        org.robolectric.shadows.ShadowVpnService.setPrepareResult(null)
        BrowserCarPlaySettings.saveMode(activity, BrowserCarPlaySettings.Mode.ALL)
        attachController()
        AirPlayPersistence.saveWirelessEnabled(activity, true)
        invoke("loadPersistedSettings")
        val device = mock(UsbDevice::class.java)
        `when`(device.vendorId).thenReturn(0x05ac)
        val intent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).putExtra(UsbManager.EXTRA_DEVICE, device)
        activity.javaClass.getDeclaredMethod("onNewIntent", Intent::class.java)
            .apply { isAccessible = true }.invoke(activity, intent)
        assertEquals(BrowserCarPlaySettings.Mode.ALL, BrowserCarPlaySettings.mode(activity))
        assertFalse(field("wirelessEnabled") as Boolean)
        assertTrue(field("vpnReady") as Boolean)
        assertFalse((field("shuttingDown") as AtomicBoolean).get())
        assertFalse(activity.isFinishing)
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun switchingToUsbRequestsVpnConsentAndDoesNotRepeatPendingConsent() {
        org.robolectric.shadows.ShadowVpnService.setPrepareResult(Intent("test.VPN_CONSENT"))
        BrowserCarPlaySettings.saveMode(activity, BrowserCarPlaySettings.Mode.ALL)
        attachController()
        AirPlayPersistence.saveWirelessEnabled(activity, true)
        invoke("loadPersistedSettings")
        setField("vpnReady", true) // Previously granted permission may have been revoked.
        val device = mock(UsbDevice::class.java)
        `when`(device.vendorId).thenReturn(0x05ac)
        val intent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).putExtra(UsbManager.EXTRA_DEVICE, device)
        val method = activity.javaClass.getDeclaredMethod("onNewIntent", Intent::class.java).apply { isAccessible = true }
        method.invoke(activity, intent)
        assertTrue(field("awaitingVpnConsent") as Boolean)
        assertFalse(field("vpnReady") as Boolean)
        assertNull(field("controller"))
        assertEquals("test.VPN_CONSENT", shadowOf(activity).nextStartedActivityForResult.intent.action)
        method.invoke(activity, intent)
        assertNull(shadowOf(activity).nextStartedActivityForResult)
        assertFalse(activity.isFinishing)
    }

    @Test fun onlyIphoneAttachmentSelectsWiredTransport() {
        val method = activity.javaClass.getDeclaredMethod("isIphoneUsbAttachment", Intent::class.java)
            .apply { isAccessible = true }
        val device = mock(UsbDevice::class.java)
        `when`(device.vendorId).thenReturn(0x05ac)
        val attached = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).putExtra(UsbManager.EXTRA_DEVICE, device)
        assertEquals(true, method.invoke(activity, attached))
        assertEquals(false, method.invoke(activity, Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED)))
        assertEquals(false, method.invoke(activity, Intent(UsbManager.ACTION_USB_DEVICE_DETACHED).putExtra(UsbManager.EXTRA_DEVICE, device)))
    }

    private fun attachController(): CarPlayController = CarPlayController(
        activity, CarPlayRuntimeConfig(mfiTarget = MfiTarget.LOCAL,
            identification = Iap2IdentificationConfig("test", "test", "test", "test", "1", "1", 3)),
        AirPlayConfig("test", "02:00:00:00:00:02", "02:00:00:00:00:01", "1", AirPlayDisplayConfig(1920, 990)),
        AirPlayIdentity.generate(), PairingStore(), object : AirPlaySessionListener {}, object : AirPlayMediaHandler {}, {},
    ).also { setField("controller", it) }

    @Suppress("UNCHECKED_CAST")
    private fun report(status: CarPlayStatus, generation: Int = 0) {
        val reporter = activity.javaClass.getDeclaredMethod("createStatusReporter", Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(activity, generation) as (CarPlayStatus) -> Unit
        reporter(status)
    }

    private fun invoke(name: String): Any? = activity.javaClass.getDeclaredMethod(name)
        .apply { isAccessible = true }.invoke(activity)
    private fun newIntent(intent: Intent) {
        activity.javaClass.getDeclaredMethod("onNewIntent", Intent::class.java)
            .apply { isAccessible = true }.invoke(activity, intent)
    }
    private fun field(name: String): Any? = activity.javaClass.getDeclaredField(name)
        .apply { isAccessible = true }.get(activity)
    private fun setField(name: String, value: Any?) {
        activity.javaClass.getDeclaredField(name).apply { isAccessible = true }.set(activity, value)
    }
}
