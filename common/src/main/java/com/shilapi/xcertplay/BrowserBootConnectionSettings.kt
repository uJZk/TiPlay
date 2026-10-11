package com.shilapi.xcertplay

import android.content.Context
import android.widget.Switch
import com.shilapi.xcertplay.host.R

/** The boot action requests a connection without changing the separate connect-on-open preference. */
internal object BrowserBootConnectionSettings {
    const val CONNECT_AFTER_BOOT = "tiplay_connect_after_boot"
    fun create(context: Context) = Switch(context).apply {
        setText(R.string.settings_browser_boot_connect)
        isChecked = AirPlayPersistence.loadAutoStartOnBoot(context)
        minHeight = TiPlayNativeUi(context).dp(48)
        setOnCheckedChangeListener { _, checked ->
            AirPlayPersistence.saveAutoStartOnBoot(context, checked)
        }
    }
}
