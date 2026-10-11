package com.shilapi.xcertplay

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/** The browser's additional pages use the same native widget rhythm as its main menu. */
internal class BrowserNativeSettingsUi(private val context: Context) {
    private val ui = TiPlayNativeUi(context)

    fun toggle(parent: LinearLayout, title: String, description: String, value: Boolean,
        enabled: Boolean, save: (Boolean) -> Unit): Switch {
        val group = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val control = Switch(context).apply {
            text = title
            contentDescription = title
            minHeight = ui.dp(48)
            isChecked = value
            isEnabled = enabled
            setOnCheckedChangeListener { _, selected -> save(selected) }
        }
        group.addView(control, LinearLayout.LayoutParams(-1, -2))
        if (description.isNotEmpty()) group.addView(TextView(context).apply {
            text = description
            setPadding(0, ui.dp(4), 0, 0)
        })
        parent.addView(group)
        return control
    }

    fun normalizeSpacing(container: LinearLayout) {
        for (index in 0 until container.childCount) {
            val child = container.getChildAt(index)
            // The inherited builders insert blank views between rows as well as margins.
            if (child.javaClass == View::class.java) {
                child.layoutParams.height = 0
                continue
            }
            val params = child.layoutParams as? LinearLayout.LayoutParams ?: continue
            if (child is Button) {
                params.height = ViewGroup.LayoutParams.WRAP_CONTENT
                child.minHeight = ui.dp(48)
            }
            params.topMargin = if (index == 0) 0 else ui.dp(8)
            params.bottomMargin = 0
            child.layoutParams = params
        }
    }
}
