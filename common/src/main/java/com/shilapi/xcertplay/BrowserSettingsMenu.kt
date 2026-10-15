package com.shilapi.xcertplay

import android.app.Activity
import android.content.Context
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Switch
import com.shilapi.xcertplay.host.R

/** Immediate browser/link settings are independent of the host menu's connection/video draft. */
internal object BrowserSettingsMenu {
    private fun colors(activity: Activity) = TextView(activity).currentTextColor.let {
        HotspotExtraAddressCard.Colors(muted = it, warning = it, ready = it)
    }

    private fun note(context: Context, text: String) = TextView(context).apply {
        this.text = text
    }

    private fun button(parent: LinearLayout, text: String, click: () -> Unit) = Button(parent.context).apply {
        this.text = text
        isAllCaps = false
        setOnClickListener { click() }
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = TiPlayNativeUi(parent.context).dp(8)
        })
    }

    fun addHotspotAddress(parent: LinearLayout, activity: Activity, methodParent: LinearLayout? = null,
        onMethodChanged: (() -> Unit)? = null,
        showHints: () -> Boolean = { true }, browserReady: () -> Boolean = { false },
        newHintReporter: (() -> ((String, String?) -> Unit))? = null): () -> Unit {
        val rows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(rows, LinearLayout.LayoutParams(-1, -2))
        val methodRows = methodParent?.let { target ->
            LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                target.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = TiPlayNativeUi(activity).dp(12) })
            }
        }
        val feedback = newHintReporter?.let { HotspotOperationFeedback() }
        var previousApplicability = showHints()
        fun render() {
            if (previousApplicability != showHints()) feedback?.cancel()
            previousApplicability = showHints()
            rows.removeAllViews()
            methodRows?.removeAllViews()
            val reporter = newHintReporter?.invoke()
            feedback?.onChanged = {
                if (feedback.owns(HotspotExtraAddressSettings.method(activity))) reporter?.invoke("method", null)
            }
            HotspotExtraAddressCard(activity, indexing = false, colors = colors(activity),
                note = { note(activity, it) },
                settingRow = { target, text, click -> button(target, text, click); Unit },
                actionButton = ::button, rerender = onMethodChanged ?: ::render, showEndpoint = false,
                hintReporter = reporter, showOperationalHints = showHints, browserReady = browserReady,
                operationFeedback = feedback,
            ).build(rows)
            // Put the method chooser before status/explanation lines.
            val chooser = (0 until rows.childCount).map(rows::getChildAt).firstOrNull { it is Button }
            if (chooser != null) {
                rows.removeView(chooser)
                if (methodRows == null) rows.addView(chooser, 0) else methodRows.addView(chooser)
            }
            BrowserNativeSettingsUi(activity).normalizeSpacing(rows, recursive = true)
            methodRows?.let { BrowserNativeSettingsUi(activity).normalizeSpacing(it, recursive = true) }
        }
        render()
        return ::render
    }

    fun addBrowserLink(parent: LinearLayout, activity: Activity,
        newHintReporter: (() -> ((String, String?) -> Unit))? = null, requestLocalNetwork: () -> Unit): () -> Unit {
        val rows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(rows, LinearLayout.LayoutParams(-1, -2))
        fun render() {
            rows.removeAllViews()
            rows.addView(note(activity, activity.getString(R.string.settings_tesla_browser)).apply {
                setTextAppearance(android.R.style.TextAppearance_Material_Large)
                androidx.core.view.ViewCompat.setAccessibilityHeading(this, true)
            })
            TeslaBrowserLinkCard(activity, indexing = false, colors = colors(activity),
                note = { note(activity, it) },
                settingRow = { target, text, click -> button(target, text, click); Unit },
                actionRow = { target, text, click -> button(target, text, click); Unit },
                requestLocalNetwork = requestLocalNetwork, rerender = ::render, compactEndpoint = true,
                hintReporter = newHintReporter?.invoke(),
            ).build(rows)
            BrowserNativeSettingsUi(activity).normalizeSpacing(rows, recursive = true)
        }
        render()
        return ::render
    }

    fun addAutoStartOnBoot(parent: LinearLayout) {
        parent.addView(Switch(parent.context).apply {
            setText(R.string.auto_start_on_boot)
            isChecked = AirPlayPersistence.loadAutoStartOnBoot(parent.context)
            minHeight = TiPlayNativeUi(parent.context).dp(48)
            setOnCheckedChangeListener { _, checked -> AirPlayPersistence.saveAutoStartOnBoot(parent.context, checked) }
        }, LinearLayout.LayoutParams(-1, -2))
        parent.addView(note(parent.context, parent.context.getString(R.string.settings_browser_boot_hint)))
    }
}
