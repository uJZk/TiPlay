package com.shilapi.xcertplay.receiver

import java.security.MessageDigest
import java.util.Locale

/** A stable sender claim for consent. Header identities do not establish cryptographic verification. */
object ReceiverSenderIdentity {
    private val identityHeaders = listOf("x-apple-device-id", "client-instance", "dacp-id")

    /** Never use display names, network addresses or session IDs as a persistent device identity. */
    fun identity(publicKey: ByteArray?, headers: Map<String, String>): ByteArray? {
        publicKey?.takeIf { it.size == 32 }?.let { return it.copyOf() }
        for (header in identityHeaders) {
            val values = headers.entries.filter { it.key.equals(header, ignoreCase = true) }
                .mapNotNull { canonical(it.value) }.distinct()
            if (values.size != 1) continue
            return MessageDigest.getInstance("SHA-256")
                .digest("tiplay-airplay-sender:$header:${values.single()}".toByteArray(Charsets.UTF_8))
        }
        return null
    }

    private fun canonical(value: String): String? {
        val trimmed = value.trim().takeIf { it.length in 12..128 } ?: return null
        val hex = trimmed.removePrefix("0x").removePrefix("0X")
            .replace(":", "").replace("-", "").lowercase(Locale.ROOT)
        if (hex.length !in setOf(12, 16, 32, 64) || hex.any { it !in '0'..'9' && it !in 'a'..'f' }) return null
        if (hex.all { it == '0' } || hex.all { it == 'f' }) return null
        return hex
    }
}
