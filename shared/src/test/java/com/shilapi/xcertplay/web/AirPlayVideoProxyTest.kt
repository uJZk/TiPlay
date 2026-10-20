package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverResource
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.ServerSocket
import java.net.ProxySelector
import java.net.Proxy
import java.net.URI
import java.net.InetSocketAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class AirPlayVideoProxyTest {
    @Test fun aFailedBrokerOpenStillReportsItsNumericLoadAndOriginalCause() {
        val original = java.net.SocketTimeoutException("https://private.test/media?token=secret")
        val proxy = AirPlayVideoProxy("mlhls://app/video", { _, _ -> throw original })
        try {
            val error = runCatching { proxy.open(proxy.rootId, null) { it } }.exceptionOrNull()
            assertTrue(error is AirPlayVideoProxy.Failure)
            assertEquals(1L, (error as AirPlayVideoProxy.Failure).load)
            assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, error.route)
            assertSame(original, error.cause)
        } finally { proxy.close() }
    }
    private val appPlaylist = "#EXTM3U\n#EXT-X-MAP:URI=\"minibili://app/init.mp4\"\n#EXTINF:1,\nminibili://app/segment.m4s\n"
    private fun assertWholeRewrittenPlaylist(resource: AirPlayVideoProxy.Resource) {
        assertEquals(200, resource.status)
        assertEquals("application/vnd.apple.mpegurl", resource.type)
        assertFalse(resource.headers.any { it.first.equals("Content-Range", true) })
        val body = resource.body.readBytes().toString(Charsets.UTF_8)
        assertTrue(body.startsWith("#EXTM3U\n"))
        assertFalse(body.contains("minibili:"))
        assertEquals(2, Regex("/resource\\?r=").findAll(body).count())
    }

    @Test fun fcupWholePlaylistsIgnoreBrowserRangesAndRewriteAppUrlsBeforeReturning200() {
        for (status in listOf(0, 200)) for (range in listOf("bytes=0-", "bytes=0-15")) {
            val proxy = AirPlayVideoProxy("minibili://app/root", { url, requested ->
                assertEquals("minibili://app/root", url)
                assertEquals(range, requested)
                ReceiverResource(appPlaylist.toByteArray(), status, null)
            })
            try {
                proxy.open(proxy.rootId, range) { "/resource?r=$it" }!!.use {
                    assertEquals(1L, it.reference!!.load)
                    assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, it.reference!!.route)
                    assertNull(it.reference!!.headersMillis)
                    assertTrue(it.reference!!.responseMillis!! >= 0)
                    assertWholeRewrittenPlaylist(it)
                }
            } finally { proxy.close() }
        }
    }

    @Test fun androidWholePlaylistsIgnoreBrowserRangesAndRewriteAppUrlsBeforeReturning200() {
        for (range in listOf("bytes=0-", "bytes=0-15")) {
            withOrigin(200, mapOf("Content-Type" to "application/octet-stream"), appPlaylist.toByteArray()) { origin, request ->
                val proxy = AirPlayVideoProxy("$origin/playlist", { _, _ -> null })
                try {
                    proxy.open(proxy.rootId, range) { "/resource?r=$it" }!!.use {
                        assertEquals(1L, it.reference!!.load)
                        assertEquals(AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, it.reference!!.route)
                        assertTrue(it.reference!!.headersMillis!! >= 0)
                        assertEquals(it.reference!!.headersMillis, it.reference!!.responseMillis)
                        assertWholeRewrittenPlaylist(it)
                    }
                    assertTrue(request.get(2, TimeUnit.SECONDS).contains("Range: $range\r\n", true))
                } finally { proxy.close() }
            }
        }
    }

    @Test fun boundedFcUpProbesCanReadLargeMp4WithoutRequestingTheWholeRepresentation() {
        val bytes = ByteArray(65536) { 42 }
        val proxy = AirPlayVideoProxy("minibili://app/large.mp4", { _, range ->
            assertEquals("bytes=0-65535", range)
            ReceiverResource(bytes, 206, null, mapOf("Content-Range" to "bytes 0-65535/67108864",
                "Content-Length" to "65536", "Content-Type" to "video/mp4"))
        })
        try {
            proxy.open(proxy.rootId, "bytes=0-65535") { it }!!.use {
                assertEquals(206, it.status)
                assertArrayEquals(bytes, it.body.readBytes())
            }
        } finally { proxy.close() }
    }

    @Test fun completeFcUpPartialPlaylistsAreRewrittenAsWhole200Representations() {
        val bytes = appPlaylist.toByteArray()
        val proxy = AirPlayVideoProxy("minibili://app/root", { _, range ->
            assertEquals("bytes=0-65535", range)
            ReceiverResource(bytes, 206, null, mapOf("Content-Range" to "bytes 0-${bytes.lastIndex}/${bytes.size}",
                "Content-Length" to bytes.size.toString()))
        })
        try {
            proxy.open(proxy.rootId, "bytes=0-65535") { "/resource?r=$it" }!!.use(::assertWholeRewrittenPlaylist)
        } finally { proxy.close() }
    }

    @Test fun incompleteFcUpPlaylistProbesFetchTheWholeManifestBeforeRewriting() {
        val bytes = appPlaylist.toByteArray()
        val ranges = mutableListOf<String?>()
        val proxy = AirPlayVideoProxy("minibili://app/root", { _, range ->
            ranges += range
            if (range != null) ReceiverResource(bytes.copyOf(16), 206, null,
                mapOf("Content-Range" to "bytes 0-15/${bytes.size}", "Content-Length" to "16"))
            else ReceiverResource(bytes, 200, null)
        })
        try {
            proxy.open(proxy.rootId, "bytes=0-15") { "/resource?r=$it" }!!.use(::assertWholeRewrittenPlaylist)
            assertEquals(listOf("bytes=0-15", null), ranges)
        } finally { proxy.close() }
    }

    @Test fun completeAndroidPartialPlaylistsAreRewrittenAsWhole200Representations() {
        val bytes = appPlaylist.toByteArray()
        withOrigin(206, mapOf("Content-Range" to "bytes 0-${bytes.lastIndex}/${bytes.size}"), bytes) { origin, _ ->
            val proxy = AirPlayVideoProxy("$origin/playlist", { _, _ -> error("FCUP fallback was not needed") })
            try {
                proxy.open(proxy.rootId, "bytes=0-65535") { "/resource?r=$it" }!!.use(::assertWholeRewrittenPlaylist)
            } finally { proxy.close() }
        }
    }

    /** A real local HTTP exchange exercises Android-route headers without external media requests. */
    private fun withOrigin(status: Int, headers: Map<String, String>, body: ByteArray,
                           test: (String, CompletableFuture<String>) -> Unit) {
        ServerSocket(0).use { server ->
            val request = CompletableFuture<String>()
            val worker = Thread {
                try {
                    server.accept().use { socket ->
                        socket.soTimeout = 2000
                        val input = socket.getInputStream()
                        val head = java.io.ByteArrayOutputStream()
                        var end = 0
                        while (end != 0x0d0a0d0a) {
                            val value = input.read()
                            if (value < 0) throw IOException("Incomplete local request")
                            head.write(value); end = (end shl 8) or value
                            check(head.size() <= 16384)
                        }
                        request.complete(head.toString("ISO-8859-1"))
                        val response = "HTTP/1.1 $status Test\r\nContent-Length: ${body.size}\r\nConnection: close\r\n" +
                            headers.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n"
                        socket.getOutputStream().write(response.toByteArray(Charsets.ISO_8859_1))
                        socket.getOutputStream().write(body)
                    }
                } catch (error: Exception) { request.completeExceptionally(error) }
            }.apply { isDaemon = true; start() }
            try { test("http://127.0.0.1:${server.localPort}", request) }
            finally { server.close(); worker.join(3000); assertFalse(worker.isAlive) }
        }
    }

    /** Resolve virtual media hosts through local HTTP proxies, without DNS or a production test hook. */
    private fun withLocalOrigins(origins: Map<String, String>, test: () -> Unit) {
        val previous = ProxySelector.getDefault()
        ProxySelector.setDefault(object : ProxySelector() {
            override fun select(uri: URI): List<Proxy> = listOf(Proxy(Proxy.Type.HTTP,
                InetSocketAddress("127.0.0.1", URI(origins.getValue(uri.host)).port)))
            override fun connectFailed(uri: URI, address: java.net.SocketAddress, error: IOException) = throw error
        })
        try { test() } finally { ProxySelector.setDefault(previous) }
    }

    @Test fun androidCdnRequestReceivesBothRequiredHeadersWithoutChangingSignedUrlOrRange() {
        val cdn = "upos-sz-estgoss.bilivideo.com"
        for (host in listOf(cdn, "example.test", "bilivideo.com.example.test")) {
            withOrigin(206, mapOf("Content-Range" to "bytes 3058-3060/4000"), byteArrayOf(1, 2, 3)) { origin, request ->
                withLocalOrigins(mapOf(host to origin)) {
                    val signed = "http://$host/video.m4s?nbs=1&upsig=fake%2fSignature&uparams=nbs"
                    val proxy = AirPlayVideoProxy(signed, { _, _ -> error("Local HTTP request should succeed") })
                    try {
                        proxy.open(proxy.rootId, "bytes=3058-3060") { it }!!.use {
                            assertEquals(206, it.status)
                            assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
                        }
                        val sent = request.get(2, TimeUnit.SECONDS)
                        assertTrue(sent.startsWith("GET $signed HTTP/1.1\r\n"))
                        assertTrue(sent.contains("Range: bytes=3058-3060\r\n", true))
                        assertEquals(host == cdn, sent.contains("Referer: https://www.bilibili.com/\r\n", true))
                        assertEquals(host == cdn, sent.contains("Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0"))
                    } finally { proxy.close() }
                }
            }
        }
    }

    @Test fun androidRedirectsRecomputeCdnHeadersForTheDestinationInBothDirections() {
        val cdn = "upos-sz-estgoss.bilivideo.com"
        for ((from, to) in listOf(cdn to "example.test", "example.test" to cdn)) {
            val signed = "http://$to/video.m4s?nbs=1&upsig=fake%2fSignature&uparams=nbs"
            withOrigin(206, mapOf("Content-Range" to "bytes 3058-3060/4000"), byteArrayOf(1, 2, 3)) { target, targetRequest ->
                withOrigin(302, mapOf("Location" to signed), byteArrayOf()) { origin, originRequest ->
                    withLocalOrigins(mapOf(from to origin, to to target)) {
                        val proxy = AirPlayVideoProxy("http://$from/start", { _, _ -> error("Redirect should remain on local HTTP") })
                        try {
                            proxy.open(proxy.rootId, "bytes=3058-3060") { it }!!.use { assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes()) }
                            for ((host, request) in listOf(from to originRequest, to to targetRequest)) {
                                val sent = request.get(2, TimeUnit.SECONDS)
                                assertEquals(host == cdn, sent.contains("Referer: https://www.bilibili.com/\r\n", true))
                                assertEquals(host == cdn, sent.contains("Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0"))
                                assertTrue(sent.contains("Range: bytes=3058-3060\r\n", true))
                            }
                            assertTrue(targetRequest.get().startsWith("GET $signed HTTP/1.1\r\n"))
                        } finally { proxy.close() }
                    }
                }
            }
        }
    }

    @Test fun fcupPartialResponsesKeepAbsoluteOffsetsAndAreNeverSlicedTwice() {
        val seen = mutableListOf<String?>()
        val signed = "minibili://app/video.m4s?nbs=1&upsig=fake%2fSignature&uparams=nbs"
        val bytes = byteArrayOf(7, 8, 9)
        var total = "1526"
        val proxy = AirPlayVideoProxy(signed, { url, range ->
            assertEquals(signed, url); seen += range
            ReceiverResource(bytes, 206, null, mapOf("content-range" to "bytes 1523-1525/$total",
                "Content-Length" to "3", "Content-Type" to "video/mp4", "Set-Cookie" to "secret"))
        })
        try {
            val ranges = listOf("bytes=1523-1525", "bytes=1523-", "bytes=-3")
            for (representationLength in listOf("1526", "*")) {
                total = representationLength
                for (range in ranges) proxy.open(proxy.rootId, range) { it }!!.use {
                assertEquals(206, it.status)
                assertArrayEquals(bytes, it.body.readBytes())
                assertEquals("video/mp4", it.type)
                assertTrue(it.headers.contains("Content-Range" to "bytes 1523-1525/$total"))
                assertTrue(it.headers.contains("Content-Length" to "3"))
                assertFalse(it.headers.any { header -> header.first.equals("Set-Cookie", true) })
            }
            }
            assertEquals(ranges + ranges, seen)
        } finally { proxy.close() }
    }

    @Test fun senderIgnoringRangeWith200OrAppSuccessIsRangedLocallyOnce() {
        for (status in listOf(200, 0)) {
            var received: String? = null
            val proxy = AirPlayVideoProxy("minibili://app/video", { _, range ->
                received = range
                ReceiverResource(byteArrayOf(0, 1, 2, 3, 4), status, null)
            })
            try {
                proxy.open(proxy.rootId, "bytes=1-3") { it }!!.use {
                    assertEquals(206, it.status)
                    assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
                    assertTrue(it.headers.contains("Content-Range" to "bytes 1-3/5"))
                }
                assertEquals("bytes=1-3", received)
            } finally { proxy.close() }
        }
    }

    @Test fun rejectsMissingMalformedOrMismatchedFcUpPartialMetadata() {
        val invalidHeaders = listOf(emptyMap(), mapOf("Content-Range" to "bytes 0-2/2000"),
            mapOf("Content-Range" to "bytes 1523-1525/1525"), mapOf("Content-Range" to "bytes 1523-1526/2000"),
            mapOf("Content-Range" to "bytes 1523-1525/2000", "Content-Length" to "4"),
            mapOf("Content-Range" to "bytes 1523-1525/2000\r\nCookie: secret"),
            mapOf("Content-Range" to "bytes 1523-1525/2000", "content-range" to "bytes 0-2/2000"))
        for (headers in invalidHeaders) {
            val proxy = AirPlayVideoProxy("minibili://app/video", { _, _ -> ReceiverResource(byteArrayOf(1, 2, 3), 206, null, headers) })
            try {
                val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) {
                    proxy.open(proxy.rootId, "bytes=1523-1525") { it }
                }
                assertEquals(AirPlayVideoProxy.FailureReason.INVALID_RANGE_RESPONSE, failure.reason)
                assertEquals(206, failure.status)
                assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, failure.route)
            } finally { proxy.close() }
        }
    }

    @Test fun fcupUnsatisfiedRangeKeeps416AndContentRangeWithoutAnErrorBody() {
        val proxy = AirPlayVideoProxy("minibili://app/video", { _, _ ->
            ReceiverResource("private upstream error".toByteArray(), 416, null, mapOf("Content-Range" to "bytes */5"))
        })
        try {
            proxy.open(proxy.rootId, "bytes=9-") { it }!!.use {
                assertEquals(416, it.status)
                assertTrue(it.headers.contains("Content-Range" to "bytes */5"))
                assertArrayEquals(byteArrayOf(), it.body.readBytes())
            }
        } finally { proxy.close() }
    }

    @Test fun redirectsKeepSignedUrlsAndRangeWhileErrorLocationCannotOverrideA403() {
        val source = "minibili://app/source?nbs=1&upsig=fake%2fSource&uparams=nbs"
        val destination = "minibili://other/video?nbs=1&upsig=fake%2FRedirect&uparams=nbs"
        val seen = mutableListOf<String>()
        val proxy = AirPlayVideoProxy(source, { url, range ->
            seen += url
            assertEquals("bytes=100-102", range)
            if (url == source) ReceiverResource(null, 302, destination)
            else ReceiverResource(byteArrayOf(1, 2, 3), 206, null, mapOf("Content-Range" to "bytes 100-102/200"))
        })
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }!!.use { assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes()) }
            assertEquals(listOf(source, destination), seen)
        } finally { proxy.close() }
        var requests = 0
        val refused = AirPlayVideoProxy(source, { _, _ -> requests++; ReceiverResource(byteArrayOf(), 403, destination) })
        try {
            val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) { refused.open(refused.rootId, null) { it } }
            assertEquals(AirPlayVideoProxy.FailureReason.UPSTREAM_FORBIDDEN, failure.reason)
            assertEquals("media-upstream-forbidden", failure.error)
            assertEquals(1, requests)
        } finally { refused.close() }
    }

    @Test fun androidRefusalFallsBackToFcUpWithTheExactSignedUrlAndOriginalRange() {
        withOrigin(403, mapOf("Deny-Reason" to "nbs parameter"), "Forbidden".toByteArray()) { origin, request ->
            val signed = "$origin/video.m4s?nbs=1&upsig=fake%2fSignature&uparams=nbs"
            val messages = mutableListOf<String>()
            var requests = 0
            val proxy = AirPlayVideoProxy(signed, { url, range ->
                requests++
                assertEquals(signed, url); assertEquals("bytes=100-102", range)
                ReceiverResource(byteArrayOf(1, 2, 3), 206, null, mapOf("Content-Range" to "bytes 100-102/200"))
            }, log = messages::add)
            try {
                proxy.open(proxy.rootId, "bytes=100-102") { it }!!.use {
                    assertEquals(206, it.status); assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
                }
                assertEquals(1, requests)
                val sent = request.get(2, TimeUnit.SECONDS)
                assertTrue(sent.startsWith("GET /video.m4s?nbs=1&upsig=fake%2fSignature&uparams=nbs HTTP/1.1"))
                assertTrue(sent.contains("Range: bytes=100-102\r\n", true))
                assertTrue(messages.any { it.contains("route=ANDROID_HTTP status=403 reason=upstream-forbidden") })
                assertFalse(messages.joinToString().contains("fake%2fSignature"))
            } finally { proxy.close() }
        }
    }

    @Test fun androidConnectionFailurePreservesItsSafeClassWhenFcUpCannotRecover() {
        val port = ServerSocket(0).use { it.localPort }
        val messages = mutableListOf<String>()
        val signed = "http://private.example.test/video?token=private-secret"
        withLocalOrigins(mapOf("private.example.test" to "http://127.0.0.1:$port")) {
            val proxy = AirPlayVideoProxy(signed, { _, _ -> null }, log = messages::add)
            try {
                val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, null) { it } }
                assertEquals(AirPlayVideoProxy.FailureReason.RESOURCE_IO, failure.reason)
                assertEquals(AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, failure.route)
                assertTrue(messages.any { it.contains("reason=resource-io exception=ConnectException") })
                assertFalse(messages.joinToString().contains("private.example.test"))
                assertFalse(messages.joinToString().contains("private-secret"))
            } finally { proxy.close() }
        }
    }

    @Test fun cancellationAfterAnAndroidResponseCannotFallBackToTheCurrentIphone() {
        withOrigin(403, emptyMap(), byteArrayOf()) { origin, _ ->
            var fallbackLoads = 0
            lateinit var proxy: AirPlayVideoProxy
            proxy = AirPlayVideoProxy("$origin/movie.mp4", { _, _ ->
                fallbackLoads++
                ReceiverResource(byteArrayOf(42), 200, null)
            }, log = { message ->
                // A UI replacement can close the item after HTTP completed but before its FCUP retry.
                if (message.contains("route=ANDROID_HTTP status=403")) proxy.close()
            })
            try {
                assertThrows(IOException::class.java) { proxy.open(proxy.rootId, null) { it } }
                assertEquals(0, fallbackLoads)
            } finally { proxy.close() }
        }
    }

    @Test fun androidPartialResponsePreservesContentRangeWithoutCallingFcUp() {
        withOrigin(206, mapOf("Content-Range" to "bytes 100-102/200", "Content-Type" to "video/mp4"), byteArrayOf(4, 5, 6)) { origin, _ ->
            val proxy = AirPlayVideoProxy("$origin/video.m4s", { _, _ -> error("FCUP fallback was not needed") })
            try {
                proxy.open(proxy.rootId, "bytes=100-102") { it }!!.use {
                    assertEquals(206, it.status)
                    assertArrayEquals(byteArrayOf(4, 5, 6), it.body.readBytes())
                    assertTrue(it.headers.contains("Content-Range" to "bytes 100-102/200"))
                }
            } finally { proxy.close() }
        }
    }

    @Test fun forcedProxyRewritesIphoneChildResourcesAndRefreshesEveryLiveManifestRead() {
        var requests = 0
        val proxy = AirPlayVideoProxy("http://192.168.1.7/live.m3u8", { _, _ ->
            requests++
            ReceiverResource("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\nsegment-$requests.m4s".toByteArray(), 200, null)
        }, "192.168.1.7")
        try {
            repeat(2) {
                proxy.open(proxy.rootId, null, forceProxy = true) { child -> "/resource?r=$child&proxy=1" }!!.use { resource ->
                    assertEquals(200, resource.status)
                    val manifest = resource.body.readBytes().toString(Charsets.UTF_8)
                    assertFalse(manifest.contains("192.168.1.7"))
                    assertEquals(2, Regex("proxy=1").findAll(manifest).count())
                }
            }
            assertEquals(2, requests)
        } finally { proxy.close() }
    }
    @Test fun rewritesNestedPlaylistsSegmentsMapsAndKeysWithoutLeakingUpstreamUrls() {
        val proxy = AirPlayVideoProxy("https://example.test/path/master.m3u8", { _, _ -> null })
        try {
            val playlist = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio.m3u8\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n#EXTINF:1,\nclip.ts\n"
            val rewritten = proxy.rewritePlaylist("https://example.test/path/master.m3u8", playlist.toByteArray()) { "/resource?r=$it" }.toString(Charsets.UTF_8)
            assertFalse(rewritten.contains("https://example.test"))
            assertEquals(4, Regex("/resource\\?r=").findAll(rewritten).count())
            assertEquals(rewritten, proxy.rewritePlaylist("https://example.test/path/master.m3u8", playlist.toByteArray()) { "/resource?r=$it" }.toString(Charsets.UTF_8))
        } finally { proxy.close() }
    }

    @Test fun onlyTheExactIphonePeerCanBypassTheProxy() {
        val proxy = AirPlayVideoProxy("http://192.168.1.7/video.mp4", { _, _ -> null }, "192.168.1.7")
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

    @Test fun debugModeProxiesPeerUrlsPlaylistsAndRedirectsAndSwitchesBackImmediately() {
        val directory = java.nio.file.Files.createTempDirectory("proxy-debug").toFile()
        val capture = java.io.File(directory, "raw.tsv")
        var requests = 0
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", { url, _ ->
            requests++
            if (url.startsWith("mlhls:")) ReceiverResource(null, 302, "http://192.168.1.7/movie.mp4")
            else ReceiverResource(byteArrayOf(1, 2, 3), 200, null)
        }, "192.168.1.7")
        try {
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, true)
            assertNull(proxy.directUrl("http://192.168.1.7/movie.mp4"))
            val playlist = proxy.rewritePlaylist("http://192.168.1.7/live.m3u8",
                "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\nsegment.ts".toByteArray()) { "/resource?r=$it" }.toString(Charsets.UTF_8)
            assertFalse(playlist.contains("192.168.1.7"))
            assertEquals(2, Regex("/resource\\?r=").findAll(playlist).count())
            proxy.open(proxy.rootId, null) { it }!!.use {
                assertEquals(200, it.status)
                assertFalse(it.headers.any { header -> header.first == "Location" })
                assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
            }
            assertEquals(2, requests)
            com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, false)
            assertEquals("http://192.168.1.7/movie.mp4", proxy.directUrl("http://192.168.1.7/movie.mp4"))
            proxy.open(proxy.rootId, null) { it }!!.use { assertEquals(307, it.status) }
        } finally { com.shilapi.xcertplay.diagnostics.RawTraffic.configure(capture, false); proxy.close(); directory.deleteRecursively() }
    }

    @Test fun appBrokerResourcesSupportRangeAndRejectMalformedRanges() {
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", { _, _ -> ReceiverResource(byteArrayOf(0, 1, 2, 3, 4), 200, null) })
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
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", { _, _ ->
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
            assertThrows(IOException::class.java) { AirPlayVideoProxy(url, { _, _ -> null }) }
        val proxy = AirPlayVideoProxy("mlhls://localhost/movie", { _, _ -> ReceiverResource(null, 302, "file:///video") })
        try { assertThrows(IOException::class.java) { proxy.open(proxy.rootId, null) { it } } }
        finally { proxy.close() }
    }
}
