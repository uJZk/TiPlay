package com.shilapi.xcertplay.receiver

import java.security.MessageDigest
import java.util.Locale

/** A sender-reported UUID is a convenience identifier, not authenticated identity. */
object ReceiverSenderIdentity {
    private val uuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

    fun identity(headers: Map<String, String>): ByteArray? {
        val entries = headers.entries.filter { it.key.equals("x-apple-client-id", ignoreCase = true) }
        if (entries.isEmpty()) return null
        val values = entries.map { canonical(it.value) ?: return null }.distinct()
        if (values.size != 1) return null
        return MessageDigest.getInstance("SHA-256")
            .digest("tiplay-airplay-sender:x-apple-client-id:${values.single()}".toByteArray(Charsets.UTF_8))
    }

    private fun canonical(value: String): String? {
        val text = value.trim()
        if (!uuid.matches(text)) return null
        val normalized = text.lowercase(Locale.ROOT)
        val hex = normalized.replace("-", "")
        if (hex.all { it == '0' } || hex.all { it == 'f' }) return null
        return normalized
    }
}
