package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.network.HotspotExtraAddress
import com.shilapi.xcertplay.web.BrowserLinkServer
import java.net.Inet4Address

/** The editable address row shares a port with the browser listener and its links. */
internal object BrowserEndpointSettings {
    data class Endpoint(val address: Inet4Address, val port: Int)

    private const val PREFS = "tiplay_browser_link"
    private const val KEY_PORT = "listen_port"

    fun port(context: Context): Int = context.getSharedPreferences(PREFS, 0)
        .getInt(KEY_PORT, BrowserLinkServer.DEFAULT_PORT).takeIf { it in 1..65535 }
        ?: BrowserLinkServer.DEFAULT_PORT

    fun savePort(context: Context, port: Int): Boolean {
        require(port in 1..65535)
        if (port == port(context)) return false
        context.getSharedPreferences(PREFS, 0).edit().putInt(KEY_PORT, port).apply()
        return true
    }

    fun parse(text: String, defaultPort: Int): Endpoint? {
        val parts = text.trim().split(':')
        if (parts.size !in 1..2) return null
        val address = HotspotExtraAddress.parse(parts[0]) ?: return null
        val port = if (parts.size == 1) defaultPort else {
            val value = parts[1]
            if (value.isEmpty() || value.any { it !in '0'..'9' }) return null
            value.toIntOrNull() ?: return null
        }
        return Endpoint(address, port).takeIf { port in 1..65535 }
    }
}
