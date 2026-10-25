package com.shilapi.xcertplay

import android.app.Activity
import android.view.View
import android.widget.LinearLayout
import com.shilapi.xcertplay.host.R

internal object BrowserAboutPage {
    fun build(activity: Activity, version: String, back: () -> Unit): View {
        val ui = TiPlayNativeUi(activity)
        val spacing = BrowserNativeSettingsUi(activity)
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
        }
        spacing.button(content, activity.getString(R.string.back), back)
        fun text(value: String, heading: Boolean = false, bold: Boolean = false) {
            content.addView(ui.label(value, heading).apply {
                if (bold) ui.emphasize(this)
                if (heading) spacing.section(this)
            }, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = ui.dp(if (heading) 16 else 8)
            })
        }
        text(activity.getString(R.string.diplay), heading = true, bold = true)
        text(activity.getString(R.string.carplay_at_home_in_your_car))
        text(version, heading = true)
        text(activity.getString(R.string.an_independent_carplay_receiver_for_android_head_units_wir))
        text(activity.getString(R.string.made_possible_by_open_source), true)
        text(activity.getString(R.string.receiver_based_on_xcertplay_licensed_under_gpl_3_0_diplay))
        spacing.normalizeSpacing(content, recursive = true)
        return spacing.page(content)
    }
}
