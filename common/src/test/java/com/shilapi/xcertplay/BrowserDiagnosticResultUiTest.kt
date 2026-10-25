package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "zh-rCN")
class BrowserDiagnosticResultUiTest {
    private fun buttons(view: View): List<Button> = if (view is Button) listOf(view)
        else if (view is ViewGroup) (0 until view.childCount).flatMap { buttons(view.getChildAt(it)) } else emptyList()
    private fun button(dialog: AlertDialog, text: String) = buttons(dialog.window!!.decorView).single { it.text == text }

    @Test fun exportedReportOffersCopyFolderAndCloseAndOpensOnlyItsParentDirectory() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val file = File(Environment.getExternalStorageDirectory(), "Download/TiPlay/report.zip")
        try {
            BrowserDiagnosticResultUi.saved(activity, DiagnosticExportStore.SavedReport(
                Uri.parse("content://reports/report.zip"), savedPath = file.path, mimeType = "application/zip"))
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            val actions = buttons(dialog.window!!.decorView).filter { it.visibility == View.VISIBLE }
            assertEquals(listOf("复制路径", "打开文件夹", "关闭"), actions.map { it.text.toString() })
            val bar = actions.first().parent as LinearLayout
            assertEquals(LinearLayout.HORIZONTAL, bar.orientation)
            assertTrue(actions.all { it.parent === bar })
            button(dialog, "复制路径").performClick()
            assertEquals(file.path, activity.getSystemService(ClipboardManager::class.java).primaryClip!!.getItemAt(0).text.toString())
            assertTrue(dialog.isShowing)
            button(dialog, "打开文件夹").performClick()
            val opened = shadowOf(activity).nextStartedActivity
            assertEquals(Intent.ACTION_VIEW, opened.action)
            assertEquals(DocumentsContract.Document.MIME_TYPE_DIR, opened.type)
            assertEquals("primary:Download/TiPlay", DocumentsContract.getDocumentId(opened.data!!))
            assertFalse(opened.data.toString().contains("report.zip"))
            assertFalse(dialog.isShowing)
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun inaccessiblePrivateFolderDoesNotFallBackToOpeningTheFile() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        try {
            BrowserDiagnosticResultUi.saved(activity, DiagnosticExportStore.SavedReport(
                Uri.parse("content://reports/private.zip"), savedPath = File(activity.filesDir, "diagnostic-reports/private.zip").path,
                mimeType = "application/zip"))
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            button(dialog, "打开文件夹").performClick()
            assertNull(shadowOf(activity).nextStartedActivity)
            assertTrue(dialog.isShowing)
        } finally { ShadowAlertDialog.getLatestAlertDialog()?.dismiss(); controller.pause().stop().destroy() }
    }

    @Config(sdk = [30])
    @Test fun scopedStoragePrivateExternalFolderCannotBePresentedAsBrowsable() {
        val file = File(Environment.getExternalStorageDirectory(), "Android/data/com.ujzk.tiplay/files/diagnostic-reports/report.zip")
        assertNull(BrowserDiagnosticResultUi.folderUri(file.path))
    }
}
