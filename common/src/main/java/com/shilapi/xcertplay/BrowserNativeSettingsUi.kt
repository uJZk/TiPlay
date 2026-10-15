package com.shilapi.xcertplay

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import androidx.core.view.ViewCompat
import com.shilapi.xcertplay.host.R
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/** The browser's additional pages use the same native widget rhythm as its main menu. */
internal class BrowserNativeSettingsUi(private val context: Context) {
    private val ui = TiPlayNativeUi(context)

    private enum class Spacing(val dp: Int) { RELATED(4), FIELD(16), SECTION(24) }

    fun related(view: View) { view.setTag(R.id.settings_spacing_role, Spacing.RELATED) }
    fun field(view: View) { view.setTag(R.id.settings_spacing_role, Spacing.FIELD) }
    fun section(view: View) { view.setTag(R.id.settings_spacing_role, Spacing.SECTION) }

    fun pagePadding(view: View) { view.setPadding(ui.dp(16), ui.dp(16), ui.dp(16), ui.dp(16)) }

    fun toggle(parent: LinearLayout, title: String, description: String, value: Boolean,
        enabled: Boolean, save: (Boolean) -> Unit): Switch {
        val group = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val control = Switch(context).apply {
            text = title
            contentDescription = title
            minHeight = ui.dp(48)
            switchPadding = ui.dp(16)
            isChecked = value
            isEnabled = enabled
            setOnCheckedChangeListener { _, selected -> save(selected) }
        }
        group.addView(control, LinearLayout.LayoutParams(-1, -2))
        if (description.isNotEmpty()) group.addView(TextView(context).apply {
            text = description
            related(this)
        })
        parent.addView(group)
        normalizeSpacing(group)
        return control
    }

    private fun hasContent(view: View): Boolean = when {
        view.visibility == View.GONE || view.javaClass == View::class.java -> false
        view is LinearLayout -> (0 until view.childCount).any { hasContent(view.getChildAt(it)) }
        else -> true
    }

    /** Apply gaps between visible siblings once; nested groups never add a second edge gap. */
    fun normalizeSpacing(container: LinearLayout, recursive: Boolean = false) {
        var previous: View? = null
        for (index in 0 until container.childCount) {
            val child = container.getChildAt(index)
            if (child is Button) {
                child.minHeight = ui.dp(48)
                child.isAllCaps = false
            } else if (child is TextView && child !is EditText) {
                child.setPadding(child.paddingLeft, 0, child.paddingRight, 0)
            }
            if (recursive && child is LinearLayout) normalizeSpacing(child, recursive = true)
            if (container.orientation != LinearLayout.VERTICAL) continue
            val params = child.layoutParams as? LinearLayout.LayoutParams ?: continue
            // Inherited builders sometimes insert blank spacer views as well as margins.
            val spacer = child.javaClass == View::class.java
            val empty = !hasContent(child)
            if (spacer) params.height = 0
            else if (child is Button) params.height = ViewGroup.LayoutParams.WRAP_CONTENT
            val role = child.getTag(R.id.settings_spacing_role) as? Spacing
            params.topMargin = if (previous == null || empty || spacer) 0
                else ui.dp(role?.dp ?: if (ViewCompat.isAccessibilityHeading(child)) 24 else 8)
            params.bottomMargin = 0
            child.layoutParams = params
            if (!empty && !spacer) previous = child
        }
    }
}
