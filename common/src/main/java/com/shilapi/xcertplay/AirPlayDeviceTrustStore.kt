package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.receiver.ReceiverDeviceTrust
import com.shilapi.xcertplay.web.AirPlayTrustNotifications

/** Ordinary AirPlay trust is separate from browser codes and CarPlay pairing records. */
class AirPlayDeviceTrustStore(context: Context) : ReceiverDeviceTrust.Store {
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun contains(fingerprint: String): Boolean = synchronized(LOCK) {
        valid(fingerprint) && preferences.getStringSet(KEY, emptySet()).orEmpty().contains(fingerprint)
    }

    override fun remember(fingerprint: String) = synchronized(LOCK) {
        require(valid(fingerprint))
        val keys = preferences.getStringSet(KEY, emptySet()).orEmpty().filter(::valid).toMutableSet()
        keys.add(fingerprint)
        // Limit storage even when many devices are approved over the lifetime of the app.
        while (keys.size > MAX_DEVICES) keys.remove(keys.first { it != fingerprint })
        check(preferences.edit().putStringSet(KEY, keys).commit()) { "Cannot persist AirPlay trust" }
    }

    override fun forgetAll() = synchronized(LOCK) {
        check(preferences.edit().remove(KEY).commit()) { "Cannot clear AirPlay trust" }
    }

    companion object {
        private const val PREFERENCES = "tiplay_airplay_trust"
        private const val KEY = "verified_key_fingerprints"
        private const val MAX_DEVICES = 256
        private val LOCK = Any()
        private fun valid(value: String) = value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }

        fun forgetAll(context: Context) {
            // Cancel pending approvals first, including a delayed Allow from an old notification.
            AirPlayTrustNotifications.forgetAll()
            AirPlayDeviceTrustStore(context).forgetAll()
        }
    }
}
