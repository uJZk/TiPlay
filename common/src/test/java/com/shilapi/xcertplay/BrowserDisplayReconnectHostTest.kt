package com.shilapi.xcertplay

import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.orchestration.CarPlayController
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class BrowserDisplayReconnectHostTest {
    @Test fun recoveredScreenRechecksTheLatestViewportOnlyAfterItsReplacementFirstFrame() {
        val controller = mock(CarPlayController::class.java)
        val old = mock(AirPlaySession::class.java)
        val replacement = mock(AirPlaySession::class.java)
        `when`(controller.recoverBrowserDisplayAfterScreenLoan(old)).thenReturn(true)
        var displayChanges = 0
        val host = BrowserDisplayReconnectHost { displayChanges++ }

        assertTrue(host.recoverAfterScreenLoan(controller, old))
        assertTrue(host.recoverAfterScreenLoan(controller, old))
        verify(controller, times(1)).recoverBrowserDisplayAfterScreenLoan(old)
        assertTrue(host.expectedEnd(controller, old))
        assertFalse(host.expectedEnd(controller, replacement))
        host.sessionActive(controller, replacement)
        assertFalse(host.firstFrame(controller, old))
        `when`(controller.isBrowserDisplayReconnectPending()).thenReturn(true)
        assertFalse(host.firstFrame(controller, replacement))
        assertTrue(host.pending)

        `when`(controller.isBrowserDisplayReconnectPending()).thenReturn(false)
        assertTrue("A viewport can change while AirPlay owns the canvas", host.firstFrame(controller, replacement))
        assertFalse(host.pending)
        assertFalse(host.firstFrame(controller, replacement))
        assertEquals("Screen recovery itself keeps the negotiated geometry", 0, displayChanges)
    }
}
