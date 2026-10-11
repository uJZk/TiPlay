package com.shilapi.xcertplay

import android.app.Activity
import android.content.Intent
import android.os.Bundle
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
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-w390dp-h844dp")
class BrowserMainPageTest {
    private lateinit var activity: Activity
    private lateinit var page: BrowserMainSettingsMenu
    private var connections = 0
    private var disconnects = 0
    @Before fun setup() {
        val controller = Robolectric.buildActivity(Activity::class.java)
        activity = controller.get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        controller.setup()
        activity.getSharedPreferences("diplay", 0).edit().clear().commit()
        activity.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        activity.getSharedPreferences("tiplay_browser_network", 0).edit().clear().commit()
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
            { page.draft.save(activity); page.committed(); connections++ }, { disconnects++ }, {}, {})
        activity.setContentView(page.view)
    }
    @Test fun mainPageHasOneConnectionActionAndNoLegacyNavigationOrVideoControls() {
        val labels = views().filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertEquals(1, labels.count { it == activity.getString(R.string.connect_phone) })
        assertEquals(1, labels.count { it == activity.getString(R.string.auto_start_on_boot) })
        for (id in listOf(R.string.settings, R.string.settings_main, R.string.exit_application,
            R.string.back, R.string.settings_gesture_fingers_label, R.string.settings_hevc_experimental,
            R.string.resolution, R.string.connect_with_usb)) assertFalse(labels.contains(activity.getString(id)))
        assertTrue(labels.contains(activity.getString(R.string.settings_advanced)))
        assertNull(page.view.findViewWithTag<View>("collapsed"))
    }
    @Test fun editingNetworkPreservesTheSavedConfigurationAndActiveConnection() {
        page.update("Connected", true)
        val name = views().filterIsInstance<EditText>().first()
        name.setText("New hotspot")
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertEquals(0, connections); assertEquals(0, disconnects)
        assertTrue(button(R.string.save_and_reconnect).isShown)
        assertTrue(button(R.string.disconnect).isShown)
        button(R.string.save_and_reconnect).performClick()
        assertEquals(1, connections)
        assertEquals("New hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertFalse(button(R.string.save_and_reconnect).isShown)
    }
    @Test fun existingWifiUsesTheExistingNetworkTransportAndActualCredentials() {
        choose(BrowserConnectionDraft.Source.LAN)
        assertFalse(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_hotspot_read) })
        selectSecurity(1)
        val fields = views().filterIsInstance<EditText>().toList()
        fields[0].setText("Car AP"); fields[1].setText("external123")
        button(R.string.save_and_reconnect).performClick()
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
        assertTrue(views().filterIsInstance<Button>().any { it.text == activity.getString(R.string.settings_hotspot_read) })
    }
    @Test fun invalidCredentialsShowAnErrorWithoutStartingOrSaving() {
        views().filterIsInstance<EditText>().first().setText("")
        button(R.string.save_and_reconnect).performClick()
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
    @Test fun mainPageOffersOnlyPhoneHotspotAndExistingWifi() {
        val choices = views().filterIsInstance<RadioButton>().toList()
        assertEquals(listOf(BrowserConnectionDraft.Source.LOCAL, BrowserConnectionDraft.Source.LAN), choices.map { it.tag })
        assertEquals(listOf(activity.getString(R.string.built_in_car_hotspot), activity.getString(R.string.existing_wifi_title)), choices.map { it.text.toString() })
    }
    @Test fun connectionModePrecedesConnectAndHotspotAddressOnlyFollowsLocalNetworkChoice() {
        val controls = views().toList()
        val mode = controls.filterIsInstance<Button>().single {
            it.text.toString().startsWith(activity.getString(R.string.settings_iphone_connection_mode) + " · ")
        }
        assertTrue(controls.indexOf(mode) < controls.indexOf(button(R.string.connect_phone)))
        fun addressButtons() = views().filterIsInstance<Button>().filter {
            it.text.toString().startsWith(activity.getString(R.string.settings_hotspot_address_method) + " · ")
        }.toList()
        val source = controls.filterIsInstance<RadioButton>().first()
        assertTrue(controls.indexOf(source) < controls.indexOf(addressButtons().single()))
        choose(BrowserConnectionDraft.Source.LAN)
        assertTrue(addressButtons().isEmpty())
        choose(BrowserConnectionDraft.Source.LOCAL)
        assertEquals(1, addressButtons().size)
        page.transportSelected(false)
        assertTrue(addressButtons().isEmpty())
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
        button(R.string.save_and_reconnect).performClick()
        assertEquals(1, connections)
        assertEquals(ManualHotspotSecurity.OPEN, AirPlayPersistence.loadManualHotspotSecurity(activity))
        assertEquals("", AirPlayPersistence.loadManualHotspotPassphrase(activity))
        assertEquals("password1", page.draft.localPassword)
    }
    @Test fun usbDoesNotRequireWirelessCredentialsAndHidesWirelessFields() {
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
        assertFalse(button(R.string.disconnect).isEnabled)
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
        page.draft.localSsid = "Unsaved hotspot"
        page.transportSelected(false)
        assertFalse(page.draft.wireless)
        assertEquals("Unsaved hotspot", page.draft.localSsid)
        assertTrue(views().filterIsInstance<EditText>().none())
        assertTrue(button(R.string.save_and_reconnect).isShown)
    }
    @Test fun choosingAnotherPhoneIsADraftUntilExplicitSubmit() {
        page.update("Connected", true)
        val oldAddress = DiPlayPreferences.phoneAddress(activity)
        page.draft.phoneAddress = "02:00:00:00:00:01"; page.draft.phoneName = "New iPhone"
        page.update("Connected", true)
        assertEquals(oldAddress, DiPlayPreferences.phoneAddress(activity))
        button(R.string.save_and_reconnect).performClick()
        assertEquals("02:00:00:00:00:01", DiPlayPreferences.phoneAddress(activity))
    }
    @Test fun connectionFailureOffersRetryEvenWithAnUnchangedDraft() {
        page.update("Retrying", true)
        page.showConnectionError("Check Wi-Fi")
        assertTrue(button(R.string.save_and_reconnect).isShown)
        assertTrue(views().filterIsInstance<TextView>().any { it.isShown && it.text == "Check Wi-Fi" })
        page.showConnectionError(null)
        assertFalse(button(R.string.save_and_reconnect).isShown)
    }
    @Config(qualifiers = "en-w1000dp-h700dp")
    @Test fun wideWindowShowsCoreConnectionControlsAboveTheFold() {
        val width = activity.resources.displayMetrics.widthPixels
        val height = activity.resources.displayMetrics.heightPixels
        page.view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        page.view.layout(0, 0, width, height)
        val essentials = views().filter { it is EditText || (it is TextView &&
            (it.text == activity.getString(R.string.connect_phone) ||
            it.text == activity.getString(R.string.auto_start_on_boot) ||
            it.text.toString().startsWith(activity.getString(R.string.settings_iphone_connection_mode) + " · "))) }.toList()
        assertTrue(essentials.size >= 5)
        for (control in essentials) {
            var y = 0
            var current: View = control
            while (current !== page.view) {
                y += current.top
                current = current.parent as View
            }
            assertTrue("Core control below the fold: $control at $y", y + control.height <= height)
        }
    }
    @Test fun restoredUnsavedDraftStillOffersSaveAndReconnect() {
        page.draft.localSsid = "Unsaved after rotation"
        val state = Bundle(); page.draft.retain(state)
        page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity, state), {}, {}, {}, {}, {})
        activity.setContentView(page.view)
        page.update("Connected", true)
        assertEquals("Phone hotspot", AirPlayPersistence.loadManualHotspotSsid(activity))
        assertTrue(button(R.string.save_and_reconnect).isShown)
        assertEquals("Unsaved after rotation", views().filterIsInstance<EditText>().first().text.toString())
    }
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
