package com.shilapi.xcertplay.receiver

import java.security.MessageDigest
import java.util.Locale

/** A stable sender claim for consent. Header identities do not establish cryptographic verification. */
object ReceiverSenderIdentity {
    private val identityHeaders = listOf("x-apple-device-id", "client-instance", "dacp-id")
    internal data class Claim(val value: ByteArray, val source: String)

    /** Never use display names, network addresses or session IDs as a persistent device identity. */
    fun identity(publicKey: ByteArray?, headers: Map<String, String>): ByteArray? {
        publicKey?.takeIf { it.size == 32 }?.let { return it.copyOf() }
        return claim(headers)?.value
    }

    internal fun claim(headers: Map<String, String>): Claim? {
        for (header in identityHeaders) {
            val values = headers.entries.filter { it.key.equals(header, ignoreCase = true) }
                .mapNotNull { canonical(it.value, header == "x-apple-device-id") }.distinct()
            if (values.size != 1) continue
            return Claim(MessageDigest.getInstance("SHA-256")
                .digest("tiplay-airplay-sender:$header:${values.single()}".toByteArray(Charsets.UTF_8)), header)
        }
        return null
    }

    private fun canonical(value: String, allowOpaqueDeviceId: Boolean): String? {
        val trimmed = value.trim().takeIf { it.length in 12..128 } ?: return null
        val hex = trimmed.removePrefix("0x").removePrefix("0X")
            .replace(":", "").replace("-", "").lowercase(Locale.ROOT)
        if (hex.length in setOf(12, 16, 32, 64) && hex.all { it in '0'..'9' || it in 'a'..'f' }) {
            if (hex.all { it == '0' } || hex.all { it == 'f' }) return null
            return hex
        }
        // A device ID can also be an opaque sender claim; retain case and constrain it
        // separately from the historical normalized hexadecimal identity format.
        if (!allowOpaqueDeviceId || trimmed.length !in 12..64 ||
            trimmed.any { it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9' } ||
            trimmed.all { it == trimmed[0] }) return null
        return "opaque:$trimmed"
    }
}
