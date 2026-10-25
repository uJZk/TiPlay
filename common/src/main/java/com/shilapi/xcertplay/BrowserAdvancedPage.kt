package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.widget.Switch
import android.widget.Button
import android.widget.LinearLayout
import com.shilapi.xcertplay.airplay.AirPlayDisplaySettings
import com.shilapi.xcertplay.host.R

/** Product-owned advanced controls; upstream settings remain available through their internal API. */
internal class BrowserAdvancedPage(
    private val activity: Activity,
    private val changed: () -> Unit,
    private val returnToMain: () -> Unit,
    private val showLogs: () -> Unit,
) {
    private val ui = TiPlayNativeUi(activity)
    private val spacing = BrowserNativeSettingsUi(activity)
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
    }
    val view: View = spacing.page(content)
    private fun heading(id: Int) {
        content.addView(ui.label(activity.getString(id), heading = true).also(spacing::section),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(16); bottomMargin = ui.dp(8) })
    }
    private val debugToggle: Switch
    private var refreshing = false
    private val reportButton: Button

    init {
        spacing.button(content, activity.getString(R.string.back), returnToMain)
        val rates = (AirPlayDisplaySettings.MIN_FPS..AirPlayDisplaySettings.MAX_FPS
            step AirPlayDisplaySettings.FPS_STEP).toList()
        lateinit var frameRate: Button
        fun rateLabel() = activity.getString(R.string.frame_rate) + " · ${AirPlayPersistence.loadFps(activity)} fps"
        frameRate = spacing.button(content, rateLabel()) {
            val selected = rates.indexOf(AirPlayPersistence.loadFps(activity)).coerceAtLeast(0)
            AlertDialog.Builder(activity).setTitle(R.string.frame_rate)
                .setSingleChoiceItems(rates.map { "$it fps" }.toTypedArray(), selected) { dialog, index ->
                    AirPlayPersistence.saveFps(activity, rates[index])
                    frameRate.text = rateLabel()
                    configurationChanged()
                    dialog.dismiss()
                }.setNegativeButton(R.string.cancel, null).show()
        }
        heading(R.string.carplay_controls)
        spacing.toggle(content, activity.getString(R.string.settings_carplay_disable),
            activity.getString(R.string.settings_carplay_disable_description), BrowserCarPlaySettings.disabled(activity), true) {
            BrowserCarPlaySettings.setDisabled(activity, it)
        }
        spacing.toggle(content, activity.getString(R.string.settings_browser_location_disable),
            activity.getString(R.string.settings_browser_location_disable_description),
            com.shilapi.xcertplay.location.BrowserLocationSettings.disabled(activity), true) {
            com.shilapi.xcertplay.location.BrowserLocationSettings.setDisabled(activity, it)
            configurationChanged()
        }
        BrowserCarPlayAudioSettings.addControls(activity, content,
            toggle = { parent, title, description, value, save ->
                spacing.toggle(parent, title, description, value, true, save)
                Unit
            }, changed = ::configurationChanged,
        )
        spacing.toggle(content, activity.getString(R.string.right_hand_drive),
            activity.getString(R.string.place_carplay_s_controls_closer_to_the_driver),
            AirPlayPersistence.loadRightHandDrive(activity), true) {
            AirPlayPersistence.saveRightHandDrive(activity, it)
            configurationChanged()
        }
        heading(R.string.settings_airplay_title)
        spacing.toggle(content, activity.getString(R.string.settings_airplay_disable),
            activity.getString(R.string.settings_airplay_disable_description),
            AirPlayReceiverSettings.isDisabled(activity), true) {
            AirPlayReceiverSettings.setDisabled(activity, it)
        }
        heading(R.string.diagnostics)
        debugToggle = spacing.toggle(content, activity.getString(R.string.settings_debug_logging), "",
            AirPlayPersistence.loadDiagnosticLogLevel(activity) == DiagnosticLogLevel.DEBUG, true) { enabled ->
            if (!refreshing) {
                if (enabled && !DiagnosticLogActions.busy) {
                    AirPlayPersistence.saveDiagnosticLogLevel(activity, DiagnosticLogLevel.DEBUG)
                    DiagnosticLogDialog.captureStartedInForeground()
                    refresh()
                } else if (!enabled) DiagnosticLogActions.perform(activity, DiagnosticLogAction.STOP, ::refresh)
            }
        }
        reportButton = spacing.button(content, activity.getString(R.string.settings_view_logs), showLogs)
        refresh()
    }

    private fun configurationChanged() {
        changed()
        refresh()
    }

    fun refresh() {
        refreshing = true
        if (!DiagnosticLogActions.busy) debugToggle.isChecked =
            AirPlayPersistence.loadDiagnosticLogLevel(activity) == DiagnosticLogLevel.DEBUG
        debugToggle.isEnabled = !DiagnosticLogActions.busy
        reportButton.isEnabled = !DiagnosticLogActions.busy
        refreshing = false
        spacing.normalizeSpacing(content, recursive = true)
    }
}
