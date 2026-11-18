package com.shilapi.xcertplay.receiver

import java.security.MessageDigest
import java.util.Locale

/** Sender-reported identifiers support remembered consent; they do not authenticate the sender. */
object ReceiverSenderIdentity {
    private val uuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
    private val mac48 = Regex("(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}")

    enum class Source(val diagnosticName: String) {
        CLIENT_ID("x-apple-client-id"),
        SETUP_DEVICE_ID("setup-device-id"),
    }

    class Claim internal constructor(val source: Source, private val bytes: ByteArray) {
        val identity: ByteArray get() = bytes.copyOf()
    }

    @JvmOverloads
    fun identity(headers: Map<String, String>, setup: Map<*, *>? = null): ByteArray? = claim(headers, setup)?.identity

    /** An explicit but invalid Client-ID must not silently fall back to a different claim. */
    fun claim(headers: Map<String, String>, setup: Map<*, *>? = null): Claim? {
        val entries = headers.entries.filter { it.key.equals("x-apple-client-id", ignoreCase = true) }
        if (entries.isNotEmpty()) {
            val values = entries.map { canonicalUuid(it.value) ?: return null }.distinct()
            if (values.size != 1) return null
            return Claim(Source.CLIENT_ID, digest(Source.CLIENT_ID, values.single()))
        }
        // AirPlay's first SETUP carries the sender's deviceID, independently of its
        // interface macAddress and per-cast session UUIDs. Only that exact plist key
        // supplies this fallback. Conflicting case variants are ambiguous.
        val deviceEntries = setup?.entries?.filter {
            (it.key as? String)?.equals("deviceID", ignoreCase = true) == true
        } ?: return null
        if (deviceEntries.size != 1 || deviceEntries.single().key != "deviceID") return null
        val value = canonicalDeviceId(deviceEntries.single().value as? String ?: return null) ?: return null
        return Claim(Source.SETUP_DEVICE_ID, digest(Source.SETUP_DEVICE_ID, value))
    }

    private fun digest(source: Source, value: String): ByteArray = MessageDigest.getInstance("SHA-256")
        .digest("tiplay-airplay-sender:${source.diagnosticName}:$value".toByteArray(Charsets.UTF_8))

    private fun canonicalUuid(value: String): String? {
        val text = value.trim()
        if (!uuid.matches(text)) return null
        val normalized = text.lowercase(Locale.ROOT)
        val hex = normalized.replace("-", "")
        if (hex.all { it == '0' } || hex.all { it == 'f' }) return null
        return normalized
    }

    private fun canonicalDeviceId(value: String): String? {
        val text = value.trim()
        if (!mac48.matches(text)) return null
        val normalized = text.lowercase(Locale.ROOT)
        if (normalized in setOf("00:00:00:00:00:00", "02:00:00:00:00:00", "ff:ff:ff:ff:ff:ff")) return null
        if ((normalized.substring(0, 2).toInt(16) and 1) != 0) return null
        return normalized
    }
}
