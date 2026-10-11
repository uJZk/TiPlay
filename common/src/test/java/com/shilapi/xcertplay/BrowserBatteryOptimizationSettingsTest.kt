package com.shilapi.xcertplay

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class BrowserBatteryOptimizationSettingsTest {
    @Test fun permissionsHelpOpensTheSystemListWithoutRequestingAnExemption() {
        val activity = Robolectric.buildActivity(DiPlayActivity::class.java).get()
        AirPlayPersistence.saveRunMode(activity, CarPlayRunMode.PHONE_BROWSER)
        val content = LinearLayout(activity)
        val render = DiPlayActivity::class.java.getDeclaredMethod("renderSections", LinearLayout::class.java, Set::class.java)
            .apply { isAccessible = true }
        render.invoke(activity, content, setOf(SettingsSection.PERMISSIONS_AND_HELP))
        val label = activity.getString(R.string.settings_ignore_battery_optimization)
        val button = descendants(content).filterIsInstance<Button>().single { it.text.toString() == label }
        assertNull(shadowOf(activity).nextStartedActivity)
        button.performClick()
        val intent = shadowOf(activity).nextStartedActivity
        assertEquals(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, intent.action)
        assertNull(intent.data)
        assertFalse(intent.hasExtra("package"))
        val otherSection = LinearLayout(activity)
        render.invoke(activity, otherSection, setOf(SettingsSection.ABOUT))
        assertFalse(descendants(otherSection).filterIsInstance<Button>().any { it.text.toString() == label })
    }

    @Test fun missingBatteryScreenFallsBackToAppDetails() {
        val activity = Robolectric.buildActivity(MissingBatterySettingsActivity::class.java).setup().get()
        val content = LinearLayout(activity)
        BrowserBatteryOptimizationSettings.add(activity, content)
        (content.getChildAt(0) as Button).performClick()
        val intent = shadowOf(activity).nextStartedActivity
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, intent.action)
        assertEquals("package:${activity.packageName}", intent.data.toString())
        activity.finish()
    }

    class MissingBatterySettingsActivity : Activity() {
        override fun startActivity(intent: Intent) {
            if (intent.action == Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) throw ActivityNotFoundException()
            super.startActivity(intent)
        }
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }
}
