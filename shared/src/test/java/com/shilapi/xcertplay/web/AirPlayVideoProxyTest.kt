package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverResource
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.io.InputStream
import java.io.Closeable
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.Socket
import java.net.ServerSocket
import java.net.ProxySelector
import java.net.Proxy
import java.net.URI
import java.net.InetSocketAddress
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class AirPlayVideoProxyTest {
    /** Synthetic API calls advance monotonic time; no OS timeout or private media is replayed. */
    private class TimedHttp(url: java.net.URL, val connectCall: () -> Unit = {},
                            val headersCall: () -> Unit = {}, val content: InputStream) : HttpURLConnection(url) {
        var disconnects = 0
        override fun connect() { connectCall(); connected = true }
        override fun getResponseCode(): Int { headersCall(); return 200 }
        override fun getInputStream(): InputStream = content
        override fun getHeaderFields(): Map<String, List<String>> = mapOf("Content-Type" to listOf("video/mp4"))
        override fun getHeaderField(name: String?): String? = if (name.equals("Content-Type", true)) "video/mp4" else null
        override fun disconnect() { disconnects++ }
        override fun usingProxy(): Boolean = false
    }

    @Test fun httpCallFailuresKeepTheirPhaseBudgetAndElapsedTimeThroughSuccessfulPhoneFallback() {
        val url = "https://media.invalid/video.mp4?token=private-secret"
        for (phase in AirPlayResourceDiagnostics.HttpPhase.entries) {
            var now = 0L; var phoneCalls = 0
            val messages = mutableListOf<String>()
            val timeout = SocketTimeoutException("https://private-host/?secret=private-secret")
            val body = object : InputStream() {
                override fun read(): Int { now += 10_000_000_000; throw timeout }
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int = read()
            }
            val http = TimedHttp(java.net.URL(url), connectCall = {
                if (phase == AirPlayResourceDiagnostics.HttpPhase.CONNECT) { now += 5_000_000_000; throw timeout }
                now += 10_000_000
            }, headersCall = {
                if (phase == AirPlayResourceDiagnostics.HttpPhase.RESPONSE_HEADERS) { now += 10_000_000_000; throw timeout }
                now += 20_000_000
            }, content = body)
            val proxy = AirPlayVideoProxy(url, { _, _ -> phoneCalls++; ReceiverResource(byteArrayOf(1, 2, 3), 200, null) },
                null, messages::add, { http }, { now })
            try {
                proxy.open(proxy.rootId, null) { it }!!.use {
                    assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, it.reference!!.route)
                    assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
                }
                val event = messages.single { it.contains("stage=HTTP_FAILURE ") }
                assertTrue(event.contains("load=1 route=ANDROID_HTTP phase=$phase"))
                assertTrue(event.contains("phaseElapsedMs=${if (phase == AirPlayResourceDiagnostics.HttpPhase.CONNECT) 5000 else 10000}"))
                assertTrue(event.contains("connectLimitMs=5000 readLimitMs=10000 timeoutReported=true"))
                assertTrue(event.contains("exception=SocketTimeoutException"))
                assertEquals(5000, http.connectTimeout); assertEquals(10000, http.readTimeout)
                assertEquals(1, phoneCalls); assertTrue(http.disconnects > 0)
                assertTrue(messages.all { it.length < 600 && !it.contains("private") && !it.contains("secret") })
            } finally { proxy.close() }
        }
    }

    @Test fun streamedHttpFailureKeepsTheReturnedLoadAndMeasuresOnlyTheFailedReadCall() {
        var now = 0L; var reads = 0
        val messages = mutableListOf<String>()
        val timeout = SocketTimeoutException("private-host token=private-secret")
        val body = object : InputStream() {
            override fun read(): Int = throw UnsupportedOperationException()
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                if (reads++ == 0) { repeat(10) { bytes[offset + it] = 42 }; return 10 }
                now += 10_000_000_000; throw timeout
            }
        }
        val http = TimedHttp(java.net.URL("https://media.invalid/video.mp4"), content = body)
        val proxy = AirPlayVideoProxy(http.url.toString(), { _, _ -> error("Successful HTTP must not use FCUP") },
            null, messages::add, { http }, { now })
        try {
            proxy.open(proxy.rootId, null) { it }!!.use { resource ->
                assertEquals(AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, resource.reference!!.route)
                assertTrue(messages.none { it.contains("stage=HTTP_FAILURE ") })
                assertArrayEquals(ByteArray(10) { 42 }, resource.body.readNBytes(10))
                assertSame(timeout, runCatching { resource.body.read() }.exceptionOrNull())
                assertSame(timeout, runCatching { resource.body.read() }.exceptionOrNull())
            }
            val event = messages.single { it.contains("stage=HTTP_FAILURE ") }
            assertTrue(event.contains("load=1 route=ANDROID_HTTP phase=RESPONSE_BODY phaseElapsedMs=10000"))
            assertTrue(event.contains("readLimitMs=10000 timeoutReported=true"))
            assertFalse(event.contains("private")); assertFalse(event.contains("secret"))
            assertTrue(http.disconnects > 0)
        } finally { proxy.close() }
    }

    /** Real JVM sockets hold an HTTP stage open; no synthetic time or shortened production timer. */
    private class ReadTimeoutOrigin(private val response: ByteArray?) : Closeable {
        private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        private val release = CountDownLatch(1)
        private val closed = AtomicBoolean()
        private val completed = CompletableFuture<Throwable?>()
        @Volatile private var accepted: Socket? = null
        val url = "http://127.0.0.1:${server.localPort}/movie.mp4"
        private val worker = Thread {
            try {
                server.accept().use { socket ->
                    accepted = socket
                    if (closed.get()) return@use
                    socket.soTimeout = 5000
                    val input = socket.getInputStream()
                    var end = 0; var bytes = 0
                    while (end != 0x0d0a0d0a) {
                        val value = input.read()
                        if (value < 0) throw IOException("Incomplete timeout-fixture request")
                        check(++bytes <= 16384)
                        end = (end shl 8) or value
                    }
                    response?.let { socket.getOutputStream().apply { write(it); flush() } }
                    release.await(25, TimeUnit.SECONDS)
                }
                completed.complete(null)
            } catch (error: Throwable) {
                completed.complete(if (closed.get()) null else error)
            }
        }.apply { isDaemon = true; name = "AirPlay HTTP read-timeout origin"; start() }

        override fun close() {
            if (!closed.compareAndSet(false, true)) return
            release.countDown()
            runCatching { server.close() }
            runCatching { accepted?.close() }
        }

        fun join() {
            worker.join(1000)
            assertFalse("Timeout-fixture origin must not leave a worker running", worker.isAlive)
            completed.get(1, TimeUnit.SECONDS)?.let { throw AssertionError("Timeout-fixture origin failed", it) }
        }
    }

    @Test fun actualJvmHttpReadTimeoutCoversHeadersInitialBodyAndReturnedBodyWithProductionLimits() {
        val header = ("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: 64\r\n" +
            "Connection: close\r\n\r\n").toByteArray(Charsets.ISO_8859_1)
        val prefix = ByteArray(32) { 42 }
        val origins = mutableListOf<ReadTimeoutOrigin>()
        val pool = Executors.newFixedThreadPool(3)
        val futures = mutableListOf<java.util.concurrent.Future<*>>()
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25)
        try {
            listOf(null, header, header + prefix).forEach { origins += ReadTimeoutOrigin(it) }
            origins.forEachIndexed { index, origin ->
                futures += pool.submit {
                    val messages = mutableListOf<String>()
                    val openedConnections = mutableListOf<HttpURLConnection>()
                    var phoneCalls = 0
                    val proxy = AirPlayVideoProxy(origin.url, { _, _ ->
                        phoneCalls++
                        check(index != 2) { "A returned streaming body must not restart through FCUP" }
                        ReceiverResource(byteArrayOf(1, 2, 3), 200, null)
                    }, null, messages::add, { uri ->
                        // Only the local fixture bypasses JVM proxy selection; no remote request is made.
                        (uri.toURL().openConnection(Proxy.NO_PROXY) as HttpURLConnection).also { openedConnections += it }
                    }, System::nanoTime)
                    var resource: AirPlayVideoProxy.Resource? = null
                    try {
                        var started = System.nanoTime()
                        val opened = proxy.open(proxy.rootId, null) { it }!!
                        resource = opened
                        if (index == 2) {
                            assertEquals(AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, opened.reference!!.route)
                            assertTrue(messages.none { it.contains("stage=HTTP_FAILURE ") })
                            assertArrayEquals(prefix, opened.body.readNBytes(prefix.size))
                            started = System.nanoTime()
                            assertThrows(SocketTimeoutException::class.java) { opened.body.read() }
                        } else {
                            assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, opened.reference!!.route)
                            assertArrayEquals(byteArrayOf(1, 2, 3), opened.body.readBytes())
                        }
                        val elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
                        assertTrue("Real read must expire near its unchanged 10-second limit: $elapsedMillis ms",
                            elapsedMillis in 9000L..20000L)
                        val failure = messages.single { it.contains("stage=HTTP_FAILURE ") }
                        val phase = if (index == 0) "RESPONSE_HEADERS" else "RESPONSE_BODY"
                        assertTrue(failure.contains("load=1 route=ANDROID_HTTP phase=$phase"))
                        assertTrue(failure.contains("connectLimitMs=5000 readLimitMs=10000 timeoutReported=true"))
                        assertTrue(failure.contains("exception=SocketTimeoutException"))
                        val phaseMillis = Regex("phaseElapsedMs=(\\d+)").find(failure)!!.groupValues[1].toLong()
                        assertTrue("Stage clock must measure the blocked real read: $phaseMillis ms",
                            phaseMillis in 9000L..20000L)
                        assertEquals(1, openedConnections.size)
                        assertEquals(5000, openedConnections.single().connectTimeout)
                        assertEquals(10000, openedConnections.single().readTimeout)
                        assertEquals(if (index == 2) 0 else 1, phoneCalls)
                        println("Real JVM HTTP read expiry case=$index phase=$phase elapsedMs=$elapsedMillis phaseElapsedMs=$phaseMillis")
                    } finally {
                        // Release the peer before body cleanup, which may otherwise try to drain it.
                        origin.close()
                        try { resource?.close() } finally { proxy.close() }
                    }
                }
            }
            for (future in futures) future.get((deadline - System.nanoTime()).coerceAtLeast(1), TimeUnit.NANOSECONDS)
        } finally {
            origins.forEach(ReadTimeoutOrigin::close)
            futures.forEach { it.cancel(true) }
            pool.shutdownNow()
            assertTrue("Timeout-fixture clients must finish after socket cleanup", pool.awaitTermination(3, TimeUnit.SECONDS))
            origins.forEach(ReadTimeoutOrigin::join)
        }
    }

    @Test fun inlineCaptionMetadataNeverEntersTheSerialPhoneResourceExchange() {
        val prefix = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n"
        val caption = (prefix + "x".repeat(123248 - prefix.length - 2) + "\n\n").toByteArray()
        assertEquals(123248, caption.size)
        val inline = "data:text/vtt;charset=UTF-8;base64," + Base64.getEncoder().encodeToString(caption)
        val root = "minibili://app/master.m3u8"
        val subtitles = "minibili://app/subtitles.m3u8"
        val video = "minibili://app/video.m3u8"
        val master = "#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"cc\",NAME=\"English\",URI=\"$subtitles\"\n" +
            "#EXT-X-STREAM-INF:BANDWIDTH=100000,SUBTITLES=\"cc\"\n$video\n"
        val subtitlePlaylist = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n$inline\n#EXT-X-ENDLIST\n"
        for (force in listOf(false, true)) {
            val phoneCalls = mutableListOf<String>()
            val routed = mutableListOf<String>()
            val proxy = AirPlayVideoProxy(root, { url, _ ->
                phoneCalls += url
                val body = when (url) {
                    root -> master
                    subtitles -> subtitlePlaylist
                    video -> "#EXTM3U\n#EXTINF:1,\nminibili://app/segment.m4s\n#EXT-X-ENDLIST\n"
                    else -> error("Inline data must not be sent to the phone")
                }
                ReceiverResource(body.toByteArray(), 0, null)
            })
            val route: (String) -> String = { id -> routed += id; "/resource?r=$id" }
            try {
                proxy.open(proxy.rootId, "bytes=0-65535", force, route)!!.use {
                    assertEquals(200, it.status)
                    assertFalse(it.body.readBytes().toString(Charsets.UTF_8).contains("minibili:"))
                }
                val subtitleId = routed[0]; val videoId = routed[1]
                proxy.open(subtitleId, null, force, route)!!.use {
                    val playlist = it.body.readBytes().toString(Charsets.UTF_8)
                    assertFalse(playlist.contains("data:"))
                    assertTrue(playlist.contains("/resource?r="))
                }
                val inlineId = routed.last()
                proxy.open(inlineId, null, force, route)!!.use {
                    assertEquals(200, it.status)
                    assertEquals("text/vtt;charset=UTF-8", it.type)
                    assertEquals(AirPlayVideoProxy.ResourceRoute.INLINE_DATA, it.reference!!.route)
                    assertNull(it.reference!!.headersMillis)
                    assertTrue(it.reference!!.responseMillis!! >= 0)
                    assertArrayEquals(caption, it.body.readBytes())
                }
                assertEquals(listOf(root, subtitles), phoneCalls)
                proxy.open(videoId, null, force, route)!!.use { assertEquals(200, it.status) }
                assertEquals(listOf(root, subtitles, video), phoneCalls)
            } finally { proxy.close() }
        }
    }

    @Test fun inlineDataPreservesPercentBytesLiteralPlusAndValidatedMimeCharset() {
        val cases = listOf(
            Triple("data:,a+b%2Bc%20%F0%9F%98%80", "a+b+c 😀".toByteArray(), "text/plain;charset=US-ASCII"),
            Triple("data:;charset=US-ASCII,ABC", "ABC".toByteArray(), "text/plain;charset=US-ASCII"),
            Triple("DATA:TEXT/VTT;CHARSET=UTF-8;BASE64,V0VCVlRUCg==", "WEBVTT\n".toByteArray(), "text/vtt;charset=UTF-8"),
            Triple("data:application/octet-stream;base64,%2Bw%3D%3D", byteArrayOf(251.toByte()), "application/octet-stream"),
            Triple("data:application/octet-stream;base64,+w==", byteArrayOf(251.toByte()), "application/octet-stream"),
            Triple("data:text/plain;charset=ISO-8859-1,%E9", byteArrayOf(233.toByte()), "text/plain;charset=ISO-8859-1"),
            Triple("data:application/octet-stream,a%00b", byteArrayOf(97, 0, 98), "application/octet-stream"),
        )
        for ((url, expected, type) in cases) {
            val proxy = AirPlayVideoProxy(url, { _, _ -> error("Inline data must stay local") })
            try { proxy.open(proxy.rootId, null) { it }!!.use {
                assertEquals(type, it.type)
                assertArrayEquals(expected, it.body.readBytes())
            } } finally { proxy.close() }
        }
    }

    @Test fun inlineDataRangesUseAbsoluteOffsetsAndKeepTheEofLength() {
        val proxy = AirPlayVideoProxy("data:application/octet-stream,0123456789", { _, _ -> error("Unexpected FCUP") })
        try {
            for ((range, expected, contentRange) in listOf(
                Triple("bytes=0-3", "0123", "bytes 0-3/10"),
                Triple("bytes=5-", "56789", "bytes 5-9/10"),
                Triple("bytes=-3", "789", "bytes 7-9/10"),
                Triple("bytes=3-99", "3456789", "bytes 3-9/10"),
            )) proxy.open(proxy.rootId, range) { it }!!.use {
                assertEquals(206, it.status)
                assertEquals(contentRange, it.headers.toMap()["Content-Range"])
                assertEquals(expected.length.toString(), it.headers.toMap()["Content-Length"])
                assertEquals(expected, it.body.readBytes().toString(Charsets.US_ASCII))
            }
            for (range in listOf("bytes=10-", "bytes=4-2", "bytes=-0")) proxy.open(proxy.rootId, range) { it }!!.use {
                assertEquals(416, it.status)
                assertEquals("bytes */10", it.headers.toMap()["Content-Range"])
                assertEquals(0, it.body.readBytes().size)
            }
        } finally { proxy.close() }
    }

    @Test fun emptyInlineDataHasNoPhantomBytesAndClosedOwnersCannotReadIt() {
        val proxy = AirPlayVideoProxy("data:,", { _, _ -> error("Unexpected FCUP") })
        try {
            proxy.open(proxy.rootId, null) { it }!!.use {
                assertEquals(200, it.status)
                assertEquals("0", it.headers.toMap()["Content-Length"])
                assertEquals(-1, it.body.read())
            }
        } finally { proxy.close() }
        assertNull(proxy.open(proxy.rootId, null) { it })
        val range = AirPlayVideoProxy("data:,", { _, _ -> error("Unexpected FCUP") })
        try { range.open(range.rootId, "bytes=0-") { it }!!.use {
            assertEquals(416, it.status)
            assertEquals("bytes */0", it.headers.toMap()["Content-Range"])
            assertEquals(0, it.body.readBytes().size)
        } } finally { range.close() }
    }

    private fun assertInlineFailure(url: String, reason: AirPlayVideoProxy.FailureReason) {
        val lines = mutableListOf<String>()
        val proxy = AirPlayVideoProxy(url, { _, _ -> error("Invalid inline data must not fall back to FCUP") }, log = lines::add)
        try {
            val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, null) { it } }
            assertEquals(reason, failure.reason)
            assertEquals(AirPlayVideoProxy.ResourceRoute.INLINE_DATA, failure.route)
            assertEquals(1L, failure.load)
            assertTrue(lines.any { it.contains("route=INLINE_DATA") && it.contains("reason=${reason.wire}") })
            assertFalse(lines.any { it.contains("data:") || it.contains("IPHONE_FCUP") || it.contains("ANDROID_HTTP") })
        } finally { proxy.close() }
    }

    @Test fun malformedInlineEncodingAndMimeNeverBecomePhoneRequestsOrUnsafeHeaders() {
        for (url in listOf(
            "data:text/vtt;base64", "data:text%2Fvtt;base64,QQ==", "data:text/vtt%0D%0AX-Test:bad,hello",
            "data:text/vtt;unknown=value,hello", "data:text/vtt;charset=UTF-8;charset=ASCII,hello",
            "data:text/vtt;charset=UTF-8%0D%0AX-Test,hello", "data:text/vtt;BASE64;charset=UTF-8,QQ==",
            "data:text/vtt;base64;base64,QQ==", "data:text/vtt;base64,Q===", "data:text/vtt;base64,%25",
            "data:text/vtt;base64,AA%20A", "data:text/plain,字幕",
        )) assertInlineFailure(url, AirPlayVideoProxy.FailureReason.UNSUPPORTED_RESOURCE)
        for (url in listOf("data:,bad%2", "data:,bad%GG")) {
            val failure = assertThrows(IOException::class.java) { AirPlayVideoProxy(url, { _, _ -> error("Unexpected FCUP") }) }
            assertEquals("Unsupported media resource", failure.message)
        }
    }

    @Test fun inlineMetadataAndDecodedBytesHaveSeparateEarlyLimits() {
        val limit = 2 * 1024 * 1024
        val exact = AirPlayVideoProxy("data:application/octet-stream;base64," + Base64.getEncoder().encodeToString(ByteArray(limit)),
            { _, _ -> error("Unexpected FCUP") })
        try { exact.open(exact.rootId, null) { it }!!.use { assertEquals(limit, it.body.readBytes().size) } }
        finally { exact.close() }
        assertInlineFailure("data:text/plain," + "a".repeat(limit + 1), AirPlayVideoProxy.FailureReason.RESOURCE_TOO_LARGE)
        assertInlineFailure("data:text/plain," + "%41".repeat(limit + 1), AirPlayVideoProxy.FailureReason.RESOURCE_TOO_LARGE)
        assertInlineFailure("data:application/octet-stream;base64," + Base64.getEncoder().encodeToString(ByteArray(limit + 1)),
            AirPlayVideoProxy.FailureReason.RESOURCE_TOO_LARGE)
        assertInlineFailure("data:text/plain;charset=" + "a".repeat(1025) + ",x", AirPlayVideoProxy.FailureReason.RESOURCE_TOO_LARGE)
    }

    @Test fun inlineTextIsOpaqueAndInlinePlaylistsCannotOpenLocalOrRelativeResources() {
        val literal = "file:///synthetic-secret http://example.test/never-requested"
        val proxy = AirPlayVideoProxy("data:text/plain," + literal.replace(" ", "%20"), { _, _ -> error("Unexpected FCUP") })
        try { proxy.open(proxy.rootId, null) { it }!!.use { assertEquals(literal, it.body.readBytes().toString(Charsets.UTF_8)) } }
        finally { proxy.close() }
        for (child in listOf("file:///synthetic-secret", "content://synthetic/1", "relative.ts", "http://example.test/%GG")) {
            val bytes = "#EXTM3U\n#EXTINF:1,\n$child\n".toByteArray()
            assertInlineFailure("data:application/vnd.apple.mpegurl;base64," + Base64.getEncoder().encodeToString(bytes),
                AirPlayVideoProxy.FailureReason.UNSUPPORTED_RESOURCE)
        }
    }

    @Test fun brokerWholeResourceLimitIsCheckedBeforeServingALocalByteRange() {
        val limit = 32 * 1024 * 1024
        for (size in listOf(limit - 1, limit, limit + 1)) {
            val bytes = ByteArray(size).apply { this[lastIndex] = 90 }
            val range = "bytes=${size - 1}-${size - 1}"
            var requests = 0
            val proxy = AirPlayVideoProxy("minibili://synthetic/binary.mp4", { _, requested ->
                assertEquals(range, requested); requests++
                ReceiverResource(bytes, 200, null)
            })
            try {
                if (size <= limit) proxy.open(proxy.rootId, range) { it }!!.use {
                    assertEquals(206, it.status)
                    assertEquals("bytes ${size - 1}-${size - 1}/$size", it.headers.toMap()["Content-Range"])
                    assertEquals("1", it.headers.toMap()["Content-Length"])
                    assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, it.reference!!.route)
                    assertEquals(90, it.body.read()); assertEquals(-1, it.body.read())
                } else {
                    val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, range) { it } }
                    assertEquals(AirPlayVideoProxy.FailureReason.RESOURCE_TOO_LARGE, failure.reason)
                    assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, failure.route)
                    assertEquals(1L, failure.load)
                }
                assertEquals(1, requests)
            } finally { proxy.close() }
        }
    }

    /** Large legal comments exercise byte limits without synthetic media or thousands of resources. */
    private fun playlistOfSize(size: Int, child: String? = null): ByteArray {
        val prefix = "#EXTM3U\n#padding=".toByteArray()
        val suffix = (if (child == null) "\n#EXT-X-ENDLIST\n" else "\n#EXTINF:1,\n$child\n#EXT-X-ENDLIST\n").toByteArray()
        require(size >= prefix.size + suffix.size)
        return ByteArray(size) { 120 }.also { bytes ->
            prefix.copyInto(bytes); suffix.copyInto(bytes, size - suffix.size)
        }
    }

    @Test fun brokerManifestInputAcceptsTwoMebibytesExactlyAndRejectsTheNextByte() {
        val limit = 2 * 1024 * 1024
        for (size in listOf(limit - 1, limit, limit + 1)) {
            val bytes = playlistOfSize(size)
            var requests = 0
            val proxy = AirPlayVideoProxy("minibili://synthetic/master.m3u8", { _, _ ->
                requests++; ReceiverResource(bytes, 200, null)
            })
            try {
                if (size <= limit) proxy.open(proxy.rootId, "bytes=0-65535") { error("Comment-only playlist has no child resources") }!!.use {
                    assertEquals(200, it.status)
                    assertTrue(it.reference!!.rewrittenPlaylist)
                    assertFalse(it.headers.any { header -> header.first.equals("Content-Range", true) })
                    assertArrayEquals(bytes, it.body.readBytes())
                } else {
                    val failure = assertThrows(IOException::class.java) {
                        proxy.open(proxy.rootId, "bytes=0-65535") { error("Oversized playlist must not be rewritten") }
                    }
                    assertEquals("Playlist too large", failure.cause?.message ?: failure.message)
                }
                assertEquals(1, requests)
            } finally { proxy.close() }
        }
    }

    @Test fun androidManifestStreamingReadHasTheSameExactInputLimitWithoutPublishingAPrefix() {
        val limit = 2 * 1024 * 1024
        for (size in listOf(limit - 1, limit, limit + 1)) {
            val bytes = playlistOfSize(size)
            withOrigin(200, mapOf("Content-Type" to "application/vnd.apple.mpegurl"), bytes) { origin, _ ->
                var fallbackRequests = 0
                val proxy = AirPlayVideoProxy("$origin/playlist", { _, _ -> fallbackRequests++; null })
                try {
                    if (size <= limit) proxy.open(proxy.rootId, null) { error("Comment-only playlist has no child resources") }!!.use {
                        assertEquals(200, it.status)
                        assertEquals(AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, it.reference!!.route)
                        assertTrue(it.reference!!.rewrittenPlaylist)
                        assertArrayEquals(bytes, it.body.readBytes())
                    } else assertThrows(IOException::class.java) {
                        proxy.open(proxy.rootId, null) { error("Oversized playlist must not publish a rewritten prefix") }
                    }
                    assertEquals(if (size <= limit) 0 else 1, fallbackRequests)
                } finally { proxy.close() }
            }
        }
    }

    @Test fun theNativeManifestInputLimitDoesNotClaimToLimitItsRewrittenOutput() {
        val limit = 2 * 1024 * 1024
        val input = playlistOfSize(limit, "s.ts")
        val replacement = "/resource?r=1&synthetic=" + "p".repeat(64)
        var rewrites = 0
        val proxy = AirPlayVideoProxy("minibili://synthetic/master.m3u8", { _, _ -> ReceiverResource(input, 200, null) })
        try {
            proxy.open(proxy.rootId, null) { id -> assertEquals("1", id); rewrites++; replacement }!!.use {
                assertEquals(200, it.status)
                val output = it.body.readBytes()
                assertEquals(limit + replacement.length - "s.ts".length, output.size)
                assertTrue(output.size > limit)
                assertTrue(output.toString(Charsets.UTF_8).endsWith("\n$replacement\n#EXT-X-ENDLIST\n"))
                assertTrue(it.reference!!.rewrittenPlaylist)
            }
            assertEquals(1, rewrites)
        } finally { proxy.close() }
    }

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
    private fun withOrigin(status: Int, headers: Map<String, String>, body: ByteArray, statuses: List<Int> = listOf(status),
                           test: (String, CompletableFuture<String>) -> Unit) {
        ServerSocket(0).use { server ->
            val request = CompletableFuture<String>()
            val worker = Thread {
                try {
                    for (responseStatus in statuses) server.accept().use { socket ->
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
                        val response = "HTTP/1.1 $responseStatus Test\r\nContent-Length: ${body.size}\r\nConnection: close\r\n" +
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

    private fun partialResource(range: String?): ReceiverResource {
        val requested = requireNotNull(range).removePrefix("bytes=")
        return ReceiverResource(byteArrayOf(1, 2, 3), 206, null,
            mapOf("Content-Range" to "bytes $requested/1000", "Content-Length" to "3"))
    }

    @Test fun successfulFcUpFallbackReusesOnlyTheExactSignedResourceForThisItem() {
        val port = ServerSocket(0).use { it.localPort }
        val signed = "http://127.0.0.1:$port/video.mp4?token=first"
        val messages = mutableListOf<String>()
        val ranges = mutableListOf<String?>()
        val proxy = AirPlayVideoProxy(signed, { _, range -> ranges += range; partialResource(range) }, log = messages::add)
        fun httpFailures() = messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") }
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }!!.use { assertEquals(206, it.status) }
            proxy.open(proxy.rootId, "bytes=103-105") { it }!!.use {
                assertTrue(it.headers.contains("Content-Range" to "bytes 103-105/1000"))
                assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
            }
            assertEquals(listOf("bytes=100-102", "bytes=103-105"), ranges)
            assertEquals(1, httpFailures())
            val children = proxy.rewritePlaylist(signed,
                "#EXTM3U\nvideo.mp4?token=second\nother.mp4?token=first\n".toByteArray()) { it }
                .toString(Charsets.UTF_8).lineSequence().filter { it.isNotBlank() && !it.startsWith('#') }.toList()
            for (id in children) proxy.open(id, "bytes=100-102") { it }!!.use { assertEquals(206, it.status) }
            assertEquals(3, httpFailures())
            AirPlayVideoProxy(signed, { _, range -> partialResource(range) }, log = messages::add).use { next ->
                next.open(next.rootId, "bytes=100-102") { it }!!.close()
            }
            assertEquals(4, httpFailures())
            assertTrue(messages.any { it.contains("stage=ROUTE_CONFIRMED") && it.contains("scope=item-resource") })
            assertFalse(messages.joinToString().contains("token=first"))
        } finally { proxy.close() }
    }

    @Test fun invalidFcUpPartialResponsesNeverTeachTheProxyToSkipAndroidHttp() {
        val port = ServerSocket(0).use { it.localPort }
        val messages = mutableListOf<String>()
        val proxy = AirPlayVideoProxy("http://127.0.0.1:$port/movie.mp4", { _, _ ->
            ReceiverResource(byteArrayOf(1, 2, 3), 206, null, mapOf("Content-Range" to "bytes 0-2/1000"))
        }, log = messages::add)
        try {
            repeat(2) {
                val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) {
                    proxy.open(proxy.rootId, "bytes=100-102") { it }
                }
                assertEquals(AirPlayVideoProxy.FailureReason.INVALID_RANGE_RESPONSE, failure.reason)
            }
            assertEquals(2, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertFalse(messages.any { it.contains("stage=ROUTE_CONFIRMED") })
        } finally { proxy.close() }
    }

    @Test fun unavailableRememberedFcUpRouteRetriesAndroidAndCanRecoverThroughAFreshExchange() {
        val port = ServerSocket(0).use { it.localPort }
        val messages = mutableListOf<String>()
        var requests = 0
        val proxy = AirPlayVideoProxy("http://127.0.0.1:$port/movie.mp4", { _, range ->
            requests++
            if (requests == 2) null else partialResource(range)
        }, log = messages::add)
        try {
            repeat(3) { proxy.open(proxy.rootId, "bytes=100-102") { it }!!.close() }
            assertEquals(4, requests)
            assertEquals(2, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertEquals(2, messages.count { it.contains("stage=ROUTE_CONFIRMED") })
            assertEquals(1, messages.count { it.contains("stage=ROUTE_REVOKED") })
        } finally { proxy.close() }
    }

    @Test fun failedRememberedFcUpRouteCanRecoverOnAndroidHttpWithoutAnotherFcUpExchange() {
        withOrigin(403, mapOf("Content-Range" to "bytes 100-102/1000"), byteArrayOf(1, 2, 3),
            statuses = listOf(403, 206)) { origin, _ ->
            val messages = mutableListOf<String>()
            var requests = 0
            val proxy = AirPlayVideoProxy("$origin/movie.mp4", { _, range ->
                if (++requests == 1) partialResource(range) else null
            }, log = messages::add)
            try {
                proxy.open(proxy.rootId, "bytes=100-102") { it }!!.use {
                    assertEquals(AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, it.reference!!.route)
                }
                proxy.open(proxy.rootId, "bytes=100-102") { it }!!.use {
                    assertEquals(AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, it.reference!!.route)
                    assertArrayEquals(byteArrayOf(1, 2, 3), it.body.readBytes())
                }
                assertEquals(2, requests)
                assertEquals(1, messages.count { it.contains("stage=ROUTE_CONFIRMED") })
                assertEquals(1, messages.count { it.contains("stage=ROUTE_REVOKED") })
            } finally { proxy.close() }
        }
    }

    @Test fun closingAnItemDuringItsRememberedExchangeCannotRestartAndroidHttp() {
        val port = ServerSocket(0).use { it.localPort }
        val messages = mutableListOf<String>()
        var requests = 0
        lateinit var proxy: AirPlayVideoProxy
        proxy = AirPlayVideoProxy("http://127.0.0.1:$port/movie.mp4", { _, range ->
            if (++requests == 2) proxy.close()
            partialResource(range)
        }, log = messages::add)
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }!!.close()
            assertThrows(IOException::class.java) { proxy.open(proxy.rootId, "bytes=103-105") { it } }
            assertNull(proxy.open(proxy.rootId, "bytes=106-108") { it })
            assertEquals(2, requests)
            assertEquals(1, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
        } finally { proxy.close() }
    }

    @Test fun aRememberedFcUpRedirectDoesNotRetryTheOldOriginWhenItsDestinationFails() {
        val port = ServerSocket(0).use { it.localPort }
        val signed = "http://127.0.0.1:$port/movie.mp4"
        val destination = "minibili://app/destination.mp4"
        val requests = mutableListOf<String>()
        val proxy = AirPlayVideoProxy(signed, { url, range ->
            requests += url
            when {
                url == destination -> throw IOException("destination unavailable")
                requests.size == 1 -> partialResource(range)
                else -> ReceiverResource(null, 302, destination)
            }
        })
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }!!.close()
            assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, "bytes=103-105") { it } }
            assertEquals(listOf(signed, signed, destination), requests)
        } finally { proxy.close() }
    }

    @Test fun aSuccessfulFcUpRedirectTeachesItsEntryWithoutRevokingItForLaterDestinationFailures() {
        val port = ServerSocket(0).use { it.localPort }
        val signed = "http://127.0.0.1:$port/movie.mp4"
        val destination = "minibili://app/destination.mp4"
        val requests = mutableListOf<String>()
        val messages = mutableListOf<String>()
        var destinationFails = false
        val proxy = AirPlayVideoProxy(signed, { url, range ->
            requests += url
            if (url == signed) ReceiverResource(null, 302, destination)
            else {
                assertEquals(destination, url)
                if (destinationFails) throw IOException("destination unavailable")
                partialResource(range)
            }
        }, log = messages::add)
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }!!.close()
            destinationFails = true
            assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, "bytes=103-105") { it } }
            destinationFails = false
            proxy.open(proxy.rootId, "bytes=106-108") { it }!!.use {
                assertTrue(it.headers.contains("Content-Range" to "bytes 106-108/1000"))
            }
            assertEquals(listOf(signed, destination, signed, destination, signed, destination), requests)
            assertEquals(1, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertEquals(1, messages.count { it.contains("stage=ROUTE_CONFIRMED") })
            assertFalse(messages.any { it.contains("stage=ROUTE_REVOKED") })
        } finally { proxy.close() }
    }

    @Test fun aFailedFcUpRedirectChainCannotTeachItsEntryToSkipAndroidHttp() {
        val port = ServerSocket(0).use { it.localPort }
        val signed = "http://127.0.0.1:$port/movie.mp4"
        val destination = "minibili://app/destination.mp4"
        val messages = mutableListOf<String>()
        val proxy = AirPlayVideoProxy(signed, { url, _ ->
            if (url == signed) ReceiverResource(null, 302, destination) else throw IOException("destination unavailable")
        }, log = messages::add)
        try {
            repeat(2) { assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, "bytes=100-102") { it } } }
            assertEquals(2, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertFalse(messages.any { it.contains("stage=ROUTE_CONFIRMED") })
        } finally { proxy.close() }
    }

    @Test fun anIncompleteFcUpPlaylistContinuesOnFcUpBeforeConfirmingItsEntry() {
        val port = ServerSocket(0).use { it.localPort }
        val bytes = appPlaylist.toByteArray()
        val requests = mutableListOf<String?>()
        val messages = mutableListOf<String>()
        val proxy = AirPlayVideoProxy("http://127.0.0.1:$port/manifest", { _, range ->
            requests += range
            if (range != null) ReceiverResource(bytes.copyOf(16), 206, null,
                mapOf("Content-Range" to "bytes 0-15/${bytes.size}", "Content-Length" to "16"))
            else ReceiverResource(bytes, 200, null)
        }, log = messages::add)
        try {
            repeat(2) { proxy.open(proxy.rootId, "bytes=0-15") { "/resource?r=$it" }!!.use(::assertWholeRewrittenPlaylist) }
            assertEquals(listOf("bytes=0-15", null, "bytes=0-15", null), requests)
            assertEquals(1, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertEquals(1, messages.count { it.contains("stage=ROUTE_CONFIRMED") })
        } finally { proxy.close() }
    }

    @Test fun anInvalidWholeFcUpPlaylistCannotConfirmItsValidPrefixAsAWorkingRoute() {
        val port = ServerSocket(0).use { it.localPort }
        val bytes = appPlaylist.toByteArray()
        val messages = mutableListOf<String>()
        val proxy = AirPlayVideoProxy("http://127.0.0.1:$port/manifest", { _, range ->
            if (range != null) ReceiverResource(bytes.copyOf(16), 206, null,
                mapOf("Content-Range" to "bytes 0-15/${bytes.size}", "Content-Length" to "16"))
            else ReceiverResource("not a manifest".toByteArray(), 200, null)
        }, log = messages::add)
        try {
            repeat(2) {
                val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, "bytes=0-15") { it } }
                assertEquals(AirPlayVideoProxy.FailureReason.INVALID_RANGE_RESPONSE, failure.reason)
            }
            assertEquals(2, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertFalse(messages.any { it.contains("stage=ROUTE_CONFIRMED") })
        } finally { proxy.close() }
    }

    @Test fun aWholeFcUpPlaylistRedirectRequiresAnActuallyRewrittenDestination() {
        for (valid in listOf(false, true)) {
            val port = ServerSocket(0).use { it.localPort }
            val signed = "http://127.0.0.1:$port/manifest"
            val destination = "minibili://app/destination"
            val bytes = appPlaylist.toByteArray()
            val messages = mutableListOf<String>()
            val proxy = AirPlayVideoProxy(signed, { url, range ->
                when {
                    url == destination -> ReceiverResource(if (valid) bytes else "not a manifest".toByteArray(), 200, null,
                        mapOf("Content-Type" to "application/vnd.apple.mpegurl"))
                    range != null -> ReceiverResource(bytes.copyOf(16), 206, null,
                        mapOf("Content-Range" to "bytes 0-15/${bytes.size}", "Content-Length" to "16"))
                    else -> ReceiverResource(null, 302, destination)
                }
            }, log = messages::add)
            try {
                repeat(2) {
                    if (valid) proxy.open(proxy.rootId, "bytes=0-15") { "/resource?r=$it" }!!.use(::assertWholeRewrittenPlaylist)
                    else {
                        val failure = assertThrows(AirPlayVideoProxy.Failure::class.java) { proxy.open(proxy.rootId, "bytes=0-15") { it } }
                        assertEquals(AirPlayVideoProxy.FailureReason.INVALID_RANGE_RESPONSE, failure.reason)
                    }
                }
                assertEquals(if (valid) 1 else 2, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
                assertEquals(if (valid) 1 else 0, messages.count { it.contains("stage=ROUTE_CONFIRMED") })
            } finally { proxy.close() }
        }
    }

    @Test fun interruptingAFallbackExchangeCannotConfirmOrRetryItsRoute() {
        val port = ServerSocket(0).use { it.localPort }
        val messages = mutableListOf<String>()
        var requests = 0
        val proxy = AirPlayVideoProxy("http://127.0.0.1:$port/movie.mp4", { _, range ->
            requests++
            Thread.currentThread().interrupt()
            partialResource(range)
        }, log = messages::add)
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }?.close()
            assertEquals(1, requests)
            assertFalse(messages.any { it.contains("stage=ROUTE_CONFIRMED") })
            Thread.interrupted()
            proxy.open(proxy.rootId, "bytes=103-105") { it }?.close()
            assertEquals(2, requests)
            assertEquals(2, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
        } finally { Thread.interrupted(); proxy.close() }
    }

    @Test fun interruptingARememberedExchangePreservesItsRouteForTheNextRange() {
        val port = ServerSocket(0).use { it.localPort }
        val messages = mutableListOf<String>()
        var requests = 0
        val proxy = AirPlayVideoProxy("http://127.0.0.1:$port/movie.mp4", { _, range ->
            if (++requests == 2) {
                Thread.currentThread().interrupt()
                null
            } else partialResource(range)
        }, log = messages::add)
        try {
            proxy.open(proxy.rootId, "bytes=100-102") { it }!!.close()
            assertThrows(IOException::class.java) { proxy.open(proxy.rootId, "bytes=103-105") { it } }
            Thread.interrupted()
            proxy.open(proxy.rootId, "bytes=106-108") { it }!!.close()
            assertEquals(3, requests)
            assertEquals(1, messages.count { it.contains("route=ANDROID_HTTP") && it.contains("reason=resource-io") })
            assertEquals(1, messages.count { it.contains("stage=ROUTE_CONFIRMED") })
            assertFalse(messages.any { it.contains("stage=ROUTE_REVOKED") })
        } finally { Thread.interrupted(); proxy.close() }
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
