package com.shilapi.xcertplay

import android.app.Activity
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
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
    private fun buttons(view: View): List<Button> = if (view is Button) listOf(view)
        else if (view is ViewGroup) (0 until view.childCount).flatMap { buttons(view.getChildAt(it)) } else emptyList()

    @Test fun ordinaryDialogOffersSaveShareAndCloseWithoutStartingCapture() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val actions = mutableListOf<DiagnosticLogAction>()
        val logs = DiagnosticLogDialog(activity, perform = { actions.add(it) })
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            logs.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            val actionsInDialog = buttons(dialog.window!!.decorView).filter { it.visibility == View.VISIBLE }
            assertEquals(listOf("保存", "分享", "关闭"), actionsInDialog.map { it.text.toString() })
            actionsInDialog.single { it.text == "保存" }.performClick()
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
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            logs.show()
            var dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertEquals(listOf("结束并导出", "结束并分享", "撤销", "最小化"),
                buttons(dialog.window!!.decorView).filter { it.visibility == View.VISIBLE }.map { it.text.toString() })
            buttons(dialog.window!!.decorView).single { it.text == "最小化" }.performClick()
            assertFalse(dialog.isShowing)
            assertTrue(RawTraffic.enabled)
            assertTrue(actions.isEmpty())
            assertFalse(DiagnosticLogDialog.claimRestartPrompt())
            for ((text, action) in listOf("结束并导出" to DiagnosticLogAction.STOP_EXPORT,
                "结束并分享" to DiagnosticLogAction.STOP_SHARE, "撤销" to DiagnosticLogAction.STOP)) {
                logs.show(); dialog = ShadowAlertDialog.getLatestAlertDialog()
                buttons(dialog.window!!.decorView).single { it.text == text }.performClick()
                assertEquals(action, actions.last())
            }
        } finally {
            logs.close(); AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            RawTraffic.clear(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy()
        }
    }
    @Test fun bothModesUseTheSameBottomButtonBarAndFitNarrowLargeText() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.resources.configuration.fontScale = 1.5f
        val logs = DiagnosticLogDialog(activity, perform = {})
        val styles = mutableListOf<List<Any>>()
        try {
            for (level in listOf(DiagnosticLogLevel.STANDARD, DiagnosticLogLevel.DEBUG)) {
                AirPlayPersistence.saveDiagnosticLogLevel(activity, level)
                logs.show()
                val dialog = ShadowAlertDialog.getLatestAlertDialog()
                val decor = dialog.window!!.decorView
                decor.measure(View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(1200, View.MeasureSpec.AT_MOST))
                decor.layout(0, 0, decor.measuredWidth, decor.measuredHeight)
                val controls = buttons(decor).filter { it.visibility == View.VISIBLE }
                val bar = controls.first().parent as LinearLayout
                assertEquals(LinearLayout.HORIZONTAL, bar.orientation)
                assertTrue(controls.all { it.parent === bar })
                assertTrue(controls.last().right <= bar.width - bar.paddingRight)
                controls.forEach { button ->
                    assertEquals(1f, (button.layoutParams as LinearLayout.LayoutParams).weight)
                    assertEquals(button.text.length, button.layout.getLineEnd(button.lineCount - 1))
                }
                val button = controls.first()
                styles.add(listOf(button.textSize, button.minHeight, button.paddingLeft, button.paddingRight,
                    button.background.javaClass, button.currentTextColor))
                logs.close()
            }
            assertEquals(styles[0], styles[1])
        } finally {
            logs.close(); AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            RawTraffic.clear(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy()
        }
    }

}
