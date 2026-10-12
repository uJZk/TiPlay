package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.network.HotspotConfigurationAccess
import com.shilapi.xcertplay.network.HotspotConfigurationReader

/** Read-only. Never enables a hotspot or logs credentials. Background reads never request a grant. */
internal object LocalHotspotSettings {
    class Credentials(val ssid: String, val password: String?) {
        override fun toString() = "Local hotspot credentials (redacted)"
    }

    fun readExplicit(context: Context): Credentials? {
        return when (HotspotExtraAddressSettings.method(context)) {
            HotspotAddressMethod.ROOT -> HotspotConfigurationReader.readRoot(context)?.let { credentials(it.ssid, it.password) }
            HotspotAddressMethod.SHIZUKU -> read(context)
            else -> null
        }
    }

    fun read(context: Context): Credentials? {
        if (HotspotExtraAddressSettings.method(context) != HotspotAddressMethod.SHIZUKU) return null
        return fromConfiguration(HotspotConfigurationAccess.read())
    }

    private fun fromConfiguration(config: Any?): Credentials? = runCatching {
        if (config == null) return@runCatching null
        val ssid = config.javaClass.getMethod("getSsid").invoke(config) as? String
        val password = runCatching { config.javaClass.getMethod("getPassphrase").invoke(config) as? String }.getOrNull()
        credentials(ssid, password)
    }.getOrNull()

    fun credentials(ssid: String?, password: String?): Credentials? {
        if (ssid.isNullOrBlank() || '\u0000' in ssid || ssid.toByteArray(Charsets.UTF_8).size > 32) return null
        val usable = password?.takeIf {
            it.length in 8..63 && !it.startsWith("<") && it.any { char -> char != '*' && char != '•' }
        }
        return Credentials(ssid, usable)
    }
}
