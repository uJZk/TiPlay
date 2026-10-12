package com.shilapi.xcertplay

import android.provider.Settings
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class UnifiedAirPlayTrialSettingsTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @After fun reset() {
        Settings.Global.putString(context.contentResolver, UnifiedAirPlayTrialSettings.KEY, null)
    }

    @Test fun onlyExplicitOneEnablesTheTrial() {
        reset()
        assertFalse(UnifiedAirPlayTrialSettings.enabled(context))
        for (value in listOf("0", "2", "-1", "invalid")) {
            Settings.Global.putString(context.contentResolver, UnifiedAirPlayTrialSettings.KEY, value)
            assertFalse(UnifiedAirPlayTrialSettings.enabled(context))
        }
        Settings.Global.putInt(context.contentResolver, UnifiedAirPlayTrialSettings.KEY, 1)
        assertTrue(UnifiedAirPlayTrialSettings.enabled(context))
    }
}
