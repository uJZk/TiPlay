package com.shilapi.xcertplay

import android.app.Activity
import android.bluetooth.BluetoothManager
import android.net.wifi.WifiManager
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import java.time.Duration
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.RadioButton
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.orchestration.ManualHotspotSecurity
import com.shilapi.xcertplay.orchestration.WirelessHotspotMode
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowWifiManager
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-w390dp-h844dp")
class BrowserMainPageTest {
    private lateinit var controller: org.robolectric.android.controller.ActivityController<Activity>
    private lateinit var activity: Activity
    private lateinit var page: BrowserMainSettingsMenu
    private var settingsChanges = 0
    @Before fun setup() {
        controller = Robolectric.buildActivity(Activity::class.java)
        activity = controller.get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        controller.setup()
        activity.getSharedPreferences("diplay", 0).edit().clear().commit()
        activity.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_carplay", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_airplay_receiver", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_browser_network", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_hotspot_address", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_browser_audio", 0).edit().clear().commit()
        AirPlayPersistence.saveWirelessHotspotMode(activity, WirelessHotspotMode.MANUAL)
        AirPlayPersistence.saveManualHotspotSsid(activity, "Phone hotspot")
        AirPlayPersistence.saveManualHotspotPassphrase(activity, "password1")
        AirPlayPersistence.saveManualHotspotSecurity(activity, com.shilapi.xcertplay.orchestration.ManualHotspotSecurity.WPA2)
        if (activity.resources.configuration.screenHeightDp <= 240) {
            activity.resources.configuration.fontScale = 1.5f
            @Suppress("DEPRECATION")
            activity.resources.displayMetrics.scaledDensity = activity.resources.displayMetrics.density * 1.5f
        }
        AirPlayReceiverService.publish("stopped")
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity), {}, {}, {}, { settingsChanges++ })
        activity.setContentView(page.view)
    }
    @Test fun iphoneBluetoothAudioReplacesAndroidCarConnectionWarning() {
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(false)
        BrowserCarPlayAudioSettings.saveDisabled(activity, true)
        page.refresh()
        val hint = page.view.findViewWithTag<TextView>("connection_hint:car-bluetooth")
        assertEquals(activity.getString(R.string.settings_hint_iphone_car_audio), hint.text.toString())
        BrowserCarPlayAudioSettings.saveDisabled(activity, false)
        page.refresh()
        assertEquals(activity.getString(R.string.settings_hint_car_bluetooth_disconnected),
            page.view.findViewWithTag<TextView>("connection_hint:car-bluetooth").text.toString())
    }

    @Test fun castingPrioritizesAirPlayAndDefersOnlyTheBackgroundCarPlayFailure() {
        TeslaBrowserLink.resetForTest()
        try {
            page.update("CarPlay failed", false, problem = BrowserConnectionProblem.FAILED)
            assertEquals("CarPlay failed | AirPlay stopped", page.status.text.toString())
            assertNotNull(page.view.findViewWithTag<View>("connection_hint:session"))

            TeslaBrowserLink.pauseCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            for ((state, expected) in listOf(
                "loading" to "AirPlay loading", "mirror" to "AirPlay mirroring",
                "playing" to "AirPlay playing", "paused" to "AirPlay paused",
                "playback-failed" to "AirPlay failed",
            )) {
                AirPlayReceiverService.publish(state)
                page.refresh()
                assertEquals("$expected | CarPlay waiting for AirPlay", page.status.text.toString())
                assertNull(page.view.findViewWithTag<View>("connection_hint:session"))
            }
            page.update("CarPlay failed", false, problem = BrowserConnectionProblem.USB_VPN)
            assertNotNull("Independent requirements stay actionable", page.view.findViewWithTag<View>("connection_hint:session"))

            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            page.update("CarPlay failed", false, problem = BrowserConnectionProblem.FAILED)
            assertEquals("CarPlay failed | AirPlay failed", page.status.text.toString())
            assertNotNull(page.view.findViewWithTag<View>("connection_hint:session"))
        } finally { TeslaBrowserLink.resetForTest() }
    }

    @Test fun missingPermissionsPointToChecklistAndRespectAudioOptOut() {
        shadowOf(activity).denyPermissions(android.Manifest.permission.RECORD_AUDIO)
        page.refresh()
        val message = page.view.findViewWithTag<TextView>("connection_hint:permissions").text.toString()
        assertTrue(message.contains(activity.getString(R.string.onboarding_help)))
        assertTrue(message.contains(activity.getString(R.string.settings_permission_microphone)))
        BrowserCarPlayAudioSettings.saveDisabled(activity, true)
        page.refresh()
        assertFalse(page.view.findViewWithTag<TextView>("connection_hint:permissions").text.contains(
            activity.getString(R.string.settings_permission_microphone)))
    }

    @Test fun bluetoothChangesRefreshWithoutSessionRecoveryOrReopeningSettings() {
        showSettingsWindow()
        page.draft.phoneAddress = "02:00:00:00:00:01"
        val adapter = shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter)
        adapter.setEnabled(false)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1_001))
        assertEquals(activity.getString(R.string.settings_hint_bluetooth),
            page.view.findViewWithTag<TextView>("connection_hint:phone").text.toString())
        adapter.setEnabled(true)
        activity.sendBroadcast(Intent(android.bluetooth.BluetoothAdapter.ACTION_STATE_CHANGED))
        shadowOf(Looper.getMainLooper()).idle()
        assertNull(page.view.findViewWithTag<View>("connection_hint:phone"))
    }

    @Test fun debugPerformanceHintFollowsTheProcessSwitchWithoutHidingOtherHints() {
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            page.update("Preparing", false, browserReady = false)
            page.refresh()
            assertEquals(activity.getString(R.string.settings_hint_debug_enabled),
                page.view.findViewWithTag<TextView>("connection_hint:debug").text.toString())
            assertNotNull(page.view.findViewWithTag<View>("connection_hint:browser-open"))
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            page.refresh()
            assertNull(page.view.findViewWithTag<View>("connection_hint:debug"))
        } finally { DiagnosticLogs.resetForTest() }
    }

    @Test fun mainPageHasNoManualConnectionActionOrLegacyNavigationOrVideoControls() {
        val labels = views().filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertEquals(0, labels.count { it == activity.getString(R.string.settings_carplay_reconnect) })
        assertEquals(1, labels.count { it == activity.getString(R.string.settings_browser_boot_connect) })
        for (id in listOf(R.string.settings, R.string.settings_main, R.string.exit_application,
            R.string.back, R.string.settings_gesture_fingers_label, R.string.settings_hevc_experimental,
            R.string.resolution, R.string.connect_with_usb)) assertFalse(labels.contains(activity.getString(id)))
        assertTrue(labels.contains(activity.getString(R.string.settings_advanced)))
        assertNull(page.view.findViewWithTag<View>("collapsed"))
    }
    @Test fun browserWaitReplacesReceiverTitleUntilTheCurrentPageIsReady() {
        page.update("CarPlay preparing", false, browserReady = false)
        assertEquals("Waiting for browser connection", page.status.text.toString())
        AirPlayReceiverService.publish("listening")
        page.refresh()
        assertEquals("Waiting for browser connection", page.status.text.toString())
        page.update("CarPlay preparing", false, browserReady = true)
        assertEquals("CarPlay preparing | AirPlay ready", page.status.text.toString())
    }

    @Test fun actualConnectionStatusStaysVisibleWithoutASeparateStatusTitle() {
        page.update("Connected to car browser", true)
        val labels = views().filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertFalse(labels.contains(activity.getString(R.string.settings_browser_connection_status)))
        assertEquals("Connected to car browser | AirPlay stopped", page.status.text.toString())
        assertTrue(page.status.isShown)
    }
    @Test fun aPlaceholderPhoneNameDoesNotPretendThatAnIphoneWasSelected() {
        page.draft.phoneAddress = null
        page.draft.phoneName = "iPhone"
        page.refresh()
        assertNotNull(button(R.string.choose_iphone))
        page.draft.phoneAddress = ""
        page.draft.phoneName = "Stale name"
        page.refresh()
        assertNotNull(button(R.string.choose_iphone))
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_selected_iphone, "Stale name") })
    }
    @Test fun connectionExplanationIsBelowTheShortStatusTitle() {
        page.update("CarPlay preparing", false, problem = BrowserConnectionProblem.USB_VPN)
        assertEquals("CarPlay preparing | AirPlay stopped", page.status.text.toString())
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(R.string.settings_hint_usb_vpn) })
        assertFalse(page.status.text.contains("permission"))
        page.update("CarPlay preparing", false, problem = BrowserConnectionProblem.USB_VPN)
        assertEquals(1, views().filterIsInstance<TextView>().count { it.isShown && it.text == activity.getString(R.string.settings_hint_usb_vpn) })
    }
    @Test fun aRealSavedIphoneChoiceKeepsItsNameAcrossRefreshAndRecreation() {
        val address = "02:00:00:00:00:01"
        DiPlayPreferences.savePhone(activity, address, "Driver iPhone")
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity), {}, {}, {})
        activity.setContentView(page.view)
        fun assertChoice() {
            assertTrue(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_selected_iphone, "Driver iPhone") })
            assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.choose_iphone) })
            assertEquals(address, page.draft.phoneAddress)
            assertEquals(address, DiPlayPreferences.phoneAddress(activity))
        }
        page.refresh()
        assertChoice()
        val state = Bundle()
        page.draft.retain(state)
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity, state), {}, {}, {})
        activity.setContentView(page.view)
        assertChoice()
    }
    @Test fun connectionChoicesHaveEqualFullWidthSpacing() {
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        page.view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        page.view.layout(0, 0, width, height)
        val buttons = views().filterIsInstance<Button>().filter {
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_carplay_connection_mode)) ||
                it.text == activity.getString(R.string.choose_iphone)
        }.toList()
        val gap = (8 * activity.resources.displayMetrics.density).toInt()
        val minimumTouchHeight = (48 * activity.resources.displayMetrics.density).toInt()
        assertEquals(gap, buttons[1].top - buttons[0].bottom)
        for (button in buttons) {
            assertEquals(buttons[0].left, button.left)
            assertEquals(buttons[0].right, button.right)
            assertTrue(button.height >= minimumTouchHeight)
        }
    }
    @Test fun receiverStatusKeepsActionableRequirementsInSeparateText() {
        assertEquals("CarPlay preparing | AirPlay stopped", page.status.text.toString())
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(R.string.settings_hint_phone_wireless) })
        page.draft.phoneAddress = "02:00:00:00:00:01"
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(false)
        page.refresh()
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(R.string.settings_hint_bluetooth) })
        page.transportSelected(false)
        assertFalse(views().filterIsInstance<Button>().any { it.isShown && it.text == activity.getString(R.string.settings_selected_iphone, page.draft.phoneName) })
        assertEquals("CarPlay preparing | AirPlay stopped", page.status.text.toString())
    }
    @Config(shadows = [DisabledHotspot::class])
    @Test fun idleReadinessReportsKnownHotspotOffAndUnknownWifi() {
        page.draft.phoneAddress = "02:00:00:00:00:01"
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        page.refresh()
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(R.string.settings_hint_hotspot_off) })
        choose(BrowserConnectionDraft.Source.LAN)
        views().filterIsInstance<EditText>().first().setText("Car AP")
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(R.string.settings_hint_wifi_unknown) })
    }
    @Config(shadows = [ChangingHotspot::class])
    @Test fun hotspotHintTracksBroadcastsAndLaterPlatformStateWithoutReopening() {
        showSettingsWindow()
        ChangingHotspot.state = 11
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1_001))
        assertEquals(activity.getString(R.string.settings_hint_hotspot_off),
            page.view.findViewWithTag<TextView>("connection_hint:network").text.toString())
        ChangingHotspot.state = 13
        activity.sendBroadcast(Intent("android.net.wifi.WIFI_AP_STATE_CHANGED"))
        shadowOf(Looper.getMainLooper()).idle()
        assertNull(page.view.findViewWithTag<View>("connection_hint:network"))
        ChangingHotspot.state = 11 // Firmware can update its query result after its broadcast.
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1_001))
        assertNotNull(page.view.findViewWithTag<View>("connection_hint:network"))
        page.dispose()
        ChangingHotspot.state = 13
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        assertNotNull(page.view.findViewWithTag<View>("connection_hint:network"))
    }
    @Implements(WifiManager::class)
    class ChangingHotspot : ShadowWifiManager() {
        companion object { var state = 11 }
        @Implementation fun getWifiApState(): Int = state
    }
    @Implements(WifiManager::class)
    class DisabledHotspot : ShadowWifiManager() {
        @Implementation fun getWifiApState(): Int = 11
    }
    @Test fun editingInvalidDraftDoesNotReplaceActiveSessionStatus() {
        page.update("Connected", true)
        views().filterIsInstance<EditText>().first().setText("")
        assertEquals("Connected | AirPlay stopped", page.status.text.toString())
        settleEdits()
        views().filterIsInstance<EditText>().first().setText("Another network")
        assertEquals("Connected | AirPlay stopped", page.status.text.toString())
    }
    @Test fun editingNetworkSavesAndAppliesAutomaticallyOnceTypingSettles() {
        page.update("Connected", true)
        val name = views().filterIsInstance<EditText>().first()
        name.setText("New")
        name.setText("New hotspot")
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        settleEdits()
        assertEquals(1, settingsChanges)
        assertEquals("New hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.save_and_reconnect) })
        assertNoManualConnection()
    }
    @Test fun existingWifiUsesTheExistingNetworkTransportAndActualCredentials() {
        choose(BrowserConnectionDraft.Source.LAN)
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_hotspot_read) })
        selectSecurity(1)
        val fields = views().filterIsInstance<EditText>().toList()
        fields[0].setText("Car AP"); fields[1].setText("external123")
        settleEdits()
        assertEquals(WirelessHotspotMode.EXISTING_WIFI, AirPlayPersistence.loadWirelessHotspotMode(activity))
        assertEquals("Car AP", AirPlayPersistence.loadExistingWifiSsid(activity))
        assertEquals(BrowserConnectionDraft.Source.LAN, BrowserConnectionDraft.load(activity).source)
        assertTrue(button(R.string.settings_external_ap_wifi).isShown)
    }
    @Test fun switchingNetworksKeepsEachDraftAndOnlyImportsTheLocalHotspot() {
        views().filterIsInstance<EditText>().first().setText("Draft phone")
        choose(BrowserConnectionDraft.Source.LAN)
        views().filterIsInstance<EditText>().first().setText("Draft LAN")
        choose(BrowserConnectionDraft.Source.LOCAL)
        assertEquals("Draft phone", views().filterIsInstance<EditText>().first().text.toString())
        choose(BrowserConnectionDraft.Source.LAN)
        assertEquals("Draft LAN", views().filterIsInstance<EditText>().first().text.toString())
        choose(BrowserConnectionDraft.Source.LOCAL)
        assertTrue(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.open_car_hotspot_settings) })
    }
    @Test fun invalidCredentialsShowAnErrorWithoutStartingOrSaving() {
        views().filterIsInstance<EditText>().first().setText("")
        settleEdits()
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertEquals(activity.getString(com.shilapi.xcertplay.orchestration.ManualHotspotValidation.Error.EMPTY_NAME.messageResource()),
            views().filterIsInstance<EditText>().first().error)
    }
    @Test fun securedExistingWifiRequiresAPasswordAndOpenIgnoresTheRetainedPassword() {
        choose(BrowserConnectionDraft.Source.LAN)
        page.draft.externalSsid = "Car AP"; page.draft.externalPassword = ""; page.draft.externalSecured = true
        assertEquals(R.string.wpa2_wpa3_password_must_be_8_63_characters, page.draft.validationError())
        page.draft.externalSecured = false
        assertNull(page.draft.validationError())
        page.draft.externalPassword = "password1"
        assertNull(page.draft.validationError())
        page.draft.save(activity)
        assertEquals("", AirPlayPersistence.loadExistingWifiPassphrase(activity))
        assertEquals("password1", page.draft.externalPassword)
    }
    @Test fun allExistingWifiSecurityChoicesSurviveSaveAndDraftRecreation() {
        choose(BrowserConnectionDraft.Source.LAN)
        for (security in ManualHotspotSecurity.entries) {
            selectSecurity(security.ordinal)
            page.draft.externalSsid = "Car AP"
            page.draft.externalPassword = "secretpass1"
            assertEquals(security, page.draft.externalSecurity)
            assertNull(page.draft.validationError())
            val state = Bundle(); page.draft.retain(state)
            assertEquals(security, BrowserConnectionDraft.load(activity, state).externalSecurity)
            page.draft.save(activity)
            assertEquals(security, BrowserExistingWifiSettings.loadSecurity(activity))
            assertEquals(security, BrowserConnectionDraft.load(activity).externalSecurity)
            assertEquals(if (security == ManualHotspotSecurity.OPEN) "" else "secretpass1",
                AirPlayPersistence.loadExistingWifiPassphrase(activity))
        }
    }
    @Test fun bootConnectionSwitchDoesNotEnableConnectionOnEveryOpen() {
        val toggle = views().filterIsInstance<android.widget.Switch>().single {
            it.text == activity.getString(R.string.settings_browser_boot_connect)
        }
        toggle.isChecked = true
        assertTrue(AirPlayPersistence.loadAutoStartOnBoot(activity))
        assertFalse(DiPlayPreferences.autoConnect(activity))
    }
    @Test fun usbKeepsNetworkConfigurationAndHotspotMethodActionsAvailable() {
        page.transportSelected(false)
        assertTrue(views().filterIsInstance<RadioButton>().count() == 2)
        assertTrue(button(R.string.open_car_hotspot_settings).isShown)
        HotspotExtraAddressSettings.saveMethod(activity, HotspotAddressMethod.SHIZUKU)
        choose(BrowserConnectionDraft.Source.LAN); choose(BrowserConnectionDraft.Source.LOCAL)
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_hotspot_read) })
        assertTrue(button(R.string.open_car_hotspot_settings).isShown)
        HotspotExtraAddressSettings.saveMethod(activity, HotspotAddressMethod.ROOT)
        choose(BrowserConnectionDraft.Source.LAN); choose(BrowserConnectionDraft.Source.LOCAL)
        assertTrue(button(R.string.settings_hotspot_read).isShown)
    }
    @Test fun mainPageOffersOnlyPhoneHotspotAndExistingWifi() {
        val choices = views().filterIsInstance<RadioButton>().toList()
        assertEquals(listOf(BrowserConnectionDraft.Source.LOCAL, BrowserConnectionDraft.Source.LAN), choices.map { it.tag })
        assertEquals(listOf(activity.getString(R.string.built_in_car_hotspot), activity.getString(R.string.existing_wifi_title)), choices.map { it.text.toString() })
    }
    @Test fun tiPlayModePrecedesCarPlayModeAndPhoneChoiceFollowsIt() {
        val controls = views().toList()
        val mode = controls.filterIsInstance<Button>().single {
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_carplay_connection_mode) + " · ")
        }
        assertNoManualConnection()
        fun addressButtons() = views().filterIsInstance<Button>().filter {
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_hotspot_address_repair) + " · ")
        }.toList()
        assertTrue(controls.indexOf(addressButtons().single()) < controls.indexOf(mode))
        assertTrue(controls.indexOf(mode) < controls.indexOf(button(R.string.choose_iphone)))
        choose(BrowserConnectionDraft.Source.LAN)
        assertEquals(1, addressButtons().size)
        choose(BrowserConnectionDraft.Source.LOCAL)
        assertEquals(1, addressButtons().size)
        page.transportSelected(false)
        assertEquals(1, addressButtons().size)
    }
    @Test fun securityPrecedesPasswordAndTogglingRetainsTheTypedDraftForBothNetworks() {
        for (source in BrowserConnectionDraft.Source.entries) {
            choose(source)
            views().filterIsInstance<EditText>().first().setText("Network name")
            selectSecurity(1)
            val password = views().filterIsInstance<EditText>().last()
            password.setText("typedsecret1")
            val ordered = views().toList()
            val passwordLabel = ordered.filterIsInstance<TextView>().single { it.text == activity.getString(R.string.hotspot_password) }
            assertTrue(ordered.indexOf(securityButton()) < ordered.indexOf(passwordLabel))
            assertTrue(password.isShown)
            selectSecurity(0)
            assertFalse(views().filterIsInstance<EditText>().last().isShown)
            assertFalse(views().filterIsInstance<TextView>().single { it.text == activity.getString(R.string.hotspot_password) }.isShown)
            assertNull(page.draft.validationError())
            assertEquals("typedsecret1", if (source == BrowserConnectionDraft.Source.LOCAL) page.draft.localPassword else page.draft.externalPassword)
            selectSecurity(1)
            assertTrue(views().filterIsInstance<EditText>().last().isShown)
            assertEquals("typedsecret1", views().filterIsInstance<EditText>().last().text.toString())
        }
    }
    @Test fun openLocalHotspotSavesWithoutTheHiddenRetainedPassword() {
        selectSecurity(0)
        assertFalse(views().filterIsInstance<EditText>().last().isShown)
        assertEquals("password1", page.draft.localPassword)
        assertNull(page.draft.validationError())
        settleEdits()
        assertEquals(ManualHotspotSecurity.OPEN, AirPlayPersistence.loadManualHotspotSecurity(activity))
        assertEquals("", AirPlayPersistence.loadManualHotspotPassphrase(activity))
        assertEquals("password1", page.draft.localPassword)
    }
    @Test fun usbDoesNotRequireWirelessCredentialsButKeepsBrowserNetworkFields() {
        page.draft.localSsid = ""; page.draft.localPassword = ""; page.draft.wireless = false
        assertNull(page.draft.validationError())
        page.draft.save(activity)
        assertFalse(AirPlayPersistence.loadWirelessEnabled(activity))
        assertFalse(DiPlayPreferences.autoConnectWireless(activity))
    }
    @Test fun draftSurvivesRecreationWithoutSavingOrOverwritingAdvancedSettings() {
        page.draft.source = BrowserConnectionDraft.Source.LAN
        page.draft.externalSsid = "Unsaved AP"; page.draft.externalPassword = "newsecret1"
        val state = Bundle(); page.draft.retain(state)
        AirPlayPersistence.saveFps(activity, 35)
        assertEquals(page.draft, BrowserConnectionDraft.load(activity, state))
        page.draft.save(activity)
        assertEquals(35, AirPlayPersistence.loadFps(activity))
    }
    @Test fun legacyExistingWifiMigratesToLanWithoutChangingItsTransport() {
        AirPlayPersistence.saveWirelessHotspotMode(activity, WirelessHotspotMode.EXISTING_WIFI)
        assertEquals(BrowserConnectionDraft.Source.LAN, BrowserConnectionDraft.load(activity).source)
        assertEquals(WirelessHotspotMode.EXISTING_WIFI, BrowserConnectionDraft.load(activity).mode)
    }
    @Test fun legacyExternalApPreferenceMigratesToExistingWifiAndPreservesCredentials() {
        AirPlayPersistence.saveWirelessHotspotMode(activity, WirelessHotspotMode.EXISTING_WIFI)
        AirPlayPersistence.saveExistingWifiCredentials(activity, "Saved car AP", "savedsecret1")
        activity.getSharedPreferences("tiplay_carplay", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_airplay_receiver", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_browser_network", 0).edit().putString("source", "EXTERNAL_AP").commit()
        val migrated = BrowserConnectionDraft.load(activity)
        assertEquals(BrowserConnectionDraft.Source.LAN, migrated.source)
        assertEquals(WirelessHotspotMode.EXISTING_WIFI, migrated.mode)
        assertEquals("Saved car AP", migrated.externalSsid)
        assertEquals("savedsecret1", migrated.externalPassword)
        assertTrue(migrated.externalSecured)
        migrated.save(activity)
        assertEquals("LAN", activity.getSharedPreferences("tiplay_browser_network", 0).getString("source", null))
        assertEquals("savedsecret1", AirPlayPersistence.loadExistingWifiPassphrase(activity))
    }
    @Test fun legacyExternalApRetainedDraftMigratesWithoutLosingUnsavedCredentials() {
        page.draft.source = BrowserConnectionDraft.Source.LAN
        page.draft.externalSsid = "Unsaved car AP"
        page.draft.externalPassword = "draftsecret1"
        page.draft.externalSecured = true
        val state = Bundle(); page.draft.retain(state)
        state.getBundle("browser_main_draft")!!.putString("source", "EXTERNAL_AP")
        assertEquals(page.draft, BrowserConnectionDraft.load(activity, state))
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertEquals(WirelessHotspotMode.MANUAL, AirPlayPersistence.loadWirelessHotspotMode(activity))
    }
    @Test fun settingsApplyAutomaticallyWithoutConnectionOrExitActions() {
        page.update("Connected", true)
        settleEdits()
        assertNoManualConnection()
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.connect_phone) })
    }
    @Test fun launcherGoesDirectlyToTheUnifiedHostPage() {
        val screen = Robolectric.buildActivity(DiPlayActivity::class.java,
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)).create().get()
        assertTrue(screen.isFinishing)
        assertEquals(CarPlayHostActivity::class.java.name, shadowOf(screen).nextStartedActivity.component!!.className)
    }
    @Config(qualifiers = "en-w640dp-h240dp")
    @Test fun shortWindowAndLargeTextKeepAllInputsAvailableByScrolling() {
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        page.view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        page.view.layout(0, 0, width, height)
        assertTrue(views().filterIsInstance<EditText>().count() >= 2)
        assertTrue(button(R.string.settings_advanced).height > 0)
        assertNoManualConnection()
    }
    @Test fun usbAttachmentUpdatesTheChoiceWithoutDiscardingOtherDraftFields() {
        page.update("Connected", true)
        page.draft.localSsid = "Incomplete hotspot"
        page.transportSelected(false)
        assertFalse(page.draft.wireless)
        assertEquals("Incomplete hotspot", page.draft.localSsid)
        assertTrue(views().filterIsInstance<EditText>().any())
        assertNoManualConnection()
    }
    @Test fun validIdleEditsNotifyTheHostWithoutCallingManualConnect() {
        views().filterIsInstance<EditText>().first().setText("Another hotspot")
        settleEdits()
        assertEquals("Another hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertEquals(1, settingsChanges)
        assertNoManualConnection()
    }
    @Test fun connectionFailureHasOneActionableHintWithoutAManualApplyAction() {
        page.update("Retrying", true)
        page.update("Retrying", false, problem = BrowserConnectionProblem.FAILED)
        assertNoManualConnection()
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(R.string.settings_hint_failed) })
        page.update("Preparing", false)
        assertNoManualConnection()
    }
    @Config(qualifiers = "en-w1000dp-h700dp")
    @Test fun wideWindowShowsConnectionActionsAndKeepsNetworkInputsReachableByScrolling() {
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        page.view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        page.view.layout(0, 0, width, height)
        val essentials = views().filter { it is TextView &&
            (it.text == activity.getString(R.string.settings_browser_boot_connect) ||
            it.text == activity.getString(R.string.choose_iphone) ||
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_carplay_connection_mode) + " · ")) }.toList()
        assertEquals(3, essentials.size)
        for (control in essentials) {
            var y = 0
            var current: View = control
            while (current !== page.view) {
                y += current.top
                current = current.parent as View
            }
            assertTrue("Core control below the fold: $control at $y", y + control.height <= height)
        }
        val scroll = page.view as android.widget.ScrollView
        val fields = views().filterIsInstance<EditText>().filter { it.isShown }.toList()
        assertEquals(2, fields.size)
        for (field in fields) {
            assertTrue(field.height > 0)
            val bounds = android.graphics.Rect()
            field.getDrawingRect(bounds)
            scroll.offsetDescendantRectToMyCoords(field, bounds)
            scroll.scrollTo(0, (bounds.bottom - height).coerceAtLeast(0))
            assertTrue("Network input cannot be reached by scrolling", bounds.bottom <= scroll.scrollY + height)
            assertTrue("Network input clipped above viewport", bounds.top >= scroll.scrollY)
        }
    }
    @Test fun restoredIncompleteDraftStaysEditableWithoutAnApplyButton() {
        page.draft.localSsid = ""
        val state = Bundle(); page.draft.retain(state)
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity, state), {}, {}, {})
        activity.setContentView(page.view)
        page.update("Connected", true)
        settleEdits()
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertNoManualConnection()
        assertEquals("", views().filterIsInstance<EditText>().first().text.toString())
    }
    @Test fun ordinaryAirPlayHasNoMainPageNavigationEntry() {
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_airplay_title) })
    }

    @Test fun automaticMessagesAreAllGroupedImmediatelyBelowTheStatus() {
        page.update("Preparing", false, problem = BrowserConnectionProblem.USB_VPN, browserReady = false)
        val area = page.view.findViewWithTag<android.widget.LinearLayout>("connection_hints")
        val parent = area.parent as android.widget.LinearLayout
        assertSame(page.status, parent.getChildAt(parent.indexOfChild(area) - 1))
        val hints = descendants(area).filterIsInstance<TextView>().filter { it.isShown }.toList()
        assertTrue(hints.any { it.text == activity.getString(R.string.settings_hint_usb_vpn) })
        assertTrue(hints.any { it.text == activity.getString(R.string.settings_hint_phone_wireless) })
        assertTrue(hints.any { it.tag == "connection_hint:browser-open" })
        assertEquals(hints.map { it.text.toString() }.distinct().size, hints.size)
    }

    @Test fun staleFailureDoesNotSurviveBrowserLossOrSuccessfulConnection() {
        page.update("Failed", false, problem = BrowserConnectionProblem.FAILED)
        fun visibleFailure() = views().filterIsInstance<TextView>().any {
            it.isShown && it.text == activity.getString(R.string.settings_hint_failed)
        }
        assertTrue(visibleFailure())
        page.update("Failed", false, browserReady = false, problem = BrowserConnectionProblem.FAILED)
        assertFalse(visibleFailure())
        page.update("Connected", true, problem = BrowserConnectionProblem.FAILED)
        assertFalse(visibleFailure())
        assertFalse(views().filterIsInstance<TextView>().any {
            it.isShown && (it.text == activity.getString(R.string.settings_hint_hotspot_unknown) ||
                it.text == activity.getString(R.string.settings_hint_wifi_unknown))
        })
        page.update("Waiting", false, browserReady = false, problem = BrowserConnectionProblem.USB_DEVICE)
        assertTrue(views().filterIsInstance<TextView>().any {
            it.isShown && it.text == activity.getString(R.string.requesting_iphone_usb_permission)
        })
    }

    @Test fun invalidDraftErrorStaysAtTheEditedFieldWithoutReplacingSessionState() {
        page.update("Connected", true)
        val field = views().filterIsInstance<EditText>().first()
        field.setText("")
        assertNull(field.error)
        settleEdits()
        assertNotNull(field.error)
        assertEquals("Connected | AirPlay stopped", page.status.text.toString())
        val area = page.view.findViewWithTag<android.widget.LinearLayout>("connection_hints")
        assertFalse(descendants(area).filterIsInstance<TextView>().any { it.text == field.error })
        field.setText("Repaired name")
        assertNull(field.error)
    }

    private fun showSettingsWindow() {
        controller.visible()
        // Robolectric attaches this Activity but leaves its window marked GONE.
        val attachInfo = org.robolectric.util.ReflectionHelpers.getField<Any>(page.view, "mAttachInfo")
        org.robolectric.util.ReflectionHelpers.setField(attachInfo, "mWindowVisibility", View.VISIBLE)
        assertTrue(page.view.isAttachedToWindow && page.view.isShown)
    }

    private fun assertNoManualConnection() {
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_carplay_reconnect) })
    }

    private fun settleEdits() { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(401)) }
    private fun securityButton() = views().filterIsInstance<Button>().single {
        it.text.toString().startsWith(activity.getString(R.string.security) + " ")
    }
    private fun selectSecurity(index: Int) {
        securityButton().performClick()
        shadowOf(requireNotNull(ShadowAlertDialog.getLatestAlertDialog())).clickOnItem(index)
    }
    private fun choose(source: BrowserConnectionDraft.Source) = views().filterIsInstance<RadioButton>().single { it.tag == source }.performClick()
    private fun button(id: Int) = views().filterIsInstance<Button>().single { it.text == activity.getString(id) }
    private fun views(): Sequence<View> = descendants(page.view)
    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (i in 0 until view.childCount) yieldAll(descendants(view.getChildAt(i)))
    }
}
