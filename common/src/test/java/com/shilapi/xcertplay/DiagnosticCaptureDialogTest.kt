package com.shilapi.xcertplay

import android.os.Looper
import org.robolectric.Shadows.shadowOf
import android.app.Activity
import android.app.AlertDialog
import com.shilapi.xcertplay.diagnostics.RawTraffic
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class DiagnosticCaptureDialogTest {
    @Test fun dismissAndReopenKeepCapturingButStopExportDisablesPersistentCapture() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        var exported = 0
        val progress = DiagnosticCaptureDialog(activity) { exported++ }
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            progress.show()
            ShadowAlertDialog.getLatestAlertDialog().getButton(AlertDialog.BUTTON_NEGATIVE).performClick()
            shadowOf(Looper.getMainLooper()).idle()
            assertTrue(RawTraffic.enabled)
            assertEquals(0, exported)
            assertFalse(DiagnosticCaptureDialog.claimRestartPrompt())
            progress.show()
            ShadowAlertDialog.getLatestAlertDialog().getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            shadowOf(Looper.getMainLooper()).idle()
            assertFalse(RawTraffic.enabled)
            assertEquals(DiagnosticLogLevel.STANDARD, AirPlayPersistence.loadDiagnosticLogLevel(activity))
            assertEquals(1, exported)
        } finally {
            progress.close()
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            DiagnosticLogs.resetForTest()
            controller.pause().stop().destroy()
        }
    }
}
