package com.shilapi.xcertplay

import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class BrowserCarPlaySettingsTest {
    @Test fun allModePrefersUsbAndReturnsToWirelessAfterUnplugWithoutChangingTheSavedChoice() {
        val app = RuntimeEnvironment.getApplication()
        BrowserCarPlaySettings.saveMode(app, BrowserCarPlaySettings.Mode.ALL)
        val usb = app.getSystemService(UsbManager::class.java)
        val device = mock(UsbDevice::class.java)
        `when`(device.deviceName).thenReturn("iphone")
        `when`(device.vendorId).thenReturn(0x05ac)
        assertTrue(BrowserCarPlaySettings.wireless(app))
        shadowOf(usb).addOrUpdateUsbDevice(device, false)
        assertFalse(BrowserCarPlaySettings.wireless(app))
        assertEquals(BrowserCarPlaySettings.Mode.ALL, BrowserCarPlaySettings.mode(app))
        shadowOf(usb).removeUsbDevice(device)
        assertTrue(BrowserCarPlaySettings.wireless(app))
        val draft = BrowserConnectionDraft.load(app)
        assertTrue(draft.allTransports)
        assertTrue(draft.wireless)
    }
}
