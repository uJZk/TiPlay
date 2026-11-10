package com.shilapi.xcertplay

import android.content.Intent
import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Handler
import android.os.Looper
import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.orchestration.*
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean
import java.time.Duration
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
        AirPlayReceiverService.publish("stopped")
        activity = Robolectric.buildActivity(CarPlayHostActivity::class.java).get()
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        reportReadyBrowser()
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
        browserReadiness().clear()
    }

    @Test fun noBrowserBlocksStartupEvenWithCachedViewportAndAllPermissions() {
        browserReadiness().clear()
        assertNotNull("A previous canvas is still cached", TeslaBrowserLink.lastViewport(activity))
        setField("browserConnectionRequested", true)
        setField("wirelessPermissionsReady", true)
        setField("vpnReady", true)
        setField("pendingDisplaySize", null)
        invoke("requestStartupPrerequisites")
        invoke("maybeStartCarPlay")
        assertTrue(controllers.constructed().isEmpty())
        assertNull(field("controller"))
        invoke("updateDebugOverlays")
        assertEquals("Waiting for browser connection", (field("browserMainPage") as BrowserMainSettingsMenu).status.text.toString())
    }

    private fun prepareWirelessRadioWait() {
        BrowserConnectionDraft(true, BrowserConnectionDraft.Source.LOCAL, "Phone hotspot", "password1",
            ManualHotspotSecurity.WPA2, "", "", phoneAddress = "AA:BB:CC:DD:EE:FF").save(activity)
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        setField("wirelessEnabled", true)
        setField("locationReportingEnabled", false)
        setField("browserConnectionRequested", true)
        setField("wirelessPermissionsReady", true)
        setField("microphonePermissionResolved", true)
        setField("pendingDisplaySize", null)
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(false)
        invoke("maybeStartCarPlay")
        assertTrue(field("waitingForBrowserBluetooth") as Boolean)
    }

    @Test fun disabledPhoneRadioWaitsWithoutConstructingControllersOrSchedulingHeavyRetries() {
        prepareWirelessRadioWait()
        repeat(8) {
            reportReadyBrowser()
            invoke("checkBrowserCarPlay")
            invoke("maybeStartCarPlay")
        }
        assertTrue(controllers.constructed().isEmpty())
        assertNull(field("controller"))
        assertFalse(field("reconnectScheduled") as Boolean)
        assertEquals(0, field("reconnectAttempts"))
        assertEquals(BrowserConnectionProblem.BLUETOOTH, field("browserConnectionProblem"))
    }

    @Test fun adapterOnBroadcastResumesThePendingFailedConnectionWithoutWaitingForTheIdlePoll() {
        prepareWirelessRadioWait()
        attachController()
        BrowserCarPlayWatch(activity, {}, { invoke("checkBrowserCarPlay") }).use {
            shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
            activity.sendBroadcast(Intent(BluetoothAdapter.ACTION_STATE_CHANGED)
                .putExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.STATE_ON))
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
        }
        assertFalse(field("waitingForBrowserBluetooth") as Boolean)
        assertEquals(1, field("restartGeneration"))
        assertTrue(field("handshakeResetInProgress") as Boolean)
        assertNull(field("controller"))
    }

    @Test fun radioWakeStillRequiresLiveBrowserEnabledCarPlayAndCurrentPermissionGrants() {
        prepareWirelessRadioWait()
        val old = attachController()
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        browserReadiness().clear()
        invoke("checkBrowserCarPlay")
        assertSame(old, field("controller"))
        reportReadyBrowser()
        BrowserCarPlaySettings.setDisabled(activity, true)
        invoke("checkBrowserCarPlay")
        assertSame(old, field("controller"))
        BrowserCarPlaySettings.setDisabled(activity, false)
        shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        invoke("checkBrowserCarPlay")
        assertSame(old, field("controller"))
        assertEquals(0, field("restartGeneration"))
        assertTrue(field("waitingForBrowserBluetooth") as Boolean)
    }

    @Test fun radioOffCannotRetireAnAlreadyRunningWifiSession() {
        val old = attachController()
        setField("wirelessEnabled", true)
        BrowserCarPlaySettings.saveMode(activity, BrowserCarPlaySettings.Mode.WIRELESS)
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(false)
        invoke("checkBrowserCarPlay")
        assertSame(old, field("controller"))
        assertFalse(field("waitingForBrowserBluetooth") as Boolean)
        verify(old, never()).close()
    }

    @Test fun currentSessionActivationClearsAnOlderRadioWaitWithoutRestartingTheRecoveredWifiSession() {
        prepareWirelessRadioWait()
        val current = attachController()
        val session = mock(AirPlaySession::class.java)
        `when`(current.isCurrentControlSession(session)).thenReturn(true)
        val listener = activity.javaClass.getDeclaredMethod("createSessionListener", Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(activity, 0) as AirPlaySessionListener
        listener.onSessionActive(session)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(field("waitingForBrowserBluetooth") as Boolean)
        assertEquals("connected", field("browserCarPlayPhase"))
        invoke("checkBrowserCarPlay")
        assertSame(current, field("controller"))
        assertEquals(0, field("restartGeneration"))
        verify(current, never()).close()
    }

    @Test fun aRadioPausedByTheOwnedHandoffOrUsbModeDoesNotBlockPreparation() {
        setField("wirelessEnabled", true)
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(false)
        activity.getSharedPreferences("diplay_bt_suspend", 0).edit().putBoolean("restore_initially_enabled", true).commit()
        assertFalse(invoke("awaitBrowserBluetoothRadio") as Boolean)
        activity.getSharedPreferences("diplay_bt_suspend", 0).edit().clear().commit()
        setField("wirelessEnabled", false)
        assertFalse(invoke("awaitBrowserBluetoothRadio") as Boolean)
    }

    @Test fun idleMainPageWithoutAConnectionRequestDoesNotStartCarPlay() {
        setField("browserConnectionRequested", false)
        setField("wirelessPermissionsReady", true)
        setField("microphonePermissionResolved", true)
        setField("locationPermissionAvailable", true)
        setField("pendingDisplaySize", null)
        invoke("maybeStartCarPlay")
        assertTrue(controllers.constructed().isEmpty())
        assertNull(field("controller"))
    }

    @Test fun enabledSettingsResumeIdleConnectionPreparation() {
        setField("browserConnectionRequested", false)
        setField("startupRetryStopped", true)
        // Hold startup at permission preparation so the test observes the idle request transition.
        setField("awaitingLocationPermission", true)
        setField("locationPermissionAvailable", false)
        AirPlayPersistence.saveLocationReportingEnabled(activity, true)

        invoke("applyBrowserSettings")

        assertTrue(field("browserConnectionRequested") as Boolean)
        assertFalse(field("startupRetryStopped") as Boolean)
        assertNull(field("controller"))
        assertTrue(controllers.constructed().isEmpty())
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

    @Test fun disablingWhilePhoneBluetoothIsOffStillRetiresTheControllerAndCancelsRecovery() {
        prepareWirelessRadioWait()
        val old = attachController()
        var retried = false
        val retry = Runnable { retried = true }
        setField("reconnectTask", retry)
        setField("reconnectScheduled", true)
        (field("mainHandler") as Handler).postDelayed(retry, 1_000)

        BrowserCarPlaySettings.setDisabled(activity, true)
        invoke("applyBrowserSettings")

        assertNull(field("controller"))
        assertFalse(field("browserConnectionRequested") as Boolean)
        assertFalse(field("waitingForBrowserBluetooth") as Boolean)
        assertFalse(field("reconnectScheduled") as Boolean)
        assertNull(field("reconnectTask"))
        (field("teardownExecutor") as PausedExecutorService).runAll()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        verify(old).close()
        assertFalse(retried)
        invoke("maybeStartCarPlay")
        assertNull(field("controller"))
        assertEquals(1, controllers.constructed().size)
    }

    @Test fun disablingDuringPrerequisiteWaitUpdatesStatusWithoutAController() {
        setField("browserConnectionRequested", true)
        setField("wirelessEnabled", true)
        invoke("updateDebugOverlays")
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        assertEquals("CarPlay waiting | AirPlay stopped", main.status.text.toString())
        BrowserCarPlaySettings.setDisabled(activity, true)
        invoke("applyBrowserSettings")
        assertEquals("CarPlay disabled | AirPlay stopped", main.status.text.toString())
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
        assertEquals("CarPlay preparing | AirPlay stopped", main.status.text.toString())
        main.draft.save(activity)
        assertEquals(35, AirPlayPersistence.loadFps(activity))
        assertFalse(AirPlayPersistence.loadHevcEnabled(activity))
    }

    @Test fun choosingAPairedCarUsesTheSelectionCallbackWithoutRestartingCarPlay() {
        val controller = attachController()
        `when`(controller.phoneBrowserMode()).thenReturn(true)
        val adapter = activity.getSystemService(android.bluetooth.BluetoothManager::class.java).adapter
        shadowOf(adapter).setEnabled(true)
        val device = adapter.getRemoteDevice("AA:BB:CC:DD:EE:FF")
        shadowOf(device).setBondState(android.bluetooth.BluetoothDevice.BOND_BONDED)
        shadowOf(device).setName("Car")
        shadowOf(adapter).setBondedDevices(setOf(device))
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        mockConstruction(CarBluetoothSelection::class.java).use { selections ->
            main.view.findViewWithTag<android.widget.Button>("car_bluetooth_button").performClick()
            shadowOf(requireNotNull(org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog())).clickOnItem(0)
            assertEquals(1, selections.constructed().size)
            verify(selections.constructed().single()).select(device.address)
        }
        assertSame(controller, field("controller"))
        verify(controller, never()).close()
    }

    @Test fun wirelessWaitingConnectingAndListeningHaveDistinctTitles() {
        attachController()
        setField("wirelessEnabled", true)
        setField("browserConnectionRequested", true)
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        report(CarPlayStatus.WaitingForPairedIphone)
        assertEquals("CarPlay waiting | AirPlay stopped", main.status.text.toString())
        report(CarPlayStatus.ConnectingBluetooth)
        assertEquals("CarPlay connecting | AirPlay stopped", main.status.text.toString())
        report(CarPlayStatus.RunningWireless)
        assertEquals("CarPlay ready | AirPlay stopped", main.status.text.toString())
    }

    @Test fun idleReadinessDoesNotClaimReadyBeforeAnIphoneIsSelected() {
        val main = field("browserMainPage") as BrowserMainSettingsMenu
        main.draft.wireless = true
        main.draft.phoneAddress = null
        setField("browserConnectionRequested", false)
        invoke("updateDebugOverlays")
        assertEquals("CarPlay waiting | AirPlay stopped", main.status.text.toString())
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
