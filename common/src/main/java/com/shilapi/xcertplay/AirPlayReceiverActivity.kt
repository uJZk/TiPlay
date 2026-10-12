package com.shilapi.xcertplay

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.shilapi.xcertplay.host.R

/** Driver-visible start/stop; the existing browser pairing page remains the display entry. */
@OptIn(UnstableApi::class)
class AirPlayReceiverActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var start: Button
    private lateinit var stop: Button
    private var refreshBrowser: () -> Unit = {}
    private val observer: (String) -> Unit = { state -> runOnUiThread {
        if (!isFinishing && ::status.isInitialized) {
            val disabled = AirPlayReceiverSettings.isDisabled(this)
            status.setText(if (disabled) R.string.settings_airplay_disabled else when (state) {
                "mirror" -> R.string.settings_airplay_mirror
                "video" -> R.string.settings_airplay_video
                "listening" -> R.string.settings_airplay_listening
                "no-network", "discovery-failed" -> R.string.settings_airplay_network
                "failed", "playback-failed", "permission" -> R.string.settings_airplay_failed
                else -> R.string.settings_airplay_stopped
            })
            start.isEnabled = !disabled && state == "stopped"
            stop.isEnabled = state != "stopped"
            refreshBrowser()
        }
    } }

    override fun attachBaseContext(newBase: android.content.Context) { super.attachBaseContext(AppLocale.wrap(newBase)) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ui = TiPlayNativeUi(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (16 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
        }
        val scroll = ScrollView(this).apply { addView(content); setBackgroundColor(ui.background); ui.protectSystemInsets(this) }
        setContentView(scroll)
        fun text(id: Int) = TextView(this).apply { setText(id); ui.emphasize(this); content.addView(this) }
        fun button(id: Int, click: () -> Unit) = Button(this).apply { setText(id); setOnClickListener { click() }; content.addView(this) }
        text(R.string.settings_airplay_title).textSize = 24f
        status = text(R.string.settings_airplay_stopped)
        text(R.string.settings_airplay_instructions)
        start = button(R.string.settings_airplay_start, ::startReceiver)
        stop = button(R.string.settings_airplay_stop) { stopService(Intent(this, AirPlayReceiverService::class.java)) }
        button(R.string.settings_airplay_wifi) { startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS)) }
        refreshBrowser = BrowserSettingsMenu.addBrowserLink(content, this) {
            requestPermissions(arrayOf(LocalNetworkPermission.PERMISSION), PERMISSIONS)
        }
        button(R.string.settings_airplay_back) { finish() }
    }

    private fun startReceiver() {
        if (AirPlayReceiverSettings.isDisabled(this)) { observer(AirPlayReceiverService.state); return }
        val permissions = mutableListOf<String>()
        if (LocalNetworkPermission.state(this) == LocalNetworkPermission.State.DENIED) permissions.add(LocalNetworkPermission.PERMISSION)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        if (permissions.isNotEmpty()) { requestPermissions(permissions.toTypedArray(), START_PERMISSIONS); return }
        startForegroundService(Intent(this, AirPlayReceiverService::class.java))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == START_PERMISSIONS && !AirPlayReceiverSettings.isDisabled(this) &&
            LocalNetworkPermission.state(this) != LocalNetworkPermission.State.DENIED) {
            // Notifications may be declined without preventing a foreground receiver.
            startForegroundService(Intent(this, AirPlayReceiverService::class.java))
        }
    }

    override fun onResume() { super.onResume(); AirPlayReceiverService.observe(observer); refreshBrowser() }
    override fun onPause() { AirPlayReceiverService.unobserve(observer); super.onPause() }
    private companion object { const val PERMISSIONS = 41; const val START_PERMISSIONS = 42 }
}
