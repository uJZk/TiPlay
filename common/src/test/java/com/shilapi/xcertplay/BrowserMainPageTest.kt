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
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowWifiManager
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-w390dp-h844dp")
class BrowserMainPageTest {
    private lateinit var activity: Activity
    private lateinit var page: BrowserMainSettingsMenu
    private var connections = 0
    private var disconnects = 0
    private var settingsChanges = 0
    @Before fun setup() {
        val controller = Robolectric.buildActivity(Activity::class.java)
        activity = controller.get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        controller.setup()
        activity.getSharedPreferences("diplay", 0).edit().clear().commit()
        activity.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_browser_network", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_hotspot_address", 0).edit().clear().commit()
        AirPlayPersistence.saveWirelessHotspotMode(activity, WirelessHotspotMode.MANUAL)
        AirPlayPersistence.saveManualHotspotSsid(activity, "Phone hotspot")
        AirPlayPersistence.saveManualHotspotPassphrase(activity, "password1")
        AirPlayPersistence.saveManualHotspotSecurity(activity, com.shilapi.xcertplay.orchestration.ManualHotspotSecurity.WPA2)
        if (activity.resources.configuration.screenHeightDp <= 240) {
            activity.resources.configuration.fontScale = 1.5f
            @Suppress("DEPRECATION")
            activity.resources.displayMetrics.scaledDensity = activity.resources.displayMetrics.density * 1.5f
        }
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity), {},
            { page.draft.save(activity); page.committed(); connections++ }, { disconnects++ }, {}, {}, { settingsChanges++ })
        activity.setContentView(page.view)
    }
    @Test fun mainPageHasOneConnectionActionAndNoLegacyNavigationOrVideoControls() {
        val labels = views().filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertEquals(1, labels.count { it == activity.getString(R.string.connect_phone) })
        assertEquals(1, labels.count { it == activity.getString(R.string.settings_browser_boot_connect) })
        for (id in listOf(R.string.settings, R.string.settings_main, R.string.exit_application,
            R.string.back, R.string.settings_gesture_fingers_label, R.string.settings_hevc_experimental,
            R.string.resolution, R.string.connect_with_usb)) assertFalse(labels.contains(activity.getString(id)))
        assertTrue(labels.contains(activity.getString(R.string.settings_advanced)))
        assertNull(page.view.findViewWithTag<View>("collapsed"))
    }
    @Test fun actualConnectionStatusStaysVisibleWithoutASeparateStatusTitle() {
        page.update("Connected to car browser", true)
        val labels = views().filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertFalse(labels.contains(activity.getString(R.string.settings_browser_connection_status)))
        assertEquals("Connected to car browser", page.status.text.toString())
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
    @Test fun aRealSavedIphoneChoiceKeepsItsNameAcrossRefreshAndRecreation() {
        val address = "02:00:00:00:00:01"
        DiPlayPreferences.savePhone(activity, address, "Driver iPhone")
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity), {}, {}, {}, {}, {})
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
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity, state), {}, {}, {}, {}, {})
        activity.setContentView(page.view)
        assertChoice()
    }
    @Test fun firstThreeConnectionButtonsHaveEqualFullWidthSpacing() {
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        page.view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        page.view.layout(0, 0, width, height)
        val buttons = views().filterIsInstance<Button>().take(3).toList()
        val gap = (8 * activity.resources.displayMetrics.density).toInt()
        val minimumTouchHeight = (48 * activity.resources.displayMetrics.density).toInt()
        assertEquals(gap, buttons[1].top - buttons[0].bottom)
        assertEquals(gap, buttons[2].top - buttons[1].bottom)
        for (button in buttons) {
            assertEquals(buttons[0].left, button.left)
            assertEquals(buttons[0].right, button.right)
            assertTrue(button.height >= minimumTouchHeight)
        }
    }
    @Test fun idleReadinessTracksPhoneSelectionAndDraftRequirements() {
        assertEquals(activity.getString(R.string.choose_your_iphone), page.status.text.toString())
        page.draft.phoneAddress = "02:00:00:00:00:01"
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(false)
        page.refresh()
        assertEquals(activity.getString(R.string.turn_on_bluetooth), page.status.text.toString())
        views().filterIsInstance<EditText>().first().setText("")
        assertEquals(activity.getString(requireNotNull(page.draft.validationError())), page.status.text.toString())
        views().filterIsInstance<EditText>().first().setText("Phone hotspot")
        views().filterIsInstance<EditText>().last().setText("short")
        assertEquals(activity.getString(requireNotNull(page.draft.validationError())), page.status.text.toString())
        page.update("Connecting", false)
        views().filterIsInstance<EditText>().last().setText("password1")
        assertEquals("Connecting", page.status.text.toString())
        page.update("", false, idle = true)
        assertEquals(activity.getString(R.string.turn_on_bluetooth), page.status.text.toString())
        page.draft.phoneAddress = null
        page.transportSelected(false)
        assertEquals(activity.getString(R.string.ready_when_you_are), page.status.text.toString())
    }
    @Config(shadows = [DisabledHotspot::class])
    @Test fun idleReadinessReportsKnownHotspotOffAndUnmatchedExistingWifi() {
        page.draft.phoneAddress = "02:00:00:00:00:01"
        shadowOf(activity.getSystemService(BluetoothManager::class.java).adapter).setEnabled(true)
        page.refresh()
        assertEquals(activity.getString(R.string.hotspot_details_off), page.status.text.toString())
        choose(BrowserConnectionDraft.Source.LAN)
        views().filterIsInstance<EditText>().first().setText("Car AP")
        assertEquals(activity.getString(R.string.settings_external_ap_check), page.status.text.toString())
    }
    @Implements(WifiManager::class)
    class DisabledHotspot : ShadowWifiManager() {
        @Implementation fun getWifiApState(): Int = 11
    }
    @Test fun editingInvalidDraftDoesNotReplaceActiveSessionStatus() {
        page.update("Connected", true)
        views().filterIsInstance<EditText>().first().setText("")
        assertEquals("Connected", page.status.text.toString())
        button(R.string.disconnect).performClick()
        views().filterIsInstance<EditText>().first().setText("Another network")
        assertEquals(activity.getString(R.string.settings_main_stopping), page.status.text.toString())
    }
    @Test fun editingNetworkSavesAndAppliesAutomaticallyOnceTypingSettles() {
        page.update("Connected", true)
        val name = views().filterIsInstance<EditText>().first()
        name.setText("New")
        name.setText("New hotspot")
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        settleEdits()
        assertEquals(1, settingsChanges)
        assertEquals(0, connections)
        assertEquals(0, disconnects)
        assertEquals("New hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.save_and_reconnect) })
        assertFalse(button(R.string.connect_phone).isShown)
        assertTrue(button(R.string.disconnect).isShown)
    }
    @Test fun existingWifiUsesTheExistingNetworkTransportAndActualCredentials() {
        choose(BrowserConnectionDraft.Source.LAN)
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_hotspot_read) })
        selectSecurity(1)
        val fields = views().filterIsInstance<EditText>().toList()
        fields[0].setText("Car AP"); fields[1].setText("external123")
        button(R.string.connect_phone).performClick()
        assertEquals(1, connections)
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
        button(R.string.connect_phone).performClick()
        assertEquals(0, connections)
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == activity.getString(com.shilapi.xcertplay.orchestration.ManualHotspotValidation.Error.EMPTY_NAME.messageResource()) })
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
        assertTrue(button(R.string.settings_hotspot_read).isShown)
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.open_car_hotspot_settings) })
    }
    @Test fun mainPageOffersOnlyPhoneHotspotAndExistingWifi() {
        val choices = views().filterIsInstance<RadioButton>().toList()
        assertEquals(listOf(BrowserConnectionDraft.Source.LOCAL, BrowserConnectionDraft.Source.LAN), choices.map { it.tag })
        assertEquals(listOf(activity.getString(R.string.built_in_car_hotspot), activity.getString(R.string.existing_wifi_title)), choices.map { it.text.toString() })
    }
    @Test fun connectionModePrecedesConnectAndHotspotAddressOnlyFollowsLocalNetworkChoice() {
        val controls = views().toList()
        val mode = controls.filterIsInstance<Button>().single {
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_carplay_connection_mode) + " · ")
        }
        assertTrue(controls.indexOf(mode) < controls.indexOf(button(R.string.connect_phone)))
        fun addressButtons() = views().filterIsInstance<Button>().filter {
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_hotspot_address_repair) + " · ")
        }.toList()
        val source = controls.filterIsInstance<RadioButton>().first()
        assertTrue(controls.indexOf(source) < controls.indexOf(addressButtons().single()))
        choose(BrowserConnectionDraft.Source.LAN)
        assertTrue(addressButtons().isEmpty())
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
        button(R.string.connect_phone).performClick()
        assertEquals(1, connections)
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
    @Test fun disconnectIsExplicitAndHasNoExitApplicationAction() {
        page.update("Connected", true)
        button(R.string.disconnect).performClick()
        assertEquals(1, disconnects); assertEquals(0, connections)
        assertFalse(button(R.string.settings_main_stopping).isEnabled)
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
        assertTrue(button(R.string.connect_phone).height > 0)
    }
    @Test fun usbAttachmentUpdatesTheChoiceWithoutDiscardingOtherDraftFields() {
        page.update("Connected", true)
        page.draft.localSsid = "Incomplete hotspot"
        page.transportSelected(false)
        assertFalse(page.draft.wireless)
        assertEquals("Incomplete hotspot", page.draft.localSsid)
        assertTrue(views().filterIsInstance<EditText>().any())
        assertFalse(button(R.string.connect_phone).isShown)
    }
    @Test fun validIdleEditsSaveWithoutStartingAConnection() {
        views().filterIsInstance<EditText>().first().setText("Another hotspot")
        settleEdits()
        assertEquals("Another hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertEquals(1, settingsChanges)
        assertEquals(0, connections)
        assertTrue(button(R.string.connect_phone).isShown)
    }
    @Test fun connectionFailureKeepsDisconnectAvailableWithoutAnApplyAction() {
        page.update("Retrying", true)
        page.showConnectionError("Check Wi-Fi")
        assertFalse(button(R.string.connect_phone).isShown)
        assertTrue(button(R.string.disconnect).isShown)
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == "Check Wi-Fi" })
        page.showConnectionError(null)
        assertFalse(button(R.string.connect_phone).isShown)
    }
    @Config(qualifiers = "en-w1000dp-h700dp")
    @Test fun wideWindowShowsConnectionActionsAndKeepsNetworkInputsReachableByScrolling() {
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        page.view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        page.view.layout(0, 0, width, height)
        val essentials = views().filter { it is TextView &&
            (it.text == activity.getString(R.string.connect_phone) ||
            it.text == activity.getString(R.string.settings_browser_boot_connect) ||
            it.text == activity.getString(R.string.choose_iphone) ||
            it.text.toString().startsWith(activity.getString(R.string.settings_browser_carplay_connection_mode) + " · ")) }.toList()
        assertEquals(4, essentials.size)
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
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity, state), {}, {}, {}, {}, {})
        activity.setContentView(page.view)
        page.update("Connected", true)
        settleEdits()
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertFalse(button(R.string.connect_phone).isShown)
        assertEquals("", views().filterIsInstance<EditText>().first().text.toString())
    }
    @Test fun ordinaryAirPlayHasNoMainPageNavigationEntry() {
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_airplay_title) })
        assertEquals(0, connections)
        assertEquals(0, disconnects)
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
