package com.shilapi.xcertplay

import android.app.Activity
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import androidx.core.graphics.ColorUtils
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-notnight")
class TiPlayExpressiveUiTest {
    private fun checkContrast() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val ui = TiPlayExpressiveUi(activity)
        for ((foreground, background) in listOf(ui.text to ui.surface, ui.muted to ui.surfaceHigh,
            ui.onPrimary to ui.primary, ui.onContainer to ui.primaryContainer, ui.error to ui.surface)) {
            assertTrue("Unreadable foreground/background pair", ColorUtils.calculateContrast(foreground, background) >= 4.5)
        }
        activity.finish()
    }
    @Test fun lightFallbackHasReadableText() = checkContrast()
    @Config(qualifiers = "en-night")
    @Test fun darkFallbackHasReadableText() = checkContrast()
    @Config(sdk = [31], qualifiers = "en-notnight")
    @Test fun lightDynamicColorsHaveReadableText() = checkContrast()
    @Config(sdk = [31], qualifiers = "en-night")
    @Test fun darkDynamicColorsHaveReadableText() = checkContrast()
    @Test fun stylingPreservesInputSecuritySelectionAndActions() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val root = LinearLayout(activity)
        val field = EditText(activity).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText("password1")
        }
        val selected = RadioButton(activity).apply { isChecked = true }
        var clicks = 0
        val action = Button(activity).apply { setOnClickListener { clicks++ } }
        root.addView(field); root.addView(selected); root.addView(action)
        TiPlayExpressiveUi(activity).styleTree(root)
        assertEquals("password1", field.text.toString())
        assertEquals(InputType.TYPE_TEXT_VARIATION_PASSWORD, field.inputType and InputType.TYPE_MASK_VARIATION)
        assertTrue(selected.isChecked)
        assertTrue(action.performClick()); assertEquals(1, clicks)
        assertTrue(action.minimumHeight >= (48 * activity.resources.displayMetrics.density).toInt())
        activity.finish()
    }
}
