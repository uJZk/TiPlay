package com.shilapi.xcertplay

import android.content.Intent
import android.os.Bundle
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class BrowserMainEntryTest {
    private var controller: ActivityController<DiPlayActivity>? = null

    @Before fun setup() {
        val app = RuntimeEnvironment.getApplication()
        app.getSharedPreferences("diplay", 0).edit().clear().commit()
        app.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        CarPlayBackgroundSession.clear()
    }

    @After fun cleanup() {
        controller?.destroy()
        CarPlayBackgroundSession.clear()
    }

    @Test fun legacyHomeIntentOpensTheUnifiedMainPageAndFinishesItsActivity() {
        controller = Robolectric.buildActivity(DiPlayActivity::class.java,
            Intent().putExtra("page", "home")).create()
        assertMainEntry()
    }

    @Test fun restoredLegacyHomeCannotBringBackTheThreeButtonPage() {
        controller = Robolectric.buildActivity(DiPlayActivity::class.java,
            Intent().putExtra("page", "home")).create(Bundle().apply { putString("page", "home") })
        assertMainEntry()
    }

    @Test fun returningFromAboutGoesToTheUnifiedMainPage() {
        controller = Robolectric.buildActivity(DiPlayActivity::class.java,
            Intent().putExtra("page", "about")).create()
        assertFalse(controller!!.get().isFinishing)
        ReflectionHelpers.callInstanceMethod<Unit>(controller!!.get(), "navigateBack")
        assertMainEntry()
    }

    @Test fun launcherDeliveredToABrowserPageDoesNotLeaveAnExtraActivity() {
        controller = Robolectric.buildActivity(DiPlayActivity::class.java,
            Intent().putExtra("page", "about")).create()
        ReflectionHelpers.callInstanceMethod<Unit>(controller!!.get(), "onNewIntent",
            ReflectionHelpers.ClassParameter(Intent::class.java,
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)))
        assertMainEntry()
    }

    private fun assertMainEntry() {
        val screen = controller!!.get()
        assertTrue(screen.isFinishing)
        val next = shadowOf(screen).nextStartedActivity
        assertEquals(CarPlayHostActivity::class.java.name, next.component!!.className)
        assertTrue(next.getBooleanExtra(CarPlaySettingsNavigation.MAIN, false))
    }
}
