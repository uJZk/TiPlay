package com.shilapi.xcertplay

import android.view.TextureView
import android.view.View
import android.widget.TextView
import com.shilapi.xcertplay.host.R

/** Phone receiver UI: retain layout measurement without creating a local video surface. */
internal object PhoneBrowserReceiverUi {
    fun configure(
        video: TextureView,
        gestures: View,
        settings: TextView,
        onSize: (Int, Int) -> Unit,
        openSettings: () -> Unit,
    ) {
        video.surfaceTextureListener = null
        video.visibility = View.INVISIBLE
        gestures.visibility = View.GONE
        video.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
            onSize(right - left, bottom - top)
        }
        settings.setText(R.string.app_settings)
        settings.isClickable = true
        settings.isFocusable = true
        settings.setOnClickListener { openSettings() }
    }

    fun update(panel: View?, gestures: View?, settings: TextView?, stage: TextView?, streaming: Boolean) {
        panel?.visibility = View.VISIBLE
        gestures?.visibility = View.GONE
        settings?.setText(R.string.app_settings)
        if (streaming) stage?.setText(R.string.carplay_connected)
    }
}
