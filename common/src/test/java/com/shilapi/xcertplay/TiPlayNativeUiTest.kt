package com.shilapi.xcertplay

import android.app.Activity
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.Switch
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import com.shilapi.xcertplay.host.R

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], qualifiers = "en-notnight")
class TiPlayNativeUiTest {
    @Config(sdk = [30])
    @Test fun safeBoundsPreservePagePaddingAcrossInsetsKeyboardAndRotation() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val root = LinearLayout(activity).apply { setPadding(11, 12, 13, 14) }
        TiPlayNativeUi(activity).protectSystemInsets(root)
        activity.setContentView(root)
        fun dispatch(bars: Insets, cutout: Insets = Insets.NONE, keyboard: Int = 0) {
            ViewCompat.dispatchApplyWindowInsets(root, WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.systemBars(), bars)
                .setInsets(WindowInsetsCompat.Type.displayCutout(), cutout)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, keyboard))
                .build())
        }
        dispatch(Insets.of(0, 24, 0, 30), Insets.of(0, 40, 0, 0))
        assertEquals(52, root.paddingTop)
        assertEquals(44, root.paddingBottom)
        dispatch(Insets.of(0, 24, 0, 30), keyboard = 250)
        assertEquals(36, root.paddingTop)
        assertEquals(264, root.paddingBottom)
        dispatch(Insets.of(0, 24, 0, 30), keyboard = 250)
        assertEquals(264, root.paddingBottom)
        dispatch(Insets.of(0, 0, 30, 0), Insets.of(44, 0, 0, 0))
        assertEquals(55, root.paddingLeft)
        assertEquals(12, root.paddingTop)
        assertEquals(43, root.paddingRight)
        assertEquals(14, root.paddingBottom)
        activity.finish()
    }
    private fun checkNativeAppearance() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        val native = Button(activity)
        val button = Button(activity).apply {
            setTextColor(android.graphics.Color.MAGENTA)
            textSize = 30f
            setBackgroundColor(android.graphics.Color.RED)
            setPadding(1, 2, 3, 4)
            layoutParams = LinearLayout.LayoutParams(-1, 50)
        }
        TiPlayNativeUi(activity).styleTree(button)
        assertEquals(native.textColors, button.textColors)
        assertEquals(native.textSize, button.textSize, 0f)
        assertEquals(native.typeface, button.typeface)
        assertEquals(native.background.javaClass, button.background.javaClass)
        assertEquals(native.backgroundTintList, button.backgroundTintList)
        assertEquals(native.paddingLeft, button.paddingLeft)
        assertEquals(native.minimumHeight, button.minimumHeight)
        assertEquals(-2, button.layoutParams.height)
        activity.finish()
    }
    @Test fun lightAppearanceUsesNativeThemeDefaults() = checkNativeAppearance()
    @Config(qualifiers = "en-night")
    @Test fun darkAppearanceUsesNativeThemeDefaults() = checkNativeAppearance()
    @Test fun nativeRestorationPreservesInputSecuritySelectionAndActions() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.setTheme(R.style.Theme_TiPlayNative)
        val root = LinearLayout(activity)
        val field = EditText(activity).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText("password1")
        }
        val selected = RadioButton(activity).apply { isChecked = true }
        var switches = 0
        val toggle = Switch(activity).apply {
            isChecked = true
            setOnCheckedChangeListener { _, _ -> switches++ }
            thumbTintList = android.content.res.ColorStateList.valueOf(android.graphics.Color.MAGENTA)
        }
        var clicks = 0
        val action = Button(activity).apply { setOnClickListener { clicks++ } }
        root.addView(field); root.addView(selected); root.addView(action); root.addView(toggle)
        TiPlayNativeUi(activity).styleTree(root)
        assertEquals("password1", field.text.toString())
        assertEquals(InputType.TYPE_TEXT_VARIATION_PASSWORD, field.inputType and InputType.TYPE_MASK_VARIATION)
        assertTrue(selected.isChecked)
        assertTrue(action.performClick()); assertEquals(1, clicks)
        assertEquals(requireNotNull(RadioButton(activity).buttonDrawable).javaClass,
            requireNotNull(selected.buttonDrawable).javaClass)
        assertEquals(EditText(activity).background.javaClass, field.background.javaClass)
        assertTrue(toggle.isChecked)
        assertEquals(0, switches)
        assertEquals(Switch(activity).thumbTintList, toggle.thumbTintList)
        toggle.toggle()
        assertEquals(1, switches)
        activity.finish()
    }
}
