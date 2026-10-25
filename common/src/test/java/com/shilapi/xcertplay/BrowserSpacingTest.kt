package com.shilapi.xcertplay

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en-w320dp-h480dp")
class BrowserSpacingTest {
    @Test fun advancedGroupsHaveSpaceAndDescriptionsStayWithTheirControlsAfterOptOut() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        val page = BrowserAdvancedPage(activity, {}, {}, {})
        activity.setContentView(page.view)
        layout(page.view, activity)
        val toggles = views(page.view).filterIsInstance<Switch>().toList()
        for (control in toggles) {
            val group = control.parent as LinearLayout
            if (group.childCount > 1) assertEquals(dp(activity, 4), group.getChildAt(1).top - control.bottom)
        }
        val first = toggles.first().parent as View
        val second = toggles[1].parent as View
        assertEquals(dp(activity, 8), second.top - first.bottom)
        val location = toggles.single { it.text == activity.getString(R.string.settings_browser_location_disable) }
        location.isChecked = true
        page.refresh()
        layout(page.view, activity)
        assertFalse(views(page.view).filterIsInstance<TextView>().any {
            it.text == activity.getString(R.string.settings_browser_location_permission_reason)
        })
        val report = views(page.view).filterIsInstance<Button>().single {
            it.text == activity.getString(R.string.settings_view_logs)
        }
        val parent = report.parent as ViewGroup
        val previous = (0 until parent.indexOfChild(report)).map(parent::getChildAt).last { it.visibility != View.GONE }
        assertEquals(dp(activity, 8), report.top - previous.bottom)
        controller.pause().stop().destroy()
    }

    @Test fun allProductPagesUseSameEdgesAndButtonsFitNarrowLargeText() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        activity.resources.configuration.fontScale = 1.5f
        @Suppress("DEPRECATION")
        activity.resources.displayMetrics.scaledDensity = activity.resources.displayMetrics.density * 1.5f
        val main = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity), {}, {}, {})
        val advanced = BrowserAdvancedPage(activity, {}, {}, {})
        val about = BrowserAboutPage.build(activity, "test") {}
        for (page in listOf(main.view, advanced.view, about)) {
            activity.setContentView(page)
            layout(page, activity)
            val content = (page as ScrollView).getChildAt(0)
            assertEquals(dp(activity, 16), content.paddingLeft)
            assertEquals(dp(activity, 16), content.paddingRight)
            for (button in views(page).filterIsInstance<Button>().filter { it.isShown }) {
                assertTrue(button.text.toString(), button.height >= dp(activity, 48))
                assertFalse(button.text.toString(), button.layout.getEllipsisCount(button.layout.lineCount - 1) > 0)
                assertTrue(button.text.toString(), button.width <= content.width - content.paddingLeft - content.paddingRight)
            }
        }
        val radios = views(main.view).filterIsInstance<RadioButton>().toList()
        assertEquals(LinearLayout.VERTICAL, (radios.first().parent as LinearLayout).orientation)
        main.dispose()
        controller.pause().stop().destroy()
    }

    @Test fun setupConnectionHasNoGapFromEmptyStatusOrMethodGroups() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val page = BrowserMainSettingsMenu(activity, BrowserConnectionDraft.load(activity), {}, {}, {}, setupOnly = true)
        activity.setContentView(page.view)
        layout(page.view, activity)
        val mode = views(page.view).filterIsInstance<Button>().single {
            it.text.startsWith(activity.getString(R.string.settings_browser_carplay_connection_mode))
        }
        assertEquals(0, mode.top)
        page.refresh()
        layout(page.view, activity)
        assertEquals(0, mode.top)
        page.dispose()
        controller.pause().stop().destroy()
    }

    private fun dp(activity: Activity, value: Int) = (activity.resources.displayMetrics.density * value).toInt()
    private fun layout(view: View, activity: Activity) {
        val width = dp(activity, 320)
        val height = dp(activity, 480)
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        view.layout(0, 0, width, height)
    }
    private fun views(root: View): Sequence<View> = sequence {
        yield(root)
        if (root is ViewGroup) for (i in 0 until root.childCount) yieldAll(views(root.getChildAt(i)))
    }
}
