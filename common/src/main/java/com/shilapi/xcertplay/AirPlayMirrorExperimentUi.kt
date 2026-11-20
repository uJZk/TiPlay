package com.shilapi.xcertplay

import android.app.AlertDialog
import android.content.Context
import android.widget.Button
import android.widget.LinearLayout
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.receiver.ReceiverMirrorExperiment

/** One mutually exclusive receiver experiment, shared by both browser advanced pages. */
internal object AirPlayMirrorExperimentUi {
    private val modes = ReceiverMirrorExperiment.entries

    private fun label(context: Context, mode: ReceiverMirrorExperiment): String = context.getString(when (mode) {
        ReceiverMirrorExperiment.BASELINE -> R.string.settings_airplay_mirror_experiment_baseline
        ReceiverMirrorExperiment.H264_ONLY -> R.string.settings_airplay_mirror_experiment_h264
        ReceiverMirrorExperiment.NO_BLE -> R.string.settings_airplay_mirror_experiment_no_ble
        ReceiverMirrorExperiment.LEGACY_PAIRING -> R.string.settings_airplay_mirror_experiment_pairing
    })

    private fun description(context: Context, mode: ReceiverMirrorExperiment): String = context.getString(when (mode) {
        ReceiverMirrorExperiment.BASELINE -> R.string.settings_airplay_mirror_experiment_baseline_description
        ReceiverMirrorExperiment.H264_ONLY -> R.string.settings_airplay_mirror_experiment_h264_description
        ReceiverMirrorExperiment.NO_BLE -> R.string.settings_airplay_mirror_experiment_no_ble_description
        ReceiverMirrorExperiment.LEGACY_PAIRING -> R.string.settings_airplay_mirror_experiment_pairing_description
    })

    fun addControls(context: Context, parent: LinearLayout,
        addButton: ((String, () -> Unit) -> Button)? = null,
    ) {
        val nativeUi = BrowserNativeSettingsUi(context)
        val title = context.getString(R.string.settings_airplay_mirror_experiment)
        fun currentLabel() = "$title · ${label(context, AirPlayMirrorExperimentSettings.get(context))}"
        lateinit var button: Button
        val open = {
            val selected = AirPlayMirrorExperimentSettings.get(context)
            val choices = modes.map { "${label(context, it)}\n${description(context, it)}" }.toTypedArray()
            AlertDialog.Builder(context).setTitle(title)
                .setSingleChoiceItems(choices, modes.indexOf(selected)) { dialog, index ->
                    AirPlayMirrorExperimentSettings.set(context, modes[index])
                    button.text = currentLabel()
                    dialog.dismiss()
                }.setNegativeButton(R.string.cancel, null).show()
            Unit
        }
        button = addButton?.invoke(currentLabel(), open) ?: nativeUi.button(parent, currentLabel(), open)
        parent.addView(TiPlayNativeUi(context).label(context.getString(R.string.settings_airplay_mirror_experiment_hint))
            .also(nativeUi::related), LinearLayout.LayoutParams(-1, -2))
    }
}
