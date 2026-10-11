package com.shilapi.xcertplay

import android.content.Context
import android.app.AlertDialog
import android.app.Activity
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.core.view.WindowInsetsControllerCompat

/** Product-only Material 3 Expressive styling, independent of upstream settings widgets. */
internal class TiPlayExpressiveUi(private val context: Context) {
    private val dark = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    private fun color(light: String, night: String) = Color.parseColor(if (dark) night else light)
    val background = color("#F6F8F4", "#101512")
    val surface = color("#FFFFFF", "#1C231F")
    val surfaceHigh = color("#E9EFE8", "#29332C")
    val primary = if (Build.VERSION.SDK_INT >= 31) context.getColor(if (dark) android.R.color.system_accent1_200 else android.R.color.system_accent1_600)
        else color("#356A4F", "#A0D5B1")
    val onPrimary = if (dark) Color.rgb(18, 42, 28) else Color.WHITE
    val primaryContainer = if (Build.VERSION.SDK_INT >= 31) context.getColor(if (dark) android.R.color.system_accent1_700 else android.R.color.system_accent1_100)
        else color("#C1ECD0", "#234D37")
    val onContainer = if (Build.VERSION.SDK_INT >= 31) context.getColor(if (dark) android.R.color.system_accent1_100 else android.R.color.system_accent1_900)
        else color("#123B25", "#C1ECD0")
    val text = color("#19251D", "#E0EAE1")
    val muted = color("#4C5D51", "#B7C7BA")
    val outline = color("#C7D3C9", "#49584C")
    val error = color("#A4322E", "#FFB4AB")
    val warning = color("#785600", "#EAC46A")
    val ready = color("#276A43", "#9CD7AE")
    fun applyWindow(activity: Activity) {
        activity.window.statusBarColor = background
        activity.window.navigationBarColor = background
        WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun shape(fill: Int, radius: Int = 24, stroke: Int? = null) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat()
        stroke?.let { setStroke(dp(1), it) }
    }
    private fun ripple(fill: Int, radius: Int, stroke: Int? = null) = RippleDrawable(
        ColorStateList.valueOf(Color.argb(35, Color.red(primary), Color.green(primary), Color.blue(primary))), shape(fill, radius, stroke), null)
    fun button(button: Button, prominent: Boolean = false) {
        button.apply {
            isAllCaps = false; textSize = 14f; minHeight = dp(if (prominent) 52 else 48)
            minimumHeight = minHeight; minWidth = 0; minimumWidth = 0
            setPadding(dp(16), dp(8), dp(16), dp(8))
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            background = ripple(if (prominent) primary else surfaceHigh, if (prominent) 28 else 18)
            backgroundTintList = null
            setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
                intArrayOf(muted, if (prominent) onPrimary else this@TiPlayExpressiveUi.text)))
            stateListAnimator = null
        }
    }
    fun input(field: EditText) {
        field.apply {
            minHeight = dp(56); minimumHeight = minHeight; textSize = 16f
            setPadding(dp(16), dp(12), dp(16), dp(12)); setTextColor(this@TiPlayExpressiveUi.text); setHintTextColor(muted)
            background = shape(surfaceHigh, 16, outline); backgroundTintList = null
        }
    }
    fun radio(button: RadioButton) {
        val checked = intArrayOf(android.R.attr.state_checked)
        button.apply {
            minHeight = dp(48); minimumHeight = minHeight
            textSize = 12f; gravity = android.view.Gravity.CENTER
            buttonDrawable = null; setPadding(dp(4), dp(8), dp(4), dp(8))
            background = StateListDrawable().apply {
                addState(checked, ripple(primaryContainer, 18, primary))
                addState(intArrayOf(), ripple(surfaceHigh, 18))
            }
            backgroundTintList = null
            setTextColor(ColorStateList(arrayOf(checked, intArrayOf()), intArrayOf(onContainer, muted)))
        }
    }
    fun card(parent: LinearLayout, hero: Boolean = false): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = shape(if (hero) primaryContainer else surface, if (hero) 28 else 24)
        setPadding(dp(12), dp(12), dp(12), dp(12))
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
    }
    fun showDialog(dialog: AlertDialog) {
        dialog.show()
        dialog.window?.setBackgroundDrawable(shape(surface, 28))
        dialog.findViewById<View>(android.R.id.content)?.let(::styleTree)
        for (id in listOf(AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE, AlertDialog.BUTTON_NEUTRAL)) {
            dialog.getButton(id)?.let { button(it) }
        }
    }
    /** Restyle existing advanced controls without changing their persistence, listeners or IDs. */
    fun styleTree(view: View) {
        when (view) {
            is RadioButton -> radio(view)
            is CompoundButton -> {
                view.setTextColor(text)
                val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf())
                val tint = ColorStateList(states, intArrayOf(primary, outline))
                if (view is Switch) { view.thumbTintList = tint; view.trackTintList = ColorStateList(states, intArrayOf(primaryContainer, surfaceHigh)) }
                else view.buttonTintList = tint
            }
            is Button -> button(view)
            is EditText -> input(view)
            is TextView -> {
                val previous = view.currentTextColor
                view.setTextColor(when (previous) {
                    Color.rgb(255, 196, 128) -> warning
                    Color.rgb(127, 205, 154) -> ready
                    else -> if (view.textSize / context.resources.displayMetrics.scaledDensity >= 18f) text else muted
                })
                if (view.textSize / context.resources.displayMetrics.scaledDensity >= 24f) {
                    view.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                }
            }
            is ImageView -> if (view.imageTintList != null) view.imageTintList = ColorStateList.valueOf(primary)
            is ScrollView -> view.setBackgroundColor(background)
            is LinearLayout -> if (view.background is GradientDrawable) view.background = shape(surface)
        }
        if (view is ViewGroup) for (i in 0 until view.childCount) styleTree(view.getChildAt(i))
    }
}
