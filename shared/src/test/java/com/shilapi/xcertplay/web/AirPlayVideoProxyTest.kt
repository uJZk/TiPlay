package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverResource
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AirPlayVideoProxyTest {
    @Test fun rewritesNestedPlaylistsSegmentsMapsAndKeysWithoutLeakingUpstreamUrls() {
        val proxy = AirPlayVideoProxy("https://example.test/path/master.m3u8", { null })
        try {
            val playlist = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio.m3u8\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n#EXTINF:1,\nclip.ts\n"
            val rewritten = proxy.rewritePlaylist("https://example.test/path/master.m3u8", playlist.toByteArray()) { "/resource?r=$it" }.toString(Charsets.UTF_8)
            assertFalse(rewritten.contains("https://example.test"))
            assertEquals(4, Regex("/resource\\?r=").findAll(rewritten).count())
            assertEquals(rewritten, proxy.rewritePlaylist("https://example.test/path/master.m3u8", playlist.toByteArray()) { "/resource?r=$it" }.toString(Charsets.UTF_8))
        } finally { proxy.close() }
    }

    @Test fun onlyTheExactIphonePeerCanBypassTheProxy() {
        val proxy = AirPlayVideoProxy("http://192.168.1.7/video.mp4", { null }, "192.168.1.7")
        try {
            assertEquals("http://192.168.1.7/video.mp4", proxy.directResource(proxy.rootId))
            assertNull(proxy.directUrl("http://192.168.1.70/video.mp4"))
            assertNull(proxy.directUrl("http://iphone.example/video.mp4"))
            assertNull(proxy.directUrl("http://user@192.168.1.7/video.mp4"))
            val playlist = "#EXTM3U\nhttp://192.168.1.7/clip.ts\nhttps://example.test/clip.ts"
            val rewritten = proxy.rewritePlaylist("http://192.168.1.7/master.m3u8", playlist.toByteArray()) { "/resource?r=$it" }.toString(Charsets.UTF_8)
            assertTrue(rewritten.contains("http://192.168.1.7/clip.ts"))
            assertFalse(rewritten.contains("https://example.test/clip.ts"))
        } finally { proxy.close() }
        assertNull(proxy.directResource(proxy.rootId))
    }

    @Test fun appBrokerResourcesSupportRangeAndRejectMalformedRanges() {
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", { ReceiverResource(byteArrayOf(0, 1, 2, 3, 4), 200, null) })
        try {
            proxy.open(proxy.rootId, "bytes=1-3") { it }!!.use {
                assertEquals(206, it.status); assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
                assertTrue(it.headers.contains("Content-Range" to "bytes 1-3/5"))
            }
            proxy.open(proxy.rootId, "bytes=-2") { it }!!.use { assertArrayEquals(byteArrayOf(3, 4), it.body.readBytes()) }
            for (range in listOf("bytes=9-", "bytes=4-2", "bytes=0-1,3-4", "garbage"))
                proxy.open(proxy.rootId, range) { it }!!.use { assertEquals(416, it.status) }
            assertNull(proxy.open("unknown", null) { it })
        } finally { proxy.close() }
        assertNull(proxy.open(proxy.rootId, null) { it })
    }

    @Test fun appRedirectToIphoneDoesNotFetchOrProxyTheIphoneBody() {
        var requests = 0
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", {
            requests++; ReceiverResource(null, 302, "http://192.168.1.7/movie.mp4")
        }, "192.168.1.7")
        try {
            proxy.open(proxy.rootId, null) { it }!!.use {
                assertEquals(307, it.status)
                assertTrue(it.headers.contains("Location" to "http://192.168.1.7/movie.mp4"))
            }
            assertEquals(1, requests)
        } finally { proxy.close() }
    }

    @Test fun refusesUnsupportedSchemesAndRedirects() {
        for (url in listOf("file:///video", "skd://drm", "http://user:pass@example.test/video"))
            assertThrows(IOException::class.java) { AirPlayVideoProxy(url, { null }) }
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", { ReceiverResource(null, 302, "file:///video") })
        try { assertThrows(IOException::class.java) { proxy.open(proxy.rootId, null) { it } } }
        finally { proxy.close() }
    }
}
