package com.shilapi.xcertplay

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.settings.SettingsTheme
import com.shilapi.xcertplay.settings.SettingsWidgets

/** The browser product has one everyday menu and one advanced menu. */
internal object BrowserMainSettingsMenu {
    data class Result(val view: View, val hotspotStatus: TextView, val preview: TextView)

    fun build(
        activity: Activity,
        wireless: () -> Boolean,
        changeConnectionMode: (Boolean) -> Unit,
        hotspot: () -> View,
        requestLocalNetwork: () -> Unit,
        advanced: () -> Unit,
        about: () -> Unit,
        save: () -> Unit,
        cancel: () -> Unit,
        exit: () -> Unit,
    ): Result {
        fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
        fun text(value: String, size: Float = 14f) = TextView(activity).apply {
            text = value
            textSize = size
            setTextColor(SettingsTheme.OVERLAY.textSecondary)
        }
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }
        fun heading(id: Int) {
            content.addView(SettingsWidgets.createCategoryHeader(activity, activity.getString(id), SettingsTheme.OVERLAY),
                LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        }
        fun button(id: Int, click: () -> Unit) = Button(activity).apply {
            text = activity.getString(id)
            isAllCaps = false
            setOnClickListener { click() }
            content.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        }
        content.addView(text(activity.getString(R.string.settings_main), 28f))
        heading(R.string.connection)
        BrowserSettingsMenu.addHotspotAddress(content, activity)
        content.addView(BrowserSettingsPresentation.connectionMode(activity, wireless, changeConnectionMode))
        content.addView(text(activity.getString(R.string.settings_connection_mode_hint)))
        BrowserSettingsMenu.addBrowserLink(content, activity, requestLocalNetwork)
        content.addView(hotspot())
        content.addView(text(activity.getString(R.string.hotspot_status), 18f))
        val hotspotStatus = text("")
        content.addView(hotspotStatus)
        heading(R.string.settings_startup_and_connection)
        BrowserSettingsMenu.addConnectOnOpen(content)
        button(R.string.settings_advanced, advanced)
        content.addView(text(activity.getString(R.string.settings_browser_advanced_summary)))
        val preview = text("")
        content.addView(preview, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        button(R.string.save_and_reconnect, save).apply {
            backgroundTintList = ColorStateList.valueOf(SettingsTheme.OVERLAY.accent)
            setTextColor(SettingsTheme.OVERLAY.buttonText)
        }
        button(R.string.back, cancel).contentDescription = activity.getString(R.string.discard_changes_and_exit_settings)
        button(R.string.language_app_language) { AppLocale.showPicker(activity) }
        button(R.string.about, about)
        button(R.string.exit_application, exit)
        val scroll = ScrollView(activity).apply {
            isFillViewport = true
            addView(content)
            setBackgroundColor(Color.rgb(18, 24, 29))
        }
        val overlay = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            isClickable = true
            addView(scroll, FrameLayout.LayoutParams(minOf(activity.resources.displayMetrics.widthPixels, 1000), -1, Gravity.CENTER))
            addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
                val width = minOf(view.width, 1000)
                if (scroll.layoutParams.width != width) scroll.layoutParams =
                    (scroll.layoutParams as FrameLayout.LayoutParams).apply { this.width = width }
            }
        }
        return Result(overlay, hotspotStatus, preview)
    }
}
