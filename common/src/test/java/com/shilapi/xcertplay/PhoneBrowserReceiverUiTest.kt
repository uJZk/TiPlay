package com.shilapi.xcertplay

import android.view.TextureView
import android.view.View
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneBrowserReceiverUiTest {
    @Test fun phoneKeepsItsSettingsEntryAndLayoutWithoutAVideoSurface() {
        val context = RuntimeEnvironment.getApplication()
        val video = TextureView(context)
        val gestures = View(context)
        val settings = TextView(context)
        val stage = TextView(context)
        val panel = View(context)
        var measured = 0 to 0
        var opened = false
        PhoneBrowserReceiverUi.configure(video, gestures, settings, { w, h -> measured = w to h }, { opened = true })
        video.layout(0, 0, 720, 1280)
        assertEquals(720 to 1280, measured)
        assertNull(video.surfaceTextureListener)
        assertEquals(View.INVISIBLE, video.visibility)
        assertEquals(View.GONE, gestures.visibility)
        PhoneBrowserReceiverUi.update(panel, gestures, settings, stage, streaming = true)
        assertEquals(View.VISIBLE, panel.visibility)
        assertEquals(context.getString(R.string.carplay_connected), stage.text.toString())
        assertEquals(context.getString(R.string.app_settings), settings.text.toString())
        settings.performClick()
        assertTrue(opened)
        stage.text = "Connecting"
        gestures.visibility = View.VISIBLE
        PhoneBrowserReceiverUi.update(panel, gestures, settings, stage, streaming = false)
        assertEquals("Connecting", stage.text.toString())
        assertEquals(View.VISIBLE, panel.visibility)
        assertEquals(View.GONE, gestures.visibility)
    }
}
