package com.shilapi.xcertplay

import android.app.Activity

import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.Switch
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en")
class BrowserAdvancedPageTest {
    private lateinit var activity: Activity
    private lateinit var page: BrowserAdvancedPage
    private var returns = 0
    private var changes = 0
    private var progressShows = 0

    @Before fun setup() {
        val controller = Robolectric.buildActivity(Activity::class.java)
        activity = controller.get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        controller.setup()
        for (name in listOf("xcertplay_airplay", "diplay", "tiplay_permission_requests", "tiplay_airplay_receiver", "tiplay_browser_audio"))
            activity.getSharedPreferences(name, 0).edit().clear().commit()
        page = create()
        activity.setContentView(page.view)
    }

    @After fun cleanup() {
        AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
        DiagnosticLogs.resetForTest()
        activity.finish()
    }

    private fun create() = BrowserAdvancedPage(activity,
        changed = { changes++ },
        returnToMain = { returns++ }, showLogs = { progressShows++ })

    @Test fun advancedSettingsApplyImmediatelyAndReturnNeverAppliesAgain() {
        val audio = views(page.view).filterIsInstance<Switch>().single { it.text == activity.getString(R.string.settings_disable_carplay_audio) }
        audio.performClick()
        assertEquals(1, changes)
        assertEquals(0, returns)
        assertEquals(1, views(page.view).filterIsInstance<Button>().count { it.text == activity.getString(R.string.back) })
        button(R.string.back).performClick()
        assertEquals(1, returns)
        assertEquals(1, changes)
        audio.performClick()
        assertEquals(2, changes)
    }

    @Test fun recreationReadsAlreadyAppliedConfigurationWithoutPendingState() {
        val audio = views(page.view).filterIsInstance<Switch>().single { it.text == activity.getString(R.string.settings_disable_carplay_audio) }
        audio.performClick()
        val saved = BrowserCarPlayAudioSettings.disabled(activity)
        page = create()
        activity.setContentView(page.view)
        assertEquals(saved, views(page.view).filterIsInstance<Switch>().single { it.text == activity.getString(R.string.settings_disable_carplay_audio) }.isChecked)
        assertNotNull(button(R.string.back))
        assertEquals(1, changes)
    }

    @Test fun browserVideoHasNoManualCodecToggle() {
        assertFalse(views(page.view).filterIsInstance<TextView>().any {
            it.text.toString().contains("HEVC")
        })
    }

    @Test fun locationOptOutStillAppliesWithoutAPermissionChecklist() {
        val toggle = views(page.view).filterIsInstance<Switch>().single {
            it.text == activity.getString(R.string.settings_browser_location_disable)
        }
        assertFalse(toggle.isChecked)
        toggle.performClick()
        assertTrue(com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(activity))
        assertEquals(1, changes)
        toggle.performClick()
        assertFalse(com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(activity))
        assertEquals(2, changes)
    }

    @Test fun disablingAirPlayIsDefaultOffPersistsAndDoesNotRequireCarPlayReconnect() {
        val toggle = views(page.view).filterIsInstance<Switch>().single {
            it.text == activity.getString(R.string.settings_airplay_disable)
        }
        assertFalse(toggle.isChecked)
        toggle.performClick()
        assertTrue(AirPlayReceiverSettings.isDisabled(activity))
        assertEquals(0, changes)
        page = create()
        activity.setContentView(page.view)
        val recreated = views(page.view).filterIsInstance<Switch>().single {
            it.text == activity.getString(R.string.settings_airplay_disable)
        }
        assertTrue(recreated.isChecked)
        recreated.performClick()
        assertFalse(AirPlayReceiverSettings.isDisabled(activity))
    }

    @Test fun debugDescriptionIsNotRepeatedOnTheSettingsPage() {
        val description = activity.getString(R.string.settings_debug_mode_description)
        assertFalse(views(page.view).filterIsInstance<TextView>().any { it.text == description })
        val toggle = views(page.view).filterIsInstance<Switch>().single {
            it.text == activity.getString(R.string.settings_debug_logging)
        }
        assertEquals(1, (toggle.parent as ViewGroup).childCount)
    }

    @Test fun debugSwitchAndViewLogsAreSeparateAndApplyWithoutReconnect() {
        val toggle = views(page.view).filterIsInstance<Switch>().single {
            it.text == activity.getString(R.string.settings_debug_logging)
        }
        assertFalse(toggle.isChecked)
        button(R.string.settings_view_logs).performClick()
        assertEquals(1, progressShows)
        assertEquals(DiagnosticLogLevel.STANDARD, AirPlayPersistence.loadDiagnosticLogLevel(activity))
        toggle.performClick()
        assertEquals(DiagnosticLogLevel.DEBUG, AirPlayPersistence.loadDiagnosticLogLevel(activity))
        assertEquals(1, progressShows)
        assertFalse(DiagnosticLogDialog.claimRestartPrompt())
        assertEquals(0, changes)
        page = create()
        assertTrue(views(page.view).filterIsInstance<Switch>().single {
            it.text == activity.getString(R.string.settings_debug_logging)
        }.isChecked)
        button(R.string.settings_view_logs).performClick()
        assertEquals(2, progressShows)
        assertEquals(1, views(page.view).filterIsInstance<Button>().count {
            it.text == activity.getString(R.string.settings_view_logs)
        })
    }

    @Test fun productAdvancedHasOnlyRequestedDescriptionsAndOneReportAction() {
        val labels = views(page.view).filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertEquals(1, labels.count { it == activity.getString(R.string.place_carplay_s_controls_closer_to_the_driver) })
        for (id in listOf(R.string.settings_browser_next_connection_hint, R.string.settings_browser_advanced_summary,
            R.string.choose_save_location, R.string.wireless_connection_help, R.string.choose_image))
            assertFalse(labels.contains(activity.getString(id)))
        assertFalse(labels.any { it.startsWith(activity.getString(R.string.settings_permission_microphone) + " ") })
        button(R.string.settings_view_logs).performClick()
        assertEquals(1, progressShows)
    }

    @Test fun advancedSettingsNeverRenderADuplicatePermissionChecklist() {
        page.refresh()
        val labels = views(page.view).filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertFalse(labels.contains(activity.getString(R.string.settings_permission_group)))
        for (id in listOf(R.string.nearby_devices, R.string.settings_permission_location,
            R.string.settings_permission_microphone, R.string.settings_permission_notifications))
            assertFalse(labels.any { it.startsWith(activity.getString(id) + " ") })
    }

    @Test fun aboutStartsWithReturnAndPreservesOriginalDescriptionsAndVersionAlone() {
        val root = BrowserAboutPage.build(activity, "0.2.13") { }
        val text = views(root).filterIsInstance<TextView>().map { it.text.toString() }.toList()
        assertEquals(activity.getString(R.string.back), text.first())
        assertTrue(text.contains("0.2.13"))
        assertTrue(text.contains(activity.getString(R.string.carplay_at_home_in_your_car)))
        assertTrue(text.contains(activity.getString(R.string.an_independent_carplay_receiver_for_android_head_units_wir)))
        assertFalse(text.any { it.contains(activity.getString(R.string.about_public_preview_prefix)) })
    }

    private fun button(id: Int) = views(page.view).filterIsInstance<Button>().single { it.text == activity.getString(id) }
    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }
}
