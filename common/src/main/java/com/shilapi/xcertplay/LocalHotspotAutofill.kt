package com.shilapi.xcertplay

import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.shilapi.xcertplay.host.R

/** Optional import alongside the original editable fields. Results never overwrite concurrent typing. */
internal object LocalHotspotAutofill {
    private val probes = LatestSettingsProbe<LocalHotspotSettings.Credentials?>("tiplay-hotspot-read")
    internal fun awaitProbesForTest(): Boolean = probes.awaitIdle()

    fun attach(parent: LinearLayout, ssid: EditText, password: EditText, controlsParent: LinearLayout = parent,
        showHint: Boolean = true): LinearLayout {
        val status = TextView(parent.context).apply {
            setText(R.string.settings_hotspot_read_hint)
            setTextColor(ssid.currentTextColor)
            visibility = if (showHint) View.VISIBLE else View.GONE
        }
        val button = Button(parent.context).apply { setText(R.string.settings_hotspot_read); isAllCaps = false }
        val controls = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            addView(button)
            addView(status)
        }
        controlsParent.addView(controls, if (controlsParent === parent) 0 else minOf(1, controlsParent.childCount))
        val app = parent.context.applicationContext
        var token: LatestSettingsProbe.Token? = null
        fun read(replace: Boolean) {
            if (!parent.isShown || !parent.isAttachedToWindow) return
            button.isEnabled = false
            status.setText(R.string.settings_hotspot_reading)
            status.visibility = if (showHint || replace) View.VISIBLE else View.GONE
            val beforeName = ssid.text.toString()
            val beforePassword = password.text.toString()
            token = probes.request(
                work = { runCatching { LocalHotspotSettings.read(app) }.getOrNull() },
                deliver = { result ->
                    button.isEnabled = true
                    if (parent.isShown && parent.isAttachedToWindow) {
                        status.setText(when {
                            result == null -> R.string.settings_hotspot_read_unavailable
                            result.password == null -> R.string.settings_hotspot_read_partial
                            else -> R.string.settings_hotspot_read_success
                        })
                        status.visibility = if (showHint || replace || result == null) View.VISIBLE else View.GONE
                        if (result != null) {
                            if (ssid.text.toString() == beforeName && (replace || beforeName.isBlank())) ssid.setText(result.ssid)
                            if (password.text.toString() == beforePassword && (replace || beforePassword.isBlank())) {
                                result.password?.let(password::setText)
                            }
                        }
                    }
                },
            )
        }
        button.setOnClickListener { read(true) }
        parent.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) { view.post { read(false) } }
            override fun onViewDetachedFromWindow(view: View) {
                probes.cancel(token)
                token = null
                button.isEnabled = true
            }
        })
        if (parent.isAttachedToWindow) parent.post { read(false) }
        return controls
    }

    fun attach(parent: LinearLayout, controlsParent: LinearLayout = parent): LinearLayout? {
        fun inputs(view: View): List<EditText> = when (view) {
            is EditText -> listOf(view)
            is ViewGroup -> (0 until view.childCount).flatMap { inputs(view.getChildAt(it)) }
            else -> emptyList()
        }
        val fields = inputs(parent)
        return if (fields.size >= 2) attach(parent, fields.first(), fields.last(), controlsParent) else null
    }
}
