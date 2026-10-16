package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverResourceHeadersTest {
    @Test fun onlyBilibiliHttpHostsReceiveTheRequiredRefererAndBrowserAgentTogether() {
        val expected = mapOf("Referer" to "https://www.bilibili.com/", "User-Agent" to
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0")
        for (url in listOf("https://bilivideo.com/video", "http://upos-sz-estgoss.bilivideo.com/video",
            "HTTPS://UPOS-SZ-ESTGOSS.BILIVIDEO.COM/video?upsig=fake%2fSignature&uparams=nbs&nbs=1")) {
            assertEquals(expected, ReceiverResourceHeaders.forUrl(url))
        }
        for (url in listOf("https://example.test/video", "https://notbilivideo.com/video",
            "https://bilivideo.com.example.test/video", "https://bilivideo.com@evil.test/video",
            "https://example.test/bilivideo.com/video", "minibili://bilivideo.com/video", "file://bilivideo.com/video")) {
            assertTrue(url, ReceiverResourceHeaders.forUrl(url).isEmpty())
        }
    }
}
