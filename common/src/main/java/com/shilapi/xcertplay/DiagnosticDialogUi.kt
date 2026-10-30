package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.widget.Button
import android.widget.LinearLayout

/** Shared native dialog frame and wrapping text-button bar for logs and export results. */
internal object DiagnosticDialogUi {
    data class Action(val title: Int, val onClick: () -> Boolean = { true })

    fun show(activity: Activity, title: Int, body: View, actions: List<Action>,
        onDismiss: () -> Unit = {},
    ): AlertDialog {
        val ui = TiPlayNativeUi(activity)
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(body)
        }
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            isBaselineAligned = false
            setPadding(ui.dp(8), 0, ui.dp(8), ui.dp(8))
        }
        val dialog = AlertDialog.Builder(activity).setTitle(title).setView(content).create()
        actions.forEach { action ->
            bar.addView(Button(activity, null, android.R.attr.buttonBarButtonStyle).apply {
                setText(action.title)
                tag = action.title
                isAllCaps = false
                isSingleLine = false
                maxLines = Int.MAX_VALUE
                minWidth = 0
                minimumWidth = 0
                minHeight = ui.dp(48)
                setOnClickListener { if (action.onClick()) dialog.dismiss() }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        content.addView(bar, LinearLayout.LayoutParams(-1, -2))
        dialog.setOnDismissListener { onDismiss() }
        ui.showDialog(dialog)
        return dialog
    }
}
