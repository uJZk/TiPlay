package com.shilapi.xcertplay

import android.app.Activity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.settings.SettingsTheme
import com.shilapi.xcertplay.settings.SettingsWidgets

/** Immediate browser/link settings are independent of the host menu's connection/video draft. */
internal object BrowserSettingsMenu {
    private fun colors(activity: Activity) = TiPlayExpressiveUi(activity).let {
        HotspotExtraAddressCard.Colors(muted = it.muted, warning = it.warning, ready = it.ready)
    }

    private fun note(activity: Activity, text: String) = TextView(activity).apply {
        this.text = text
        textSize = 14f
        setTextColor(colors(activity).muted)
    }

    private fun button(parent: LinearLayout, text: String, click: () -> Unit) = Button(parent.context).apply {
        this.text = text
        isAllCaps = false
        TiPlayExpressiveUi(parent.context).button(this)
        setOnClickListener { click() }
        parent.addView(this, LinearLayout.LayoutParams(-1, -2))
    }

    fun addHotspotAddress(parent: LinearLayout, activity: Activity): () -> Unit {
        val rows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(rows, LinearLayout.LayoutParams(-1, -2))
        fun render() {
            rows.removeAllViews()
            HotspotExtraAddressCard(activity, indexing = false, colors = colors(activity),
                note = { note(activity, it) },
                settingRow = { target, text, click -> button(target, text, click); Unit },
                actionButton = ::button, rerender = ::render,
            ).build(rows)
            // Put the method chooser before status/explanation lines.
            val chooser = (0 until rows.childCount).map(rows::getChildAt).firstOrNull { it is Button }
            if (chooser != null) {
                rows.removeView(chooser)
                rows.addView(chooser, 0)
            }
        }
        render()
        return ::render
    }

    fun addBrowserLink(parent: LinearLayout, activity: Activity, requestLocalNetwork: () -> Unit): () -> Unit {
        val rows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(rows, LinearLayout.LayoutParams(-1, -2))
        fun render() {
            rows.removeAllViews()
            rows.addView(note(activity, activity.getString(R.string.settings_tesla_browser)).apply { textSize = 20f })
            TeslaBrowserLinkCard(activity, indexing = false, colors = colors(activity),
                note = { note(activity, it) },
                settingRow = { target, text, click -> button(target, text, click); Unit },
                actionRow = { target, text, click -> button(target, text, click); Unit },
                requestLocalNetwork = requestLocalNetwork, rerender = ::render,
            ).build(rows)
        }
        render()
        return ::render
    }

    fun addConnectOnOpen(parent: LinearLayout) {
        val row = SettingsWidgets.createSwitchRow(
            context = parent.context,
            label = parent.context.getString(R.string.connect_when_diplay_opens),
            checked = DiPlayPreferences.autoConnect(parent.context),
            description = parent.context.getString(R.string.settings_connect_on_open_hint),
            theme = SettingsTheme.OVERLAY,
        ) { DiPlayPreferences.saveAutoConnect(parent.context, it) }.rowView
        TiPlayExpressiveUi(parent.context).styleTree(row)
        parent.addView(row)
    }
}
