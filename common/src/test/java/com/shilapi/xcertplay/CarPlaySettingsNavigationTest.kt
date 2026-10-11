package com.shilapi.xcertplay

import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import android.widget.Switch
import android.view.Surface
import android.content.DialogInterface
import android.os.Looper
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.media.AndroidMediaSink
import com.shilapi.xcertplay.host.R
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog
import org.mockito.Mockito.mock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-w1000dp-h700dp")
class CarPlaySettingsNavigationTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private var activity: DiPlayActivity? = null

    @After fun tearDown() {
        activity?.finish()
        CarPlayBackgroundSession.clear()
        PendingReconnect.clear()
        context.getSharedPreferences("diplay", 0).edit().clear().commit()
        context.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
    }

    @Test fun oldDisplayEntryNowOpensTheConsolidatedAdvancedMenu() {
        val screen = open(SettingsCategory.DISPLAY)
        val labels = labels(screen)
        assertFalse(labels.any { it.startsWith(screen.getString(R.string.carplay_night_mode)) })
        assertFalse(labels.any { it.startsWith(screen.getString(R.string.settings_interface_size)) })
        for (id in listOf(R.string.resolution, R.string.carplay_size)) {
            assertFalse("Duplicate host control: ${screen.getString(id)}",
                labels.any { it.startsWith(screen.getString(id)) })
        }
        assertFalse(labels.contains(screen.getString(R.string.settings_overview)))
        assertFalse(labels.contains(screen.getString(R.string.settings_search)))
        assertTrue(labels.any { it == screen.getString(R.string.frame_rate) + " · 60 fps" })
        assertTrue(labels.contains(screen.getString(R.string.settings_browser_hevc_title)))
        assertEquals(SettingsCategory.ADVANCED, CarPlaySettingsNavigation.category(screen.intent))
    }

    @Test fun connectionPageDoesNotDuplicateMainMenuBrowserOrStartupControls() {
        val screen = open(SettingsCategory.CONNECTION)
        val labels = labels(screen)
        assertFalse(labels.contains(screen.getString(R.string.settings_phone_browser_mode)))
        assertFalse(labels.contains(screen.getString(R.string.connect_when_diplay_opens)))
        assertFalse(labels.any { it.startsWith(screen.getString(R.string.settings_browser_page_address)) })
        assertFalse(labels.contains(screen.getString(R.string.open_connection_setup)))
        assertFalse(labels.contains(screen.getString(R.string.open_after_the_car_starts)))
    }

    @Test fun advancedPageIncludesVideoVehicleAndDiagnosticsWithoutIdentityFields() {
        val screen = open(SettingsCategory.ADVANCED)
        val labels = labels(screen)
        assertFalse(labels.contains(screen.getString(R.string.call_echo_cancellation)))
        assertFalse(labels.contains(screen.getString(R.string.split_screen_areas)))
        assertFalse(labels.contains(screen.getString(R.string.efficient_video)))
        assertFalse(labels.contains(screen.getString(R.string.advanced_audio_channel_mapping)))
        for (id in listOf(R.string.settings_browser_hevc_title, R.string.right_hand_drive,
            R.string.diagnostics, R.string.save_diagnostic_report)) {
            assertTrue(screen.getString(id), labels.contains(screen.getString(id)))
        }
        for (id in listOf(R.string.manufacturer, R.string.model, R.string.oem_label,
            R.string.mfi_certificate_signing_target)) {
            assertFalse(screen.getString(id), labels.contains(screen.getString(id)))
        }
    }

    @Test fun backReturnsDirectlyToTheMainPageWithoutApplyingUnchangedSettings() {
        val screen = open(SettingsCategory.AUDIO)
        descendants(screen.window.decorView).filterIsInstance<Button>()
            .single { it.text == screen.getString(R.string.back) }.performClick()
        val intent = shadowOf(screen).nextStartedActivity
        assertEquals(CarPlayHostActivity::class.java.name, intent.component!!.className)
        assertTrue(intent.getBooleanExtra(CarPlaySettingsNavigation.MAIN, false))
        assertFalse(intent.getBooleanExtra(CarPlaySettingsNavigation.APPLY, false))
        assertTrue(screen.isFinishing)
    }

    @Test fun advancedVideoChangesSaveForTheNextConnectionWithoutInterruptingCarPlay() {
        val screen = open(SettingsCategory.ADVANCED)
        val session = mock(CarPlayController::class.java)
        var stops = 0
        CarPlayBackgroundSession.store(session, mock(AndroidMediaSink::class.java), 800, 480, Any(),
            CarPlaySessionDisplay(800, 480, Surface.ROTATION_0, false, false, 800, 480)) { stops++ }
        CarPlayBackgroundSession.active = true
        assertEquals(60, AirPlayPersistence.loadFps(context))
        assertTrue(AirPlayPersistence.loadHevcEnabled(context))
        val frameRate = descendants(screen.window.decorView).filterIsInstance<Button>().single {
            it.text.toString().startsWith(screen.getString(R.string.frame_rate) + " · ")
        }
        frameRate.performClick()
        var dialog = ShadowAlertDialog.getLatestAlertDialog()
        dialog.getButton(DialogInterface.BUTTON_NEGATIVE).performClick()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(60, AirPlayPersistence.loadFps(context))
        assertFalse(PendingReconnect.isPending(session))
        frameRate.performClick()
        dialog = ShadowAlertDialog.getLatestAlertDialog()
        shadowOf(dialog).clickOnItem(0)
        assertFalse(dialog.isShowing)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(30, AirPlayPersistence.loadFps(context))
        assertTrue(PendingReconnect.isPending(session))
        PendingReconnect.clear()
        descendants(screen.window.decorView).filterIsInstance<Switch>().single {
            it.contentDescription == screen.getString(R.string.settings_browser_hevc_title)
        }.performClick()
        assertFalse(AirPlayPersistence.loadHevcEnabled(context))
        assertTrue(PendingReconnect.isPending(session))
        assertSame(session, CarPlayBackgroundSession.snapshot()?.controller)
        assertEquals(0, stops)
        assertNull(shadowOf(screen).nextStartedActivity)
        descendants(screen.window.decorView).filterIsInstance<Button>().single {
            it.text == screen.getString(R.string.settings_return_and_apply)
        }.performClick()
        assertTrue(shadowOf(screen).nextStartedActivity.getBooleanExtra(CarPlaySettingsNavigation.APPLY, false))
        assertTrue(screen.isFinishing)
    }

    @Test fun searchIndexesAdditionalPagesWithoutReintroducingTheOldOverviewOrResolutionControl() {
        val screen = open(SettingsCategory.DISPLAY)
        @Suppress("UNCHECKED_CAST")
        val results = screen.javaClass.getDeclaredMethod("buildSettingsSearchIndex")
            .apply { isAccessible = true }.invoke(screen) as List<DiPlayActivity.SettingsSearchResult>
        assertFalse(results.any { it.title == screen.getString(R.string.settings_phone_browser_mode) })
        assertFalse(results.any { it.category == SettingsCategory.OVERVIEW })
        assertFalse(results.any { it.title.startsWith(screen.getString(R.string.resolution)) })
        assertEquals(setOf(SettingsCategory.ADVANCED), results.map { it.category }.toSet())
        assertTrue(results.any { it.title == screen.getString(R.string.frame_rate) })
        assertTrue(results.any { it.title == screen.getString(R.string.settings_hevc_experimental) })
        assertTrue(results.any { it.title == screen.getString(R.string.save_diagnostic_report) })
    }

    @Test fun homeSettingsButtonOpensTheHostMenu() {
        val screen = Robolectric.buildActivity(DiPlayActivity::class.java).setup().get().also { activity = it }
        descendants(screen.window.decorView).filterIsInstance<Button>()
            .single { it.text == screen.getString(R.string.settings) }.performClick()
        val intent = shadowOf(screen).nextStartedActivity
        assertEquals(CarPlayHostActivity::class.java.name, intent.component!!.className)
        assertTrue(intent.getBooleanExtra(CarPlaySettingsNavigation.MENU, false))
    }

    private fun open(category: SettingsCategory) = Robolectric.buildActivity(DiPlayActivity::class.java,
        CarPlaySettingsNavigation.pageIntent(context, category)).setup().get().also { activity = it }

    private fun labels(screen: DiPlayActivity) = descendants(screen.window.decorView)
        .filterIsInstance<TextView>().map { it.text.toString() }.toList()

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }
}
