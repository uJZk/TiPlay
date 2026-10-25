package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.host.R
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "zh-rCN", manifest = Config.NONE)
class DiagnosticLogDialogTest {
    @Test fun ordinaryDialogOffersSaveShareAndCloseWithoutStartingCapture() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val actions = mutableListOf<DiagnosticLogAction>()
        val logs = DiagnosticLogDialog(activity, perform = { actions.add(it) })
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            logs.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertEquals(activity.getString(R.string.save), dialog.getButton(AlertDialog.BUTTON_POSITIVE).text)
            assertEquals(activity.getString(R.string.share), dialog.getButton(AlertDialog.BUTTON_NEUTRAL).text)
            assertEquals(activity.getString(R.string.close), dialog.getButton(AlertDialog.BUTTON_NEGATIVE).text)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(listOf(DiagnosticLogAction.SAVE), actions)
            assertFalse(RawTraffic.enabled)
        } finally { logs.close(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy() }
    }

    @Test fun debugDialogOffersThreeStopActionsAndMinimizeWhichKeepsRecording() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val actions = mutableListOf<DiagnosticLogAction>()
        val logs = DiagnosticLogDialog(activity, perform = { actions.add(it) })
        fun buttons(view: View): List<Button> = if (view is Button) listOf(view)
            else if (view is ViewGroup) (0 until view.childCount).flatMap { buttons(view.getChildAt(it)) } else emptyList()
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            logs.show()
            var dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertEquals(listOf("结束并导出", "结束并分享", "结束", "最小化"),
                buttons(dialog.window!!.decorView).filter { it.visibility == View.VISIBLE }.map { it.text.toString() })
            buttons(dialog.window!!.decorView).single { it.text == "最小化" }.performClick()
            assertFalse(dialog.isShowing)
            assertTrue(RawTraffic.enabled)
            assertTrue(actions.isEmpty())
            assertFalse(DiagnosticLogDialog.claimRestartPrompt())
            for ((text, action) in listOf("结束并导出" to DiagnosticLogAction.STOP_EXPORT,
                "结束并分享" to DiagnosticLogAction.STOP_SHARE, "结束" to DiagnosticLogAction.STOP)) {
                logs.show(); dialog = ShadowAlertDialog.getLatestAlertDialog()
                buttons(dialog.window!!.decorView).single { it.text == text }.performClick()
                assertEquals(action, actions.last())
            }
        } finally {
            logs.close(); AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            RawTraffic.clear(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy()
        }
    }
}
