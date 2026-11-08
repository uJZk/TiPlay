package com.shilapi.xcertplay.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserRtcAudioCandidatesTest {
    @Test fun reportsCandidateShapeWithoutAddressOrCredentials() {
        val offer = """
            a=ice-pwd:secret-password
            a=candidate:1 1 udp 100 192.168.25.3 1234 typ host
            a=candidate:2 1 udp 100 browser.local 1235 typ host
            a=candidate:3 1 tcp 100 192.168.25.4 9 typ host
        """.trimIndent()
        val answer = "a=candidate:4 1 UDP 100 192.168.25.8 2345 typ host\r\na=candidate:5 1 udp 100 2001:db8::1 2345 typ host"
        val result = BrowserRtcAudioCandidates.describe(offer, answer)
        assertTrue(result.contains("offerHostUdp=2 offerIpv4=1 offerIpv6=0 offerMdns=1"))
        assertTrue(result.contains("answerHostUdp=2 answerIpv4=1 answerIpv6=1 answerMdns=0"))
        assertTrue(result.contains("matchingIpv4Prefix24=1"))
        assertFalse(result.contains("192.168"))
        assertFalse(result.contains("secret-password"))
        assertFalse(result.contains("browser.local"))
    }
}
