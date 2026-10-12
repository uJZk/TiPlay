package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.shilapi.xcertplay.airplay.AirPlayDisplaySettings
import com.shilapi.xcertplay.host.R

/** Product-owned advanced controls; upstream settings remain available through their internal API. */
internal class BrowserAdvancedPage(
    private val activity: Activity,
    state: Bundle?,
    private val requestPermissions: (Array<String>) -> Unit,
    private val changed: () -> Unit,
    private val returnToMain: (Boolean) -> Unit,
    private val saveReport: () -> Unit,
) {
    private data class Configuration(val fps: Int, val hevc: Boolean, val rightHand: Boolean)
    private fun configuration() = Configuration(AirPlayPersistence.loadFps(activity),
        AirPlayPersistence.loadHevcEnabled(activity), AirPlayPersistence.loadRightHandDrive(activity))
    private val baseline = state?.getBundle(STATE)?.let {
        Configuration(it.getInt("fps"), it.getBoolean("hevc"), it.getBoolean("right_hand"))
    } ?: configuration()
    private var preservePending = state?.getBundle(STATE)?.getBoolean("pending_before")
        ?: PendingReconnect.isPending(CarPlayBackgroundSession.snapshot()?.controller)
    private var editedController: Any? = if (state?.containsKey(STATE) == true && !preservePending && configuration() != baseline)
        CarPlayBackgroundSession.snapshot()?.controller else null
    private val ui = TiPlayNativeUi(activity)
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(ui.dp(16), ui.dp(12), ui.dp(16), ui.dp(16))
    }
    val view: View = ScrollView(activity).apply {
        isFillViewport = true
        setBackgroundColor(ui.background)
        addView(content)
        ui.protectSystemInsets(this)
    }
    private fun button(title: String, click: () -> Unit) = Button(activity).apply {
        text = title
        minHeight = ui.dp(48)
        setOnClickListener { click() }
        content.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(8) })
    }
    private fun heading(id: Int) {
        content.addView(ui.label(activity.getString(id), heading = true),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(16); bottomMargin = ui.dp(8) })
    }
    private val back = button(activity.getString(R.string.back)) { returnToMain(edited) }
    val edited: Boolean get() = configuration() != baseline
    val reportButton: Button
    private val permissions: BrowserPermissionsPage

    init {
        heading(R.string.settings_browser_video)
        val rates = (AirPlayDisplaySettings.MIN_FPS..AirPlayDisplaySettings.MAX_FPS
            step AirPlayDisplaySettings.FPS_STEP).toList()
        lateinit var frameRate: Button
        fun rateLabel() = activity.getString(R.string.frame_rate) + " · ${AirPlayPersistence.loadFps(activity)} fps"
        frameRate = button(rateLabel()) {
            val selected = rates.indexOf(AirPlayPersistence.loadFps(activity)).coerceAtLeast(0)
            AlertDialog.Builder(activity).setTitle(R.string.frame_rate)
                .setSingleChoiceItems(rates.map { "$it fps" }.toTypedArray(), selected) { dialog, index ->
                    AirPlayPersistence.saveFps(activity, rates[index])
                    frameRate.text = rateLabel()
                    configurationChanged()
                    dialog.dismiss()
                }.setNegativeButton(R.string.cancel, null).show()
        }
        BrowserNativeSettingsUi(activity).toggle(content, activity.getString(R.string.settings_browser_hevc_title),
            "", AirPlayPersistence.loadHevcEnabled(activity), true) {
            AirPlayPersistence.saveHevcEnabled(activity, it)
            configurationChanged()
        }
        heading(R.string.carplay_controls)
        BrowserNativeSettingsUi(activity).toggle(content, activity.getString(R.string.right_hand_drive),
            activity.getString(R.string.place_carplay_s_controls_closer_to_the_driver),
            AirPlayPersistence.loadRightHandDrive(activity), true) {
            AirPlayPersistence.saveRightHandDrive(activity, it)
            configurationChanged()
        }
        heading(R.string.settings_airplay_title)
        BrowserNativeSettingsUi(activity).toggle(content, activity.getString(R.string.settings_airplay_disable),
            activity.getString(R.string.settings_airplay_disable_description),
            AirPlayReceiverSettings.isDisabled(activity), true) {
            AirPlayReceiverSettings.setDisabled(activity, it)
        }
        heading(R.string.diagnostics)
        reportButton = button(activity.getString(R.string.save_diagnostic_report), saveReport)
        heading(R.string.settings_permission_group)
        permissions = BrowserPermissionsPage(activity, content, requestPermissions)
        refresh()
    }

    private fun configurationChanged() {
        if (edited) {
            val current = CarPlayBackgroundSession.snapshot()?.controller
            if (editedController == null && PendingReconnect.isPending(current)) preservePending = true
            editedController = current
            changed()
        } else if (!preservePending && PendingReconnect.isPending(editedController)) PendingReconnect.clear()
        refresh()
    }

    fun refresh() {
        back.setText(if (edited) R.string.settings_return_and_apply else R.string.back)
        permissions.refresh()
    }

    fun retain(state: Bundle) {
        state.putBundle(STATE, Bundle().apply {
            putInt("fps", baseline.fps)
            putBoolean("hevc", baseline.hevc)
            putBoolean("right_hand", baseline.rightHand)
            putBoolean("pending_before", preservePending)
        })
    }

    companion object { private const val STATE = "browser_advanced_baseline" }
}
