package com.shilapi.xcertplay.web

/** Summarizes SDP candidates without retaining or logging addresses, ports or credentials. */
internal object BrowserRtcAudioCandidates {
    private data class Summary(val hosts: Int, val ipv4: Int, val ipv6: Int, val mdns: Int, val prefixes: Set<String>)

    fun describe(offer: String, answer: String): String {
        val remote = summarize(offer)
        val local = summarize(answer)
        return "offerHostUdp=${remote.hosts} offerIpv4=${remote.ipv4} offerIpv6=${remote.ipv6} offerMdns=${remote.mdns} " +
            "answerHostUdp=${local.hosts} answerIpv4=${local.ipv4} answerIpv6=${local.ipv6} answerMdns=${local.mdns} " +
            "matchingIpv4Prefix24=${remote.prefixes.intersect(local.prefixes).size}"
    }

    private fun summarize(sdp: String): Summary {
        val addresses = sdp.lineSequence().filter { it.startsWith("a=candidate:") }.mapNotNull { line ->
            val parts = line.removePrefix("a=candidate:").trim().split(Regex("\\s+"))
            if (parts.size >= 8 && parts[2].equals("udp", true) && parts[6] == "typ" && parts[7] == "host") parts[4] else null
        }.toSet()
        val ipv4 = addresses.mapNotNull { address ->
            val parts = address.split('.')
            if (parts.size != 4 || parts.any { it.isEmpty() || it.any { c -> !c.isDigit() } || (it.toIntOrNull() ?: 256) > 255 }) null
            else parts.take(3).joinToString(".") { it.toInt().toString() }
        }
        return Summary(addresses.size, ipv4.size, addresses.count { ':' in it }, addresses.count { it.endsWith(".local", true) }, ipv4.toSet())
    }
}
