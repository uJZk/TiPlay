package com.shilapi.xcertplay.receiver

import java.util.Base64

/** Classic AirPlay's SDP and UDP transport negotiation; it never selects an address from SDP.
 * Protocol comparison: Shairport Sync rtsp.c, b991d91350e537c1f50dac98d9a3c836eceddcfc.
 */
internal object ReceiverRaop {
    class UnsupportedEncryption : IllegalArgumentException("unsupported RAOP encryption")

    data class Announcement(
        val format: ReceiverMirrorAudioFormat,
        val encryptedKey: ByteArray? = null,
        val iv: ByteArray? = null,
    ) {
        fun stream(controlPort: Int): Map<String, Any> = mapOf(
            "type" to 96, "ct" to format.codec, "sr" to format.sampleRate,
            "ch" to format.channels, "spf" to format.samplesPerFrame,
            "ss" to format.bitDepth, "controlPort" to controlPort,
        )
    }

    data class Transport(val controlPort: Int, val timingPort: Int) {
        fun response(dataPort: Int, controlPort: Int, timingPort: Int): String {
            require(listOf(dataPort, controlPort, timingPort).all { it in 1..65535 })
            return "RTP/AVP/UDP;unicast;mode=record;control_port=$controlPort;" +
                "timing_port=$timingPort;server_port=$dataPort"
        }
    }

    fun announce(body: ByteArray): Announcement {
        require(body.size in 1..16_384 && body.all { it == 9.toByte() || it == 10.toByte() ||
            it == 13.toByte() || it.toInt() in 32..126 }) { "invalid SDP" }
        val lines = body.toString(Charsets.US_ASCII).lineSequence().map { it.trim() }
            .filter { it.isNotEmpty() }.toList()
        require(lines.filter { it.startsWith("v=") } == listOf("v=0"))
        require(lines.filter { it.startsWith("m=") }.singleOrNull()?.let {
            Regex("m=audio ([0-9]{1,5}) RTP/AVP 96").matchEntire(it)?.groupValues?.get(1)
                ?.toIntOrNull()?.let { port -> port in 0..65535 } == true
        } == true) { "unsupported SDP media" }
        fun attribute(name: String): String? {
            val values = lines.filter { it.startsWith("a=$name:") }
            require(values.size <= 1) { "duplicate SDP attribute" }
            return values.singleOrNull()?.substringAfter(':')?.trim()
        }
        val mapping = requireNotNull(attribute("rtpmap")).split(Regex("\\s+"))
        require(mapping.size == 2 && mapping[0] == "96") { "unsupported SDP payload" }
        val codec = mapping[1].split('/')
        val format = when (codec.first()) {
            "AppleLossless" -> {
                require(codec.size == 1 || codec.size == 3)
                val fields = requireNotNull(attribute("fmtp")).split(Regex("\\s+"))
                    .map { requireNotNull(it.toIntOrNull()) }
                require(fields.size == 12 && fields[0] == 96) { "invalid ALAC format" }
                // The shared decoder cookie has these fixed values. Do not accept a format
                // whose parameters would be silently changed before it reaches the decoder.
                require(fields[2] == 0 && fields[4] == 40 && fields[5] == 10 && fields[6] == 14 &&
                    fields[8] == 255 && fields[9] == 0 && fields[10] == 0) { "unsupported ALAC cookie" }
                if (codec.size == 3) require(codec[1].toIntOrNull() == fields[11] && codec[2].toIntOrNull() == fields[7])
                ReceiverMirrorAudioFormat(2, fields[11], fields[7], fields[1], fields[3])
            }
            "L16", "L24" -> {
                require(codec.size == 3 && attribute("fmtp") == null) { "invalid PCM format" }
                ReceiverMirrorAudioFormat(1, requireNotNull(codec[1].toIntOrNull()),
                    requireNotNull(codec[2].toIntOrNull()), bitDepth = if (codec[0] == "L24") 24 else 16)
            }
            else -> throw IllegalArgumentException("unsupported SDP codec")
        }
        require(ReceiverMirrorAudioFormat.parse(mapOf("ct" to format.codec, "sr" to format.sampleRate,
            "ch" to format.channels, "spf" to format.samplesPerFrame, "ss" to format.bitDepth)) == format) {
            "unsupported SDP audio format"
        }
        // The AirTunes RSA credential is not part of this receiver's identity. Reject it
        // explicitly rather than treating RSA ciphertext as a FairPlay transport key.
        if (attribute("rsaaeskey") != null) throw UnsupportedEncryption()
        val encrypted = attribute("fpaeskey")?.let { base64(it).also { key -> require(key.size in 16..256) } }
        val iv = attribute("aesiv")?.let { base64(it).also { value -> require(value.size == 16) } }
        require((encrypted == null) == (iv == null)) { "incomplete SDP encryption" }
        return Announcement(format, encrypted, iv)
    }

    fun transport(value: String): Transport {
        require(value.length in 1..1024 && value.none { it.isISOControl() })
        val fields = value.split(';').map { it.trim() }
        require(fields.first().equals("RTP/AVP/UDP", true)) { "unsupported RAOP transport" }
        val parameters = linkedMapOf<String, String?>()
        for (field in fields.drop(1)) {
            require(field.isNotEmpty())
            val name = field.substringBefore('=').lowercase()
            require(name in listOf("unicast", "mode", "control_port", "timing_port", "interleaved") &&
                !parameters.containsKey(name)) { "unsupported or duplicate transport parameter" }
            parameters[name] = if ('=' in field) field.substringAfter('=').trim() else null
        }
        require(parameters.containsKey("unicast") && parameters["unicast"] == null)
        require(parameters["mode"]?.removeSurrounding("\"")?.equals("record", true) == true)
        if (parameters.containsKey("interleaved")) require(parameters["interleaved"] == "0-1")
        fun port(name: String): Int = requireNotNull(parameters[name]?.takeIf { it.matches(Regex("[0-9]{1,5}")) }
            ?.toIntOrNull()?.takeIf { it in 1..65535 }) { "invalid RAOP port" }
        return Transport(port("control_port"), port("timing_port"))
    }

    private fun base64(value: String): ByteArray {
        require(value.length in 1..344 && value.matches(Regex("[A-Za-z0-9+/]+={0,2}"))) { "invalid SDP key" }
        return Base64.getDecoder().decode(value)
    }
}
