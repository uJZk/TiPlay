package com.shilapi.xcertplay

import android.graphics.BitmapFactory
import android.graphics.Color
import com.shilapi.xcertplay.host.R
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CarButtonDefaultsTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Test fun phoneBrowserModeRenamesOnlyTheBydDefault() {
        assertEquals("TiPlay", CarButtonDefaults.label(AirPlayPersistence.DEFAULT_OEM_LABEL, phoneBrowser = true))
        assertEquals(AirPlayPersistence.DEFAULT_OEM_LABEL,
            CarButtonDefaults.label(AirPlayPersistence.DEFAULT_OEM_LABEL, phoneBrowser = false))
        assertEquals("My car", CarButtonDefaults.label("My car", phoneBrowser = true))
        assertEquals("My car", CarButtonDefaults.label("My car", phoneBrowser = false))
    }

    @Test fun thePhoneIconUsesThePackagedTiPlayLogoWithoutRuntimeReencoding() {
        val png = requireNotNull(CarButtonDefaults.phoneBrowserIconPng(context))
        val packaged = context.resources.openRawResource(R.raw.ic_car_home).use { it.readBytes() }
        assertArrayEquals(byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte()), png.copyOf(4))
        assertArrayEquals(packaged, png)

        val icon = BitmapFactory.decodeByteArray(png, 0, png.size)
        val packagedIcon = BitmapFactory.decodeByteArray(packaged, 0, packaged.size)
        assertEquals(packagedIcon.width, icon.width)
        assertEquals(packagedIcon.height, icon.height)
        assertEquals(CarButtonDefaults.ICON_SIZE_PX, icon.width)

        assertEquals(Color.rgb(253, 252, 247), icon.getPixel(0, 0))
        val ring = icon.getPixel(20, 96)
        assertTrue("pink ring", Color.red(ring) > 240 && Color.green(ring) in 110..140)
        val play = icon.getPixel(118, 68)
        assertTrue("purple play arrow", Color.blue(play) > 220 && Color.green(play) < 120)
        assertEquals("opaque, like the packaged icon", 255, Color.alpha(icon.getPixel(0, 0)))
    }
}
