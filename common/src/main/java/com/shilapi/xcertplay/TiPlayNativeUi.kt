package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.res.Configuration
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.doOnAttach

/** Native phone widgets, with safe window bounds independent of upstream projection UI. */
internal class TiPlayNativeUi(private val context: Context) {
    private enum class TextRole { HEADING, EMPHASIS }

    fun emphasize(view: TextView) {
        view.tag = TextRole.EMPHASIS
        view.typeface = Typeface.create(view.typeface, Typeface.BOLD)
        // Some OEM font replacements expose a bold style without a visibly heavier face.
        view.paint.isFakeBoldText = true
    }

    fun label(value: String, heading: Boolean = false) = TextView(context).apply {
        text = value
        if (heading) {
            tag = TextRole.HEADING
            setTextAppearance(android.R.style.TextAppearance_Material_Large)
        }
    }
    val background: Int
        get() = context.obtainStyledAttributes(intArrayOf(android.R.attr.colorBackground)).let {
            try { it.getColor(0, 0) } finally { it.recycle() }
        }

    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun applyWindow(activity: Activity) {
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        activity.window.statusBarColor = background
        activity.window.navigationBarColor = background
        val light = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK != Configuration.UI_MODE_NIGHT_YES
        WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
            show(WindowInsetsCompat.Type.systemBars())
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    /** Capture the original padding so repeated dispatches and keyboard dismissal cannot accumulate it. */
    fun protectSystemInsets(view: View) {
        val left = view.paddingLeft
        val top = view.paddingTop
        val right = view.paddingRight
        val bottom = view.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            target.setPadding(left + safe.left, top + safe.top, right + safe.right, bottom + maxOf(safe.bottom, keyboard.bottom))
            insets
        }
        view.doOnAttach { ViewCompat.requestApplyInsets(it) }
    }

    fun showDialog(dialog: AlertDialog) { dialog.show() }

    /** Strip inherited custom appearances while retaining the shared widgets' values and actions. */
    fun styleTree(view: View) {
        view.foreground = null
        when (view) {
            is EditText -> restoreText(view, EditText(context))
            is RadioButton -> {
                val native = RadioButton(context)
                restoreText(view, native)
                view.buttonDrawable = native.buttonDrawable
                view.buttonTintList = native.buttonTintList
            }
            is Switch -> {
                val native = Switch(context)
                restoreText(view, native)
                view.thumbDrawable = native.thumbDrawable
                view.trackDrawable = native.trackDrawable
                view.thumbTintList = native.thumbTintList
                view.trackTintList = native.trackTintList
            }
            is CheckBox -> {
                val native = CheckBox(context)
                restoreText(view, native)
                view.buttonDrawable = native.buttonDrawable
                view.buttonTintList = native.buttonTintList
            }
            is Button -> {
                val native = Button(context)
                restoreText(view, native)
                view.transformationMethod = native.transformationMethod
                view.setCompoundDrawablesRelative(null, null, null, null)
                view.layoutParams?.let { params -> params.height = ViewGroup.LayoutParams.WRAP_CONTENT; view.layoutParams = params }
            }
            is TextView -> {
                restoreText(view, TextView(context), preservePadding = true)
                if (view.tag == TextRole.HEADING) view.setTextAppearance(android.R.style.TextAppearance_Material_Large)
            }
            is SeekBar -> {
                val native = SeekBar(context)
                view.background = native.background
                view.progressDrawable = native.progressDrawable
                view.thumb = native.thumb
                view.progressTintList = native.progressTintList
                view.progressBackgroundTintList = native.progressBackgroundTintList
                view.thumbTintList = native.thumbTintList
            }
            is ImageView -> { view.imageTintList = null; view.background = null }
            is ViewGroup -> view.background = null
        }
        if (view is TextView && view.tag == TextRole.EMPHASIS) emphasize(view)
        if (view is ScrollView) view.setBackgroundColor(background)
        if (view is ViewGroup) for (i in 0 until view.childCount) styleTree(view.getChildAt(i))
    }

    private fun restoreText(target: TextView, native: TextView, preservePadding: Boolean = false) {
        target.background = native.background
        target.backgroundTintList = native.backgroundTintList
        target.setTextColor(native.textColors)
        target.setHintTextColor(native.hintTextColors)
        target.setLinkTextColor(native.linkTextColors)
        target.setTextSize(TypedValue.COMPLEX_UNIT_PX, native.textSize)
        target.typeface = native.typeface
        target.letterSpacing = native.letterSpacing
        target.setLineSpacing(native.lineSpacingExtra, native.lineSpacingMultiplier)
        target.includeFontPadding = native.includeFontPadding
        target.gravity = native.gravity
        target.minHeight = native.minHeight
        target.minimumHeight = native.minimumHeight
        target.minWidth = native.minWidth
        target.minimumWidth = native.minimumWidth
        target.stateListAnimator = native.stateListAnimator
        if (!preservePadding) target.setPadding(native.paddingLeft, native.paddingTop, native.paddingRight, native.paddingBottom)
    }
}
