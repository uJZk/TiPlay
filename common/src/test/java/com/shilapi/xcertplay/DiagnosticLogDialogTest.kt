package com.shilapi.xcertplay

import android.app.Activity
import android.net.Uri
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
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

    private fun countText(view: View, text: String): Int =
        (if (view is TextView && view.text.toString() == text) 1 else 0) +
            (if (view is ViewGroup) (0 until view.childCount).sumOf { countText(view.getChildAt(it), text) } else 0)

    @Test fun ordinaryDialogOffersSaveShareAndCloseWithoutStartingCapture() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val actions = mutableListOf<DiagnosticLogAction>()
        val logs = DiagnosticLogDialog(activity, perform = { actions.add(it) })
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            logs.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertEquals(0, countText(dialog.window!!.decorView, activity.getString(R.string.settings_debug_mode_description)))
            val actionsInDialog = buttons(dialog.window!!.decorView).filter { it.visibility == View.VISIBLE }
            assertEquals(listOf("保存", "分享", "关闭"), actionsInDialog.map { it.text.toString() })
            actionsInDialog.single { it.text == "保存" }.performClick()
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(listOf(DiagnosticLogAction.SAVE), actions)
            assertFalse(RawTraffic.enabled)
        } finally { logs.close(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy() }
    }

    @Test fun debugDialogClosesWithoutDiscardingTheCapture() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val actions = mutableListOf<DiagnosticLogAction>()
        val logs = DiagnosticLogDialog(activity, perform = { actions.add(it) },
            prepareShare = { action, _ -> actions.add(action) })
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            logs.show()
            var dialog = ShadowAlertDialog.getLatestAlertDialog()
            assertEquals(1, countText(dialog.window!!.decorView, activity.getString(R.string.settings_debug_mode_description)))
            assertEquals(listOf("结束并导出", "结束并分享", "关闭"),
                buttons(dialog.window!!.decorView).filter { it.visibility == View.VISIBLE }.map { it.text.toString() })
            buttons(dialog.window!!.decorView).single { it.text == "关闭" }.performClick()
            assertFalse(dialog.isShowing)
            assertTrue(RawTraffic.enabled)
            assertTrue(actions.isEmpty())
            assertFalse(DiagnosticLogDialog.claimRestartPrompt())
            for ((text, action) in listOf("结束并导出" to DiagnosticLogAction.STOP_EXPORT,
                "结束并分享" to DiagnosticLogAction.STOP_SHARE)) {
                logs.show(); dialog = ShadowAlertDialog.getLatestAlertDialog()
                buttons(dialog.window!!.decorView).single { it.text == text }.performClick()
                assertEquals(action, actions.last())
            }
        } finally {
            logs.close(); AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            RawTraffic.clear(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy()
        }
    }

    @Test fun sharingKeepsDialogAndReusesTheSameReport() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        var preparations = 0
        var completed: ((Result<DiagnosticExportStore.SavedReport?>) -> Unit)? = null
        val shared = mutableListOf<DiagnosticExportStore.SavedReport>()
        val logs = DiagnosticLogDialog(activity,
            prepareShare = { action, callback ->
                assertEquals(DiagnosticLogAction.STOP_SHARE, action)
                preparations++
                completed = callback
            }, shareAgain = { shared.add(it) })
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            logs.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            val share = buttons(dialog.window!!.decorView).single { it.text == "结束并分享" }
            share.performClick()
            share.performClick()
            assertEquals(1, preparations)
            assertTrue(dialog.isShowing)
            val saved = DiagnosticExportStore.SavedReport(Uri.parse("content://example/report"), mimeType = "application/zip")
            completed!!(Result.success(saved))
            assertEquals("再次分享", share.text.toString())
            share.performClick()
            share.performClick()
            assertEquals(listOf(saved, saved), shared)
            assertEquals(1, preparations)
            assertTrue(dialog.isShowing)
        } finally {
            logs.close(); AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.STANDARD)
            RawTraffic.clear(); DiagnosticLogs.resetForTest(); controller.pause().stop().destroy()
        }
    }

    @Test fun failedPreparationAllowsRetryWithoutDiscardingCapture() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        var attempts = 0
        val logs = DiagnosticLogDialog(activity, prepareShare = { _, callback ->
            attempts++
            callback(Result.failure(java.io.IOException("storage unavailable")))
        })
        try {
            AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
            logs.show()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            val share = buttons(dialog.window!!.decorView).single { it.text == "结束并分享" }
            share.performClick()
            share.performClick()
            assertEquals(2, attempts)
            assertTrue(dialog.isShowing)
            assertTrue(RawTraffic.enabled)
            buttons(dialog.window!!.decorView).single { it.text == "关闭" }.performClick()
            assertTrue(RawTraffic.enabled)
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
