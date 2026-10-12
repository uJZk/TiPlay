package com.shilapi.xcertplay

import android.content.Context
import android.os.Handler
import android.os.Looper

/** Let the authenticated page learn its next endpoint before removing the address it is using. */
internal object BrowserEndpointChanges {
    private val handler = Handler(Looper.getMainLooper())
    @Volatile var endpoint: String? = null
        private set
    private var pending: Runnable? = null

    fun apply(context: Context, portChanged: Boolean = false) {
        pending?.let(handler::removeCallbacks)
        val app = context.applicationContext
        endpoint = "${HotspotExtraAddressSettings.address(app).hostAddress}:${BrowserEndpointSettings.port(app)}"
        val move = Runnable {
            pending = null
            HotspotExtraAddressSettings.sync(app)
            if (portChanged || TeslaBrowserLink.listeningPort(app) != BrowserEndpointSettings.port(app)) {
                TeslaBrowserLink.onPortChanged()
            }
        }
        if (TeslaBrowserLink.active) {
            pending = move
            // The page polls status every 400 ms. Keep its old endpoint for three polls.
            handler.postDelayed(move, 1200)
        } else move.run()
    }

    fun clear() {
        pending?.let(handler::removeCallbacks)
        pending = null
        endpoint = null
    }

    fun clearAnnouncement() { endpoint = null }
}
