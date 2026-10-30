package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class CarBluetoothSelectionStateTest {
    @Test fun onlyAnActuallyLaunchedChooserCanRemainPendingAfterRecreation() {
        assertFalse(resumeChooser(false, false))
        assertFalse(resumeChooser(false, true))
        assertFalse(resumeChooser(true, false))
        assertTrue(resumeChooser(true, true))
    }
}
