package com.shilapi.xcertplay

import android.app.Activity
import android.os.Looper
import com.shilapi.xcertplay.network.ShizukuSystem
import com.shilapi.xcertplay.network.HotspotExtraAddressKeeper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class HotspotOperationFeedbackTest {
    @Test fun methodResultNeverAppearsBelowAnUnrelatedAuthorizationButton() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val group = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        group.addView(Button(activity).apply { text = "Address method" })
        val method = TextView(activity).also(group::addView)
        group.addView(Button(activity).apply { text = "Allow VPN" })
        val authorization = TextView(activity).also(group::addView)
        activity.setContentView(group)
        val feedback = HotspotOperationFeedback()
        feedback.bind(method, authorization)
        feedback.begin(HotspotOperationFeedback.Target.METHOD, HotspotAddressMethod.ROOT).show(R.string.settings_hotspot_extra_address_root_refused)
        assertTrue(feedback.owns(HotspotAddressMethod.ROOT))
        assertFalse(feedback.owns(HotspotAddressMethod.VPN))
        assertEquals(View.VISIBLE, method.visibility)
        assertEquals(View.GONE, authorization.visibility)
        assertEquals(1, group.indexOfChild(method))
        feedback.begin(HotspotOperationFeedback.Target.AUTHORIZATION).show(R.string.settings_hotspot_vpn_no_consent_screen)
        assertEquals(View.GONE, method.visibility)
        assertEquals(View.VISIBLE, authorization.visibility)
    }

    @Test fun asynchronousResultSurvivesRebuildAndNewerClicksRejectOldResults() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val feedback = HotspotOperationFeedback()
        val oldMethod = TextView(activity)
        feedback.bind(oldMethod, null)
        val oldOperation = feedback.begin(HotspotOperationFeedback.Target.METHOD)
        val newMethod = TextView(activity)
        val authorization = TextView(activity)
        feedback.bind(newMethod, authorization)
        oldOperation.show(R.string.settings_hotspot_extra_address_root_refused)
        assertEquals(activity.getString(R.string.settings_hotspot_extra_address_root_refused), newMethod.text)
        val next = feedback.begin(HotspotOperationFeedback.Target.AUTHORIZATION)
        next.show(R.string.settings_hotspot_vpn_no_consent_screen)
        oldOperation.show(R.string.settings_hotspot_extra_address_root_checking)
        assertEquals(View.GONE, newMethod.visibility)
        assertEquals(activity.getString(R.string.settings_hotspot_vpn_no_consent_screen), authorization.text)
        feedback.cancel()
        next.show(R.string.settings_hotspot_vpn_no_consent_screen)
        assertEquals(View.GONE, authorization.visibility)
    }
    @Test
    @Config(shadows = [DelayedShizuku::class, HotspotExtraAddressSettingsTest.KeeperProbe::class,
        HotspotExtraAddressSettingsTest.HotspotProbe::class])
    fun sameCardIgnoresAnEarlierAuthorizationResultAfterAnotherClickOrResolvedState() {
        DelayedShizuku.reset()
        val keeper = HotspotExtraAddressSettingsTest.KeeperProbe
        keeper.reset()
        keeper.running = true
        keeper.state = HotspotExtraAddressKeeper.State.ShizukuPermissionNeeded
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        AirPlayPersistence.saveWirelessHotspotMode(activity, com.shilapi.xcertplay.orchestration.WirelessHotspotMode.MANUAL)
        HotspotExtraAddressSettings.saveMethod(activity, HotspotAddressMethod.SHIZUKU)
        val feedback = HotspotOperationFeedback()
        val parent = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        fun button(target: LinearLayout, title: String, action: () -> Unit) = Button(activity).apply {
            text = title; setOnClickListener { action() }; target.addView(this)
        }
        HotspotExtraAddressCard(activity, false, HotspotExtraAddressCard.Colors(0, 0, 0),
            note = { TextView(activity).apply { text = it } },
            settingRow = { target, title, action -> button(target, title, action); Unit },
            actionButton = ::button, rerender = {}, hintReporter = { _, _ -> }, operationFeedback = feedback).build(parent)
        activity.setContentView(parent)
        val authorize = (0 until parent.childCount).map(parent::getChildAt).filterIsInstance<Button>()
            .single { it.text == activity.getString(R.string.settings_hotspot_shizuku_allow) }
        assertEquals(View.VISIBLE, authorize.visibility)
        val result = parent.findViewWithTag<TextView>("hotspot_authorization_result")
        try {
            authorize.performClick()
            assertTrue(DelayedShizuku.firstEntered.await(3, TimeUnit.SECONDS))
            authorize.performClick()
            assertTrue(DelayedShizuku.secondEntered.await(3, TimeUnit.SECONDS))
            DelayedShizuku.secondThread?.join(3000)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(activity.getString(R.string.settings_hotspot_shizuku_denied), result.text)
            DelayedShizuku.releaseFirst.countDown()
            DelayedShizuku.firstThread?.join(3000)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(activity.getString(R.string.settings_hotspot_shizuku_denied), result.text)

            DelayedShizuku.reset()
            authorize.performClick()
            assertTrue(DelayedShizuku.firstEntered.await(3, TimeUnit.SECONDS))
            feedback.cancel() // A newer background fact resolved/superseded this operation.
            DelayedShizuku.releaseFirst.countDown()
            DelayedShizuku.firstThread?.join(3000)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(View.GONE, result.visibility)
        } finally {
            DelayedShizuku.releaseFirst.countDown()
            controller.pause().stop().destroy()
            keeper.reset()
        }
    }

    @Implements(ShizukuSystem::class, isInAndroidSdk = false)
    class DelayedShizuku {
        @Implementation fun running(): Boolean {
            if (calls.incrementAndGet() == 1) {
                firstThread = Thread.currentThread()
                firstEntered.countDown()
                check(releaseFirst.await(3, TimeUnit.SECONDS))
                return false
            }
            secondThread = Thread.currentThread()
            secondEntered.countDown()
            return true
        }
        @Implementation fun permissionGranted() = false
        @Implementation fun permissionDeniedForGood() = true
        companion object {
            val calls = AtomicInteger()
            var firstEntered = CountDownLatch(1)
            var secondEntered = CountDownLatch(1)
            var releaseFirst = CountDownLatch(1)
            @Volatile var firstThread: Thread? = null
            @Volatile var secondThread: Thread? = null
            fun reset() {
                calls.set(0); firstEntered = CountDownLatch(1); secondEntered = CountDownLatch(1)
                releaseFirst = CountDownLatch(1); firstThread = null; secondThread = null
            }
        }
    }

}
