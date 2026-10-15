package com.shilapi.xcertplay

import android.Manifest
import android.content.DialogInterface
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.shilapi.xcertplay.host.R
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
@Config(sdk = [33], qualifiers = "en-w320dp-h480dp")
class FirstUseActivityTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Before fun clearSetup() {
        for (name in listOf("tiplay_first_use", "xcertplay_airplay", "tiplay_carplay", "diplay",
            "tiplay_browser_network", "tiplay_permission_requests", "tiplay_browser_audio"))
            context.getSharedPreferences(name, 0).edit().clear().commit()
        // USB needs no saved iPhone/network credentials. Tests of wireless validate them separately.
        BrowserCarPlaySettings.saveMode(context, BrowserCarPlaySettings.Mode.USB)
    }

    @Test fun firstOpenShowsChecklistAndSubsequentOpenRoutesToMain() {
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val activity = controller.get()
        assertNull(shadowOf(activity).nextStartedActivity)
        assertNotNull(button(activity, R.string.onboarding_grant_missing))
        assertNull(shadowOf(activity).nextStartedActivity)
        finishSetup(activity)
        assertEquals(CarPlayHostActivity::class.java.name, shadowOf(activity).nextStartedActivity.component?.className)
        assertTrue(activity.isFinishing)
        controller.pause().stop().destroy()
        val next = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        assertTrue(next.get().isFinishing)
        assertEquals(CarPlayHostActivity::class.java.name, shadowOf(next.get()).nextStartedActivity.component?.className)
        next.pause().stop().destroy()
    }

    @Test fun oldIntroductionCompletionDoesNotSkipActualSetup() {
        context.getSharedPreferences("tiplay_first_use", 0).edit().putBoolean("completed", true).commit()
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        assertFalse(controller.get().isFinishing)
        assertNotNull(button(controller.get(), R.string.onboarding_grant_missing))
        controller.pause().stop().destroy()
    }

    @Test fun wirelessChecklistDoesNotRequireOrModifyConnectionConfiguration() {
        BrowserCarPlaySettings.saveMode(context, BrowserCarPlaySettings.Mode.WIRELESS)
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val activity = controller.get()
        assertTrue(views(activity.window.decorView).filterIsInstance<TextView>()
            .any { it.text == activity.getString(R.string.onboarding_help) })
        assertFalse(views(activity.window.decorView).filterIsInstance<Button>()
            .any { it.text == activity.getString(R.string.choose_iphone) })
        assertNull(BrowserConnectionDraft.load(context).phoneAddress)
        finishSetup(activity)
        assertTrue(context.getSharedPreferences("tiplay_first_use", 0).getBoolean("setup_completed", false))
        assertEquals(BrowserCarPlaySettings.Mode.WIRELESS, BrowserCarPlaySettings.mode(context))
        assertNull(BrowserConnectionDraft.load(context).phoneAddress)
        controller.pause().stop().destroy()
    }

    @Test fun permanentlyDeniedBluetoothCanBeRecoveredFromChecklist() {
        BrowserCarPlaySettings.saveMode(context, BrowserCarPlaySettings.Mode.WIRELESS)
        shadowOf(context).grantPermissions(Manifest.permission.NEARBY_WIFI_DEVICES)
        shadowOf(context).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        context.getSharedPreferences("tiplay_permission_requests", 0).edit()
            .putBoolean(Manifest.permission.BLUETOOTH_CONNECT, true).commit()
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        views(controller.get().window.decorView).filterIsInstance<Button>().single {
            it.text.startsWith(controller.get().getString(R.string.nearby_devices) + " ")
        }.performClick()
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, shadowOf(controller.get()).nextStartedActivity.action)
        assertFalse(controller.get().isFinishing)
        controller.pause().stop().destroy()
    }

    @Test fun recreationShowsOnlyChecklistAndBackDoesNotCompleteIt() {
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val saved = Bundle()
        controller.saveInstanceState(saved).pause().stop().destroy()
        saved.putInt("first_use_step", 2) // Old wizard state cannot restore a removed step.
        val restored = Robolectric.buildActivity(FirstUseActivity::class.java).create(saved).start().resume().visible()
        val activity = restored.get()
        assertTrue(views(activity.window.decorView).filterIsInstance<TextView>()
            .any { it.text == activity.getString(R.string.onboarding_help) })
        assertNotNull(button(activity, R.string.onboarding_grant_missing))
        activity.onBackPressedDispatcher.onBackPressed()
        assertTrue(activity.isFinishing)
        assertFalse(context.getSharedPreferences("tiplay_first_use", 0).getBoolean("setup_completed", false))
        restored.pause().stop().destroy()
    }

    @Test fun grantMissingRequestsOnlyMissingAndRefreshesAfterResult() {
        val granted = arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.NEARBY_WIFI_DEVICES,
            Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)
        shadowOf(context).grantPermissions(*granted)
        shadowOf(context).denyPermissions(Manifest.permission.RECORD_AUDIO)
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val activity = controller.get()
        button(activity, R.string.onboarding_grant_missing).performClick()
        val request = shadowOf(activity).lastRequestedPermission
        assertArrayEquals(arrayOf(Manifest.permission.RECORD_AUDIO), request.requestedPermissions)
        shadowOf(context).grantPermissions(Manifest.permission.RECORD_AUDIO)
        activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions, intArrayOf(PackageManager.PERMISSION_GRANTED))
        assertNotNull(button(activity, R.string.onboarding_finish))
        assertFalse(context.getSharedPreferences("tiplay_first_use", 0).getBoolean("setup_completed", false))
        controller.pause().stop().destroy()
    }

    @Test fun disabledFeaturesDoNotRequestMicrophoneOrLocation() {
        BrowserCarPlayAudioSettings.saveDisabled(context, true)
        com.shilapi.xcertplay.location.BrowserLocationSettings.setDisabled(context, true)
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        button(controller.get(), R.string.onboarding_grant_missing).performClick()
        val requested = shadowOf(controller.get()).lastRequestedPermission.requestedPermissions.toList()
        assertFalse(Manifest.permission.RECORD_AUDIO in requested)
        assertFalse(Manifest.permission.ACCESS_FINE_LOCATION in requested)
        assertFalse(Manifest.permission.ACCESS_COARSE_LOCATION in requested)
        controller.pause().stop().destroy()
    }

    @Test fun batchRequestsAvailableGrantsBeforeOpeningSettingsForPermanentDenial() {
        val denied = arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
        shadowOf(context).denyPermissions(*denied)
        context.getSharedPreferences("tiplay_permission_requests", 0).edit()
            .putBoolean(Manifest.permission.RECORD_AUDIO, true).commit()
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        button(controller.get(), R.string.onboarding_grant_missing).performClick()
        val requested = shadowOf(controller.get()).lastRequestedPermission.requestedPermissions.toList()
        assertTrue(Manifest.permission.POST_NOTIFICATIONS in requested)
        assertFalse(Manifest.permission.RECORD_AUDIO in requested)
        assertNotEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, shadowOf(controller.get()).nextStartedActivity?.action)
        // Grants made in Android settings are read again on resume, without an activity result.
        controller.pause()
        shadowOf(context).grantPermissions(Manifest.permission.RECORD_AUDIO)
        controller.resume()
        assertTrue(views(controller.get().window.decorView).filterIsInstance<Button>()
            .any { it.text.toString() == controller.get().getString(R.string.settings_permission_microphone) + " ✓" })
        controller.pause().stop().destroy()
    }

    @Test fun permanentDenialOffersAppSettingsAndFinishRequiresExplicitConfirmation() {
        val permissions = arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.NEARBY_WIFI_DEVICES,
            Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.RECORD_AUDIO)
        shadowOf(context).denyPermissions(*permissions)
        context.getSharedPreferences("tiplay_permission_requests", 0).edit().apply {
            permissions.forEach { putBoolean(it, true) }
        }.commit()
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val activity = controller.get()
        button(activity, R.string.onboarding_grant_missing).performClick()
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, shadowOf(activity).nextStartedActivity.action)
        button(activity, R.string.onboarding_continue).performClick()
        assertFalse(context.getSharedPreferences("tiplay_first_use", 0).getBoolean("setup_completed", false))
        ShadowAlertDialog.getLatestAlertDialog().getButton(DialogInterface.BUTTON_NEGATIVE).performClick()
        assertFalse(activity.isFinishing)
        controller.pause().stop().destroy()
    }

    @Test fun checklistActionsKeepSpacingAndTouchHeightWithoutStepNavigation() {
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val activity = controller.get()
        val nav = activity.window.decorView.findViewWithTag<LinearLayout>("onboarding_navigation")
        val density = activity.resources.displayMetrics.density
        assertTrue(nav.childCount in 1..2)
        for (i in 0 until nav.childCount) {
            val button = nav.getChildAt(i) as Button
            val params = button.layoutParams as LinearLayout.LayoutParams
            assertEquals(if (i == 0) 0 else (8 * density).toInt(), params.topMargin)
            assertEquals(0, params.bottomMargin)
            assertTrue(button.minHeight >= (48 * density).toInt())
        }
        controller.pause().stop().destroy()
    }

    @Test fun reviewingCompletedSetupReturnsWithoutLaunchingAnotherHost() {
        context.getSharedPreferences("tiplay_first_use", 0).edit().putBoolean("setup_completed", true).commit()
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java,
            Intent(context, FirstUseActivity::class.java).putExtra(FirstUseActivity.REVIEW, true)).setup()
        finishSetup(controller.get())
        assertTrue(controller.get().isFinishing)
        assertNull(shadowOf(controller.get()).nextStartedActivity)
        controller.pause().stop().destroy()
    }

    private fun finishSetup(activity: FirstUseActivity) {
        val action = views(activity.window.decorView).filterIsInstance<Button>().firstOrNull {
            it.isShown && it.text == activity.getString(R.string.onboarding_continue)
        } ?: button(activity, R.string.onboarding_finish)
        action.performClick()
        ShadowAlertDialog.getLatestAlertDialog()?.takeIf { it.isShowing }
            ?.getButton(DialogInterface.BUTTON_POSITIVE)?.performClick()
        shadowOf(android.os.Looper.getMainLooper()).idle()
    }

    private fun button(activity: FirstUseActivity, id: Int) = views(activity.window.decorView)
        .filterIsInstance<Button>().single { it.text == activity.getString(id) }

    private fun views(root: View): Sequence<View> = sequence {
        yield(root)
        if (root is ViewGroup) for (i in 0 until root.childCount) yieldAll(views(root.getChildAt(i)))
    }
}
