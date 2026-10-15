package com.shilapi.xcertplay

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-w320dp-h480dp")
class FirstUseActivityTest {
    @Before fun clearCompletion() {
        RuntimeEnvironment.getApplication().getSharedPreferences("tiplay_first_use", 0)
            .edit().clear().commit()
    }

    @Test fun firstOpenWaitsForCompletionThenSubsequentOpenRoutesToMain() {
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        val activity = controller.get()
        assertNull(shadowOf(activity).nextStartedActivity)
        repeat(3) { button(activity, R.string.onboarding_next).performClick() }
        assertNull(shadowOf(activity).nextStartedActivity)
        button(activity, R.string.onboarding_finish).performClick()
        assertEquals(CarPlayHostActivity::class.java.name, shadowOf(activity).nextStartedActivity.component?.className)
        assertTrue(activity.isFinishing)
        controller.pause().stop().destroy()

        val next = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        assertTrue(next.get().isFinishing)
        assertEquals(CarPlayHostActivity::class.java.name, shadowOf(next.get()).nextStartedActivity.component?.className)
        next.pause().stop().destroy()
    }

    @Test fun recreationRetainsStepAndAbandoningDoesNotCompleteGuide() {
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java).setup()
        button(controller.get(), R.string.onboarding_next).performClick()
        val saved = Bundle()
        controller.saveInstanceState(saved).pause().stop().destroy()
        val restored = Robolectric.buildActivity(FirstUseActivity::class.java).create(saved).start().resume().visible()
        assertTrue(views(restored.get().window.decorView).filterIsInstance<TextView>()
            .any { it.text == restored.get().getString(R.string.onboarding_connection_title) })
        button(restored.get(), R.string.onboarding_back).performClick()
        restored.get().onBackPressedDispatcher.onBackPressed()
        assertTrue(restored.get().isFinishing)
        assertFalse(restored.get().getSharedPreferences("tiplay_first_use", 0).getBoolean("completed", false))
        restored.pause().stop().destroy()
    }

    @Test fun reviewingCompletedGuideReturnsWithoutLaunchingAnotherHost() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("tiplay_first_use", 0).edit().putBoolean("completed", true).commit()
        val controller = Robolectric.buildActivity(FirstUseActivity::class.java,
            Intent(context, FirstUseActivity::class.java).putExtra(FirstUseActivity.REVIEW, true)).setup()
        repeat(3) { button(controller.get(), R.string.onboarding_next).performClick() }
        button(controller.get(), R.string.onboarding_finish).performClick()
        assertTrue(controller.get().isFinishing)
        assertNull(shadowOf(controller.get()).nextStartedActivity)
        controller.pause().stop().destroy()
    }

    private fun button(activity: FirstUseActivity, id: Int) = views(activity.window.decorView)
        .filterIsInstance<Button>().single { it.text == activity.getString(id) }

    private fun views(root: View): Sequence<View> = sequence {
        yield(root)
        if (root is ViewGroup) for (i in 0 until root.childCount) yieldAll(views(root.getChildAt(i)))
    }
}
