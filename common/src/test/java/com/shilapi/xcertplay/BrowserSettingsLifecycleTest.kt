package com.shilapi.xcertplay

import android.app.Activity
import android.content.Context
import android.content.ClipboardManager
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.network.HotspotAddresses
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], shadows = [HotspotExtraAddressSettingsTest.HotspotProbe::class, BrowserSettingsLifecycleTest.Reader::class])
@LooperMode(LooperMode.Mode.PAUSED)
class BrowserSettingsLifecycleTest {
    private lateinit var activity: Activity
    private lateinit var parent: LinearLayout

    @Before fun setUp() {
        activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        parent = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        activity.setContentView(parent)
        AirPlayPersistence.saveRunMode(activity, CarPlayRunMode.PHONE_BROWSER)
        HotspotExtraAddressSettings.saveMethod(activity, HotspotAddressMethod.NORMAL)
        HotspotExtraAddressSettingsTest.HotspotProbe.reset()
        Reader.result = LocalHotspotSettings.Credentials("Device hotspot", "password123")
        Reader.gate = null
        Reader.reads = 0
    }

    @After fun tearDown() {
        Reader.gate?.countDown()
        parent.removeAllViews()
        activity.finish()
    }

    @Test fun addressAndBrowserLinkProbeWhenRefreshedInsideAnAttachedPage() {
        fun hotspot(address: String) {
            HotspotExtraAddressSettingsTest.HotspotProbe.result = HotspotAddresses.Current(
                "wlan2", listOf(InetAddress.getByName(address) as Inet4Address))
        }
        hotspot("192.168.43.1")
        val refreshAddress = BrowserSettingsMenu.addHotspotAddress(parent, activity)
        val refreshBrowser = BrowserSettingsMenu.addBrowserLink(parent, activity) {}
        fun assertCopiedAddress(address: String) {
            texts(parent).filterIsInstance<Button>().single {
                it.text == activity.getString(R.string.settings_browser_link_copy)
            }.performClick()
            val link = activity.getSystemService(ClipboardManager::class.java).primaryClip!!
                .getItemAt(0).text.toString()
            assertTrue(link, link.contains("?t=$address:8080#c="))
        }
        finishAddressProbes()
        assertTrue(texts(parent).any { it.text.toString().contains("192.168.43.1:8080") })
        assertCopiedAddress("192.168.43.1")

        hotspot("192.168.44.1")
        refreshAddress()
        refreshBrowser()
        finishAddressProbes()
        assertFalse(texts(parent).any { it.text.toString() == activity.getString(R.string.settings_hotspot_address_checking) })
        assertTrue(texts(parent).any { it.text.toString().contains("192.168.44.1:8080") })
        assertCopiedAddress("192.168.44.1")
    }

    @Test fun rootHotspotReadRunsOnlyAfterAnExplicitTap() {
        HotspotExtraAddressSettings.saveMethod(activity, HotspotAddressMethod.ROOT)
        val ssid = EditText(activity)
        val password = EditText(activity)
        parent.addView(ssid)
        parent.addView(password)
        val controls = LocalHotspotAutofill.attach(parent, ssid, password, showHint = false)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(LocalHotspotAutofill.awaitProbesForTest())
        assertEquals(0, Reader.reads)
        assertEquals(View.GONE, controls.getChildAt(1).visibility)
        (controls.getChildAt(0) as Button).performClick()
        assertTrue(LocalHotspotAutofill.awaitProbesForTest())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, Reader.reads)
        assertEquals("Device hotspot", ssid.text.toString())
        assertEquals("password123", password.text.toString())
    }

    @Test fun explicitHotspotReadShowsProgressAndPreservesTypingDuringTheRead() {
        val ssid = EditText(activity).apply { setText("Saved name") }
        val password = EditText(activity).apply { setText("savedpass") }
        parent.addView(ssid)
        parent.addView(password)
        val controls = LocalHotspotAutofill.attach(parent, ssid, password, showHint = false)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(LocalHotspotAutofill.awaitProbesForTest())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("Saved name", ssid.text.toString())
        val button = controls.getChildAt(0) as Button
        val status = controls.getChildAt(1) as TextView
        assertEquals(View.GONE, status.visibility)
        Reader.gate = CountDownLatch(1)
        button.performClick()
        assertFalse(button.isEnabled)
        assertEquals(View.VISIBLE, status.visibility)
        assertEquals(activity.getString(R.string.settings_hotspot_reading), status.text.toString())
        ssid.setText("Typed while reading")
        Reader.gate!!.countDown()
        assertTrue(LocalHotspotAutofill.awaitProbesForTest())
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(button.isEnabled)
        assertEquals("Typed while reading", ssid.text.toString())
        assertEquals("password123", password.text.toString())
        assertEquals(activity.getString(R.string.settings_hotspot_read_success), status.text.toString())
        assertEquals(View.VISIBLE, status.visibility)

        Reader.result = LocalHotspotSettings.Credentials("Partial hotspot", null)
        button.performClick()
        assertTrue(LocalHotspotAutofill.awaitProbesForTest())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("Partial hotspot", ssid.text.toString())
        assertEquals("password123", password.text.toString())
        assertEquals(activity.getString(R.string.settings_hotspot_read_partial), status.text.toString())

        Reader.result = null
        button.performClick()
        assertTrue(LocalHotspotAutofill.awaitProbesForTest())
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(button.isEnabled)
        assertEquals(activity.getString(R.string.settings_hotspot_read_unavailable), status.text.toString())
    }

    private fun finishAddressProbes() {
        assertTrue(HotspotExtraAddressCard.awaitProbesForTest())
        assertTrue(TeslaBrowserLinkCard.awaitProbesForTest())
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun texts(view: View): List<TextView> = when (view) {
        is TextView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }

    @Implements(LocalHotspotSettings::class, isInAndroidSdk = false)
    internal class Reader {
        @Implementation fun readExplicit(context: Context): LocalHotspotSettings.Credentials? = read(context)
        @Implementation fun read(context: Context): LocalHotspotSettings.Credentials? {
            reads++
            gate?.await(3, TimeUnit.SECONDS)
            return result
        }
        companion object {
            @Volatile var gate: CountDownLatch? = null
            @Volatile var result: LocalHotspotSettings.Credentials? = null
            @Volatile var reads = 0
        }
    }
}
