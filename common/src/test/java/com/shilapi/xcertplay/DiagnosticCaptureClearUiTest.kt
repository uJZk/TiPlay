package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.net.Uri
import android.os.Looper
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class DiagnosticCaptureClearUiTest {
    @Test fun zipCompletionOffersClearAndLeavesTheSavedArtifactIntact() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val directory = java.nio.file.Files.createTempDirectory("clear-ui").toFile()
        val capture = File(directory, "capture.tsv")
        val saved = File(directory, "saved.zip").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        try {
            RawTraffic.configure(capture, true)
            RawTraffic.record("iphone/in", byteArrayOf(8))
            BrowserDiagnosticResultUi.saved(activity, DiagnosticExportStore.SavedReport(Uri.fromFile(saved), mimeType = "application/zip"))
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            val button = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            assertEquals(activity.getString(R.string.settings_clear_captured_data), button.text.toString())
            button.performClick()
            val deadline = System.nanoTime() + 5_000_000_000L
            while (ShadowToast.getTextOfLatestToast() != activity.getString(R.string.settings_capture_cleared) && System.nanoTime() < deadline) {
                Thread.sleep(10)
                shadowOf(Looper.getMainLooper()).idle()
            }
            assertEquals(activity.getString(R.string.settings_capture_cleared), ShadowToast.getTextOfLatestToast())
            shadowOf(Looper.getMainLooper()).idle()
            assertFalse(capture.readText().contains("iphone/in"))
            assertTrue(RawTraffic.enabled)
            assertArrayEquals(byteArrayOf(1, 2, 3), saved.readBytes())
        } finally {
            RawTraffic.configure(capture, false)
            directory.deleteRecursively()
            controller.pause().stop().destroy()
        }
    }
}
