package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.Socket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.BindException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ReceiverServerTest {
    private class BlockedEventOutput(private val output: java.io.OutputStream) : java.io.OutputStream() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        private val first = java.util.concurrent.atomic.AtomicBoolean(true)
        override fun write(value: Int) = write(byteArrayOf(value.toByte()), 0, 1)
        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            if (first.compareAndSet(true, false)) {
                entered.countDown()
                if (!release.await(5, TimeUnit.SECONDS)) throw java.io.IOException("Blocked test writer was not released")
            }
            output.write(bytes, offset, length)
        }
        override fun flush() = output.flush()
    }

    /** Replace only the reverse socket's output with a controlled slow writer after its real upgrade. */
    private fun blockReverseOutput(receiver: ReceiverServer, id: String = "11223344556677889900aabbccddeeff"): BlockedEventOutput {
        val reverse = ReceiverServer::class.java.getDeclaredField("reverse").apply { isAccessible = true }
            .get(receiver) as Map<*, *>
        val connection = requireNotNull(reverse.values.firstOrNull { value ->
            val candidate = requireNotNull(value)
            val reverseId = candidate.javaClass.getDeclaredField("reverseId").apply { isAccessible = true }.get(candidate)
            val socket = candidate.javaClass.getDeclaredField("socket").apply { isAccessible = true }.get(candidate) as Socket
            reverseId == id && !socket.isClosed
        })
        val field = connection.javaClass.getDeclaredField("output").apply { isAccessible = true }
        return BlockedEventOutput(field.get(connection) as java.io.OutputStream).also { field.set(connection, it) }
    }

    private fun Socket.upgradeReverse() {
        getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: 11223344556677889900aabbccddeeff\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
        assertEquals("101", readReceiverRequest(getInputStream())!!.path)
    }

    @Test fun reverseChannelAcceptsHttpAndEventStatusRepliesWithoutAnsweringThemAsRequests() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
                connect(receiver.port).use { reverse ->
                    reverse.upgradeReverse()
                    for ((protocol, kind) in listOf("HTTP/1.1" to "HTTP", "EVENT/1.0" to "EVENT")) {
                        receiver.playbackEvent("playing")
                        val event = requireNotNull(readReceiverRequest(reverse.getInputStream()))
                        assertEquals("POST", event.method)
                        assertEquals("/event", event.path)
                        reverse.getOutputStream().write("$protocol 200 OK\r\nContent-Length: 0\r\n\r\n".toByteArray())
                        val deadline = System.nanoTime() + 1_000_000_000L
                        while (listener.logs.none { it.contains("stage=REVERSE_REPLY kind=$kind status=200") } && System.nanoTime() < deadline) Thread.sleep(1)
                        assertTrue(listener.logs.any { it.contains("stage=REVERSE_REPLY kind=$kind status=200") })
                        reverse.soTimeout = 100
                        assertThrows(java.net.SocketTimeoutException::class.java) { readReceiverRequest(reverse.getInputStream()) }
                        reverse.soTimeout = 5000
                        assertEquals(200, control.status("GET", "/playback-info"))
                        assertEquals(0, listener.stopped)
                    }
                    assertFalse(listener.logs.any { it.contains("stage=RESPONSE status=404") })
                }
            }
        } finally { receiver.close() }
    }

    @Test fun blockedReverseWritesDoNotHoldPlaybackOwnershipAndQueuedEventsKeepTheirOrder() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        var blocked: BlockedEventOutput? = null
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
                connect(receiver.port).use { reverse ->
                    reverse.upgradeReverse()
                    val writer = blockReverseOutput(receiver).also { blocked = it }
                    receiver.playbackEvent("playing")
                    assertTrue(writer.entered.await(1, TimeUnit.SECONDS))
                    java.util.concurrent.CompletableFuture.runAsync { receiver.playbackEvent("paused") }
                        .get(500, TimeUnit.MILLISECONDS)
                    val resource = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource("mlhls://app/master.m3u8") }
                    val deadline = System.nanoTime() + 1_000_000_000L
                    while (listener.logs.none { it.startsWith("resource stage=REQUEST ") } && System.nanoTime() < deadline) Thread.sleep(1)
                    assertTrue(listener.logs.any { it.startsWith("resource stage=REQUEST ") })
                    val stopped = java.util.concurrent.CompletableFuture.supplyAsync { control.status("POST", "/stop") }
                    assertEquals(200, stopped.get(500, TimeUnit.MILLISECONDS).toInt())
                    assertNull(resource.get(500, TimeUnit.MILLISECONDS))
                    assertEquals(1, listener.stopped)
                    assertEquals("listening", listener.states.last())
                    connect(receiver.port).use { next ->
                        assertEquals(200, next.status("POST", "/play", "Content-Location: https://example.org/next.mp4\r\n".toByteArray()))
                    }
                    writer.release.countDown()
                    for (state in listOf("playing", "paused", "unhandledURLRequest", "stopped")) {
                        val event = requireNotNull(readReceiverRequest(reverse.getInputStream()))
                        assertEquals("POST", event.method)
                        assertEquals("/event", event.path)
                        assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>$state</string>"))
                    }
                }
            }
        } finally { blocked?.release?.countDown(); receiver.close() }
    }

    @Test fun queuedStoppedEventsCannotReachAReplacementReverseChannelAndCloseDoesNotWaitForItsWriter() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        val blocked = mutableListOf<BlockedEventOutput>()
        try {
            connect(receiver.port).use { control ->
                val play = "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()
                assertEquals(200, control.status("POST", "/play", play))
                connect(receiver.port).use { oldReverse ->
                    oldReverse.upgradeReverse()
                    val oldWriter = blockReverseOutput(receiver).also { blocked.add(it) }
                    receiver.playbackEvent("playing")
                    assertTrue(oldWriter.entered.await(1, TimeUnit.SECONDS))
                    assertEquals(200, java.util.concurrent.CompletableFuture.supplyAsync { control.status("POST", "/stop") }
                        .get(500, TimeUnit.MILLISECONDS).toInt())
                    assertEquals(200, control.status("POST", "/play", play))
                    connect(receiver.port).use { replacement ->
                        replacement.upgradeReverse()
                        oldWriter.release.countDown()
                        receiver.playbackEvent("playing")
                        val event = requireNotNull(readReceiverRequest(replacement.getInputStream()))
                        assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>playing</string>"))
                        replacement.soTimeout = 100
                        assertThrows(java.net.SocketTimeoutException::class.java) { readReceiverRequest(replacement.getInputStream()) }
                        replacement.soTimeout = 5000
                        val currentWriter = blockReverseOutput(receiver).also { blocked.add(it) }
                        receiver.playbackEvent("paused")
                        assertTrue(currentWriter.entered.await(1, TimeUnit.SECONDS))
                        // Leave room for CI scheduling, while remaining below the writer's five-second
                        // block. Close must finish before that writer is released or times out.
                        java.util.concurrent.CompletableFuture.runAsync { receiver.close() }.get(2, TimeUnit.SECONDS)
                        assertEquals(1L, currentWriter.release.count)
                        assertNull(readReceiverRequest(replacement.getInputStream()))
                    }
                }
            }
        } finally { blocked.forEach { it.release.countDown() }; receiver.close() }
    }

    private class Listener(private val onLog: (String) -> Unit = {}) : ReceiverServer.Listener {
        @Volatile var playbackState: ReceiverPlayback? = null
        val images = CopyOnWriteArrayList<ByteArray>()
        override fun photo(bytes: ByteArray) { images.add(bytes) }
        override fun authorizeDevice(verifiedPublicKey: ByteArray?, deviceName: String) = true
        override fun authorizeConnection(sessionToken: String, deviceName: String): Boolean {
            authorizationTokens.add(sessionToken); return true
        }
        val authorizationTokens = CopyOnWriteArrayList<String>()
        val hub = WebVideoHub()
        val items = CopyOnWriteArrayList<ReceiverPlay>()
        val states = CopyOnWriteArrayList<String>()
        val logs = CopyOnWriteArrayList<String>()
        val ended = CountDownLatch(1)
        @Volatile var prepared = 0
        var stopped = 0
        var sought = 0.0
        var speed = 1.0
        override fun prepareMirror() { prepared++ }
        override fun mirrorSink() = WebMediaSink(hub, 1920, 1080, 60)
        override fun play(item: ReceiverPlay) { items.add(item) }
        override fun stopPlayback() { stopped++ }
        override fun seek(seconds: Double) { sought = seconds }
        override fun rate(value: Double) { speed = value }
        override fun playback() = playbackState ?: ReceiverPlayback(100.0, sought, speed, true)
        override fun status(state: String) { states.add(state); if (state == "listening") ended.countDown() }
        override fun log(message: String) { logs.add(message); onLog(message) }
    }

    private fun Socket.send(method: String, path: String, body: ByteArray = ByteArray(0), id: String = "11223344556677889900aabbccddeeff", contentType: String? = null, extraHeaders: String = ""):
        com.shilapi.xcertplay.airplay.RtspMessage.Request {
        val contentHeader = contentType?.let { "Content-Type: $it\r\n" }.orEmpty()
        getOutputStream().write(("$method $path HTTP/1.1\r\nX-Apple-Session-ID: $id\r\n${contentHeader}${extraHeaders}Content-Length: ${body.size}\r\n\r\n").toByteArray() + body)
        return requireNotNull(readReceiverRequest(getInputStream()))
    }
    private fun Socket.status(method: String, path: String, body: ByteArray = ByteArray(0), id: String = "11223344556677889900aabbccddeeff") = send(method, path, body, id).path.toInt()
    private fun connect(port: Int) = Socket(InetAddress.getLoopbackAddress(), port).apply { soTimeout = 5000 }

    @Test fun defaultSessionAliasesCannotShareApprovalOrTakeOverAnotherConnection() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { owner ->
                assertEquals(200, owner.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray(), id = "default"))
                connect(receiver.port).use { contender ->
                    assertEquals(453, contender.status("POST", "/play", "Content-Location: https://example.org/other.mp4\r\n".toByteArray(), id = "default"))
                    assertEquals(403, contender.status("POST", "/stop", id = "default"))
                    assertEquals(403, contender.status("POST", "/rate?value=0", id = "default"))
                    assertEquals(2, listener.authorizationTokens.distinct().size)
                    assertEquals(1, listener.items.size)
                    assertEquals(0, listener.stopped)
                    assertEquals(1.0, listener.speed, 0.0)
                }
            }
        } finally { receiver.close() }
    }

    @Test fun verifiedReverseHandoffKeepsTheOwnersChannelUsableAfterAForeignSameSessionAttempt() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                control.verifyIdentity()
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
                connect(receiver.port).use { approved ->
                    approved.upgradeReverse()
                    Socket(InetAddress.getByName("127.0.0.1"), receiver.port, InetAddress.getByName("127.0.0.2"), 0).use { foreign ->
                        foreign.soTimeout = 5000
                        assertEquals("453", foreign.send("POST", "/reverse", extraHeaders = "Upgrade: PTTH/1.0\r\n").path)
                    }
                    receiver.playbackEvent("paused")
                    assertTrue(readReceiverRequest(approved.getInputStream())!!.body.toString(Charsets.UTF_8).contains("<string>paused</string>"))
                    val url = "mlhls://private/secret.m3u8"
                    val resource = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    val event = readReceiverRequest(approved.getInputStream())!!.body.toString(Charsets.UTF_8)
                    assertTrue(event.contains(url))
                    val id = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>").find(event)!!.groupValues[1].toLong()
                    val answer = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to id, "FCUP_Response_URL" to url,
                        "FCUP_Response_StatusCode" to 200, "FCUP_Response_Data" to byteArrayOf(1, 2),
                    )))
                    assertEquals(200, control.status("POST", "/action", answer))
                    assertArrayEquals(byteArrayOf(1, 2), resource.get(1, TimeUnit.SECONDS)!!.bytes)
                }
            }
        } finally { receiver.close() }
    }

    private fun Socket.verifyIdentity() {
        val curve = AirPlayCrypto.x25519Generate()
        val signing = AirPlayCrypto.ed25519Generate()
        val reply = send("POST", "/pair-verify", byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey).body
        val serverCurve = reply.copyOf(32)
        val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
        val cipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
            AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
        cipher.update(reply.copyOfRange(32, 96))
        assertEquals(200, status("POST", "/pair-verify", ByteArray(4) +
            cipher.update(AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve))))
    }

    @Test fun aForeignReverseChannelWithTheSameSessionCannotReceivePrivateResourceUrlsOrEvents() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        try {
            Socket(InetAddress.getByName("127.0.0.1"), receiver.port, InetAddress.getByName("127.0.0.2"), 0).use { foreign ->
                foreign.soTimeout = 5000
                foreign.upgradeReverse()
                connect(receiver.port).use { control ->
                    assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
                    receiver.playbackEvent("playing")
                    assertNull(receiver.loadResource("mlhls://private/secret.m3u8"))
                    foreign.soTimeout = 100
                    assertThrows(java.net.SocketTimeoutException::class.java) { readReceiverRequest(foreign.getInputStream()) }
                    // The owner's approved session can install its own replacement channel.
                    connect(receiver.port).use { approved ->
                        approved.upgradeReverse()
                        receiver.playbackEvent("playing")
                        assertTrue(readReceiverRequest(approved.getInputStream())!!.body.toString(Charsets.UTF_8).contains("<string>playing</string>"))
                    }
                }
            }
        } finally { receiver.close() }
    }

    @Test fun independentDefaultApprovalsCannotBorrowAReverseChannelOnTheSamePeer() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { reverse ->
                assertEquals("101", reverse.send("POST", "/reverse", id = "default", extraHeaders = "Upgrade: PTTH/1.0\r\n").path)
                connect(receiver.port).use { control ->
                    assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray(), id = "default"))
                    receiver.playbackEvent("playing")
                    assertNull(receiver.loadResource("mlhls://private/secret.m3u8"))
                    reverse.soTimeout = 100
                    assertThrows(java.net.SocketTimeoutException::class.java) { readReceiverRequest(reverse.getInputStream()) }
                    reverse.close()
                    assertEquals(200, control.status("GET", "/playback-info", id = "default"))
                    assertEquals(0, listener.stopped)
                }
            }
        } finally { receiver.close() }
    }

    @Test fun unapprovedLegacyConnectionsCannotOwnMediaOrInstallAReverseChannel() {
        val listener = Listener()
        val guarded = object : ReceiverServer.Listener by listener {
            override fun authorizeDevice(verifiedPublicKey: ByteArray?, deviceName: String) = false
            override fun authorizeConnection(sessionToken: String, deviceName: String) = false
        }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), guarded)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("GET", "/info"))
                assertEquals(200, control.status("GET", "/playback-info"))
                assertEquals(403, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
                assertEquals(403, control.status("PUT", "/photo", byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte())))
                assertEquals("403", control.send("POST", "/reverse", extraHeaders = "Upgrade: PTTH/1.0\r\n").path)
                assertTrue(listener.items.isEmpty())
                assertTrue(listener.images.isEmpty())
            }
        } finally { receiver.close() }
    }

    @Test fun photoReverseEventsUsePhotoCategoryAndReleaseWithAnIdempotentStop() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        try {
            connect(receiver.port).use { reverse ->
                reverse.upgradeReverse()
                connect(receiver.port).use { control ->
                    assertEquals(200, control.status("PUT", "/photo", byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte())))
                    val event = readReceiverRequest(reverse.getInputStream())!!
                    assertTrue(event.body.toString(Charsets.UTF_8).contains("<key>category</key><string>photo</string>"))
                    assertEquals(200, control.status("POST", "/stop"))
                    assertTrue(readReceiverRequest(reverse.getInputStream())!!.body.toString(Charsets.UTF_8).contains("<string>stopped</string>"))
                    assertEquals(200, control.status("POST", "/stop"))
                }
            }
        } finally { receiver.close() }
    }

    @Test fun remoteVolumeRemainsAnIgnoredCompatibilityParameter() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                for (value in listOf("-144.0", "-30.0", "0.0")) {
                    assertEquals("200", control.send("SET_PARAMETER", "/", "volume: $value\r\n".toByteArray(),
                        contentType = "text/parameters").path)
                    assertEquals("volume: 0.0\r\n", control.send("GET_PARAMETER", "/", "volume\r\n".toByteArray(),
                        contentType = "text/parameters").body.toString(Charsets.US_ASCII))
                }
                assertTrue(listener.items.isEmpty())
                assertTrue(listener.images.isEmpty())
                assertEquals(1.0, listener.speed, 0.0)
                assertEquals(0, listener.stopped)
            }
        } finally { receiver.close() }
    }

    @Test fun photoCacheMissRequestsReuploadAndCacheOnlyStopDoesNotLeaveStaleAssets() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                val jpeg = ByteArray(2 * 1024 * 1024).apply { this[0] = 0xff.toByte(); this[1] = 0xd8.toByte() }
                assertEquals("412", control.send("PUT", "/photo", extraHeaders = "X-Apple-AssetAction: displayCached\r\nX-Apple-AssetKey: missing\r\n").path)
                assertEquals("200", control.send("PUT", "/photo", jpeg,
                    extraHeaders = "X-Apple-AssetAction: cacheOnly\r\nX-Apple-AssetKey: image\r\n").path)
                assertTrue(listener.images.isEmpty())
                assertEquals(200, control.status("POST", "/stop"))
                assertEquals(200, control.status("POST", "/stop"))
                assertEquals("412", control.send("PUT", "/photo", extraHeaders = "X-Apple-AssetAction: displayCached\r\nX-Apple-AssetKey: image\r\n").path)
                assertEquals("200", control.send("PUT", "/photo", jpeg).path)
                assertArrayEquals(jpeg, listener.images.single())
                assertEquals("photo", listener.states.last())
                assertEquals(200, control.status("POST", "/stop"))
                val info = control.send("GET", "/playback-info")
                assertEquals("200", info.path)
                assertTrue(info.body.toString(Charsets.UTF_8).contains("<key>readyToPlay</key><integer>0</integer>"))
                assertTrue(listener.logs.any { it.contains("photo stage=CACHE_MISS") })
            }
        } finally { receiver.close() }
    }

    @Test fun playbackPreparationAcknowledgesBeforeReadyAndKeepsStateQueriesAvailable() {
        val listener = Listener().apply { playbackState = ReceiverPlayback(buffering = true) }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("GET", "/playback-info"))
                val play = java.util.concurrent.CompletableFuture.supplyAsync {
                    control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray())
                }
                assertEquals(200, play.get(1, TimeUnit.SECONDS).toInt())
                assertEquals(1, listener.items.size)
                assertFalse(listener.playback().ready)
                val loading = control.send("GET", "/playback-info")
                assertEquals("200", loading.path)
                assertTrue(loading.body.toString(Charsets.UTF_8).contains("<key>readyToPlay</key><integer>0</integer>"))
                connect(receiver.port).use { probe ->
                    assertEquals(200, probe.status("GET", "/playback-info"))
                    assertEquals(403, probe.status("GET", "/playback-info", id = "foreign"))
                }
                listener.playbackState = ReceiverPlayback(duration = 120.0, ready = true)
                val ready = control.send("GET", "/playback-info")
                assertEquals("200", ready.path)
                assertTrue(ready.body.toString(Charsets.UTF_8).contains("<key>readyToPlay</key><integer>1</integer>"))
            }
        } finally { receiver.close() }
    }

    @Test fun playAcknowledgementDoesNotWaitForItsAppResourceProbe() {
        val listener = Listener().apply { playbackState = ReceiverPlayback(buffering = true) }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                connect(receiver.port).use { reverse ->
                    reverse.upgradeReverse()
                    val url = "minibili://test/master.m3u8"
                    val play = java.util.concurrent.CompletableFuture.supplyAsync {
                        control.status("POST", "/play", BplistCodec.encode(mapOf("Content-Location" to url)))
                    }
                    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
                    while (listener.items.isEmpty() && System.nanoTime() < deadline) Thread.sleep(1)
                    assertEquals(1, listener.items.size)
                    // The browser cannot become ready until the app-owned resource is delivered.
                    val resource = java.util.concurrent.CompletableFuture.supplyAsync {
                        receiver.loadResource(url)?.also {
                            listener.playbackState = ReceiverPlayback(duration = 10.0, ready = true)
                        }
                    }
                    val event = requireNotNull(readReceiverRequest(reverse.getInputStream()))
                    val xml = event.body.toString(Charsets.UTF_8)
                    assertTrue(xml.contains("<string>unhandledURLRequest</string>"))
                    val requestId = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>")
                        .find(xml)!!.groupValues[1].toLong()
                    reverse.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    // This sender services app resources only after /play is acknowledged.
                    assertEquals(200, play.get(1, TimeUnit.SECONDS).toInt())
                    assertFalse(listener.playback().ready)
                    assertFalse(resource.isDone)
                    val bytes = "#EXTM3U\n#EXT-X-ENDLIST\n".toByteArray()
                    val answer = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to requestId, "FCUP_Response_URL" to url,
                        "FCUP_Response_Data" to bytes, "FCUP_Response_StatusCode" to 0,
                    )))
                    assertEquals(200, control.status("POST", "/action", answer))
                    assertArrayEquals(bytes, resource.get(2, TimeUnit.SECONDS)!!.bytes)
                    val ready = control.send("GET", "/playback-info")
                    assertEquals("200", ready.path)
                    assertTrue(ready.body.toString(Charsets.UTF_8).contains("<key>readyToPlay</key><integer>1</integer>"))
                    assertEquals(200, control.status("POST", "/stop"))
                    assertEquals(1, listener.stopped)
                }
            }
        } finally { receiver.close() }
    }

    @Test fun oversizedEndpointBodyGetsAnExplicitErrorBeforeItIsAllocatedOrRead() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        try {
            connect(receiver.port).use { socket ->
                socket.getOutputStream().write("PUT /photo HTTP/1.1\r\nContent-Length: ${ReceiverPhotos.MAX_IMAGE_BYTES + 1}\r\n\r\n".toByteArray())
                val reply = readReceiverRequest(socket.getInputStream())!!
                assertEquals("413", reply.path)
                assertEquals("close", reply.headers["connection"])
                assertNull(readReceiverRequest(socket.getInputStream()))
            }
        } finally { receiver.close() }
    }

    @Test fun unsupportedBrowserMirrorRejectsNewSetupWithoutGrantingOwnership() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(),
            mirrorEnabled = false), Listener())
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(461, control.status("SETUP", "/", BplistCodec.encode(mapOf("streams" to listOf(
                    mapOf("type" to 110, "streamConnectionID" to 123L),
                )))))
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\n".toByteArray()))
            }
        } finally { receiver.close() }
    }

    @Test fun browserResizeKeepsActiveOwnershipAndChangesFutureDisplayOffer() {
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), Listener())
        receiver.start()
        try {
            val config = receiver.updateDisplaySize(1280, 800)
            assertEquals(1280, config.width)
            assertEquals(800, config.height)
            assertThrows(IllegalArgumentException::class.java) { receiver.updateDisplaySize(1279, 800) }
        } finally { receiver.close() }
    }

    @Test fun browserAudioChangesGateTheNextSetupWithoutRetiringCurrentAudio() {
        val listener = Listener()
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate(), audioOutputFormats = 1L shl 23)
        val receiver = ReceiverServer(config, listener,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> ByteArray(16) })
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                control.authenticateMirror()
                assertEquals(200, control.status("SETUP", "/", BplistCodec.encode(mapOf(
                    "eiv" to ByteArray(16), "ekey" to ByteArray(72), "timingPort" to 0,
                ))))
                fun stream(codec: Int, rate: Int = 44100) = BplistCodec.encode(mapOf("streams" to listOf(
                    mapOf("type" to 96, "ct" to codec, "sr" to rate),
                )))
                val setup = control.send("SETUP", "/", stream(4, 48000))
                assertEquals("200", setup.path)
                val port = ((((BplistCodec.decode(setup.body) as Map<*, *>)["streams"] as List<*>).single() as Map<*, *>)["dataPort"] as Number).toInt()
                assertEquals("audio", listener.states.last())
                assertEquals(0L, receiver.updateAudioFormats(0L).audioOutputFormats)
                assertEquals(400, control.status("SETUP", "/", stream(4, 48000)))
                assertEquals(400, control.status("SETUP", "/", stream(8)))
                assertEquals("audio", listener.states.last())
                assertEquals(0, listener.stopped)
                assertThrows(BindException::class.java) {
                    DatagramSocket(null).use { it.bind(InetSocketAddress(InetAddress.getByName("::"), port)) }
                }
                receiver.updateAudioFormats(1L shl 18)
                assertEquals(200, control.status("SETUP", "/", stream(2)))
                assertEquals(400, control.status("SETUP", "/", stream(2, 48000)))
                receiver.updateAudioFormats(1L shl 24)
                assertEquals(200, control.status("SETUP", "/", stream(8)))
                assertEquals(200, control.status("OPTIONS", "/"))
                assertThrows(IllegalArgumentException::class.java) { receiver.updateAudioFormats(1L shl 26) }
            }
        } finally { receiver.close() }
    }

    /** Shared real pairing fixture; native FairPlay is supplied by each server's existing test seam. */
    private fun Socket.authenticateMirror(): ByteArray {
        val curve = AirPlayCrypto.x25519Generate()
        val signing = AirPlayCrypto.ed25519Generate()
        val reply = send("POST", "/pair-verify", byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey).body
        val serverCurve = reply.copyOf(32)
        val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
        val verifyCipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
            AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
        verifyCipher.update(reply.copyOfRange(32, 96))
        assertEquals(200, status("POST", "/pair-verify", ByteArray(4) +
            verifyCipher.update(AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve))))
        fun fairPlay(size: Int, sequence: Int) = ByteArray(size).apply {
            byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, sequence.toByte(), 0).copyInto(this)
            ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
        }
        assertEquals(142, send("POST", "/fp-setup", fairPlay(16, 1)).body.size)
        assertEquals(32, send("POST", "/fp-setup", fairPlay(164, 3)).body.size)
        return secret
    }

    @Test fun oldMirrorPreparationCannotStopANewUrlPlayback() =
        preparedTransportDisconnectDoesNotRetireReplacement(mirror = false)

    @Test fun oldMirrorPreparationCannotStopANewMirror() =
        preparedTransportDisconnectDoesNotRetireReplacement(mirror = true)

    @Test fun closingTheCurrentMirrorPreparationReleasesDisplayIntent() =
        preparedTransportDisconnectDoesNotRetireReplacement(mirror = null)

    private fun preparedTransportDisconnectDoesNotRetireReplacement(mirror: Boolean?) {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) },
            fairPlayDecrypt = { _, _ -> ByteArray(16) { (it + 1).toByte() } })
        receiver.start()
        val preparing = connect(receiver.port)
        try {
            preparing.authenticateMirror()
            val setup = BplistCodec.encode(mapOf("eiv" to ByteArray(16), "ekey" to ByteArray(72), "timingPort" to 0))
            assertEquals(200, preparing.status("SETUP", "/", setup))
            assertEquals(1, listener.prepared)
            assertTrue(listener.states.isEmpty())
            if (mirror == null) {
                preparing.close()
                awaitConnectionCount(receiver, 0)
                assertEquals(listOf("listening"), listener.states.toList())
                assertEquals(0, listener.stopped)
                return
            }
            connect(receiver.port).use { replacement ->
                // Another control connection can claim actual media while this transport is only prepared.
                if (mirror) {
                    replacement.authenticateMirror()
                    assertEquals(200, replacement.status("SETUP", "/", setup))
                    assertEquals(200, replacement.status("SETUP", "/", BplistCodec.encode(mapOf("streams" to
                        listOf(mapOf("type" to 110, "streamConnectionID" to 4321L))))))
                    assertEquals("mirror", listener.states.last())
                } else {
                    assertEquals(200, replacement.status("POST", "/play",
                        "Content-Location: https://example.org/next.mp4\r\n".toByteArray()))
                    assertEquals("video", listener.states.last())
                }
                val states = listener.states.toList()
                preparing.close()
                awaitConnectionCount(receiver, 1)
                assertEquals(states, listener.states.toList())
                assertEquals(0, listener.stopped)
                assertEquals(200, replacement.status("GET", "/info"))
            }
        } finally { preparing.close(); receiver.close() }
    }

    private fun awaitConnectionCount(receiver: ReceiverServer, expected: Int) {
        val sockets = ReceiverServer::class.java.getDeclaredField("sockets").apply { isAccessible = true }
            .get(receiver) as Set<*>
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (sockets.size != expected && System.nanoTime() < deadline) Thread.sleep(1)
        assertEquals("Preparing connection completed cleanup", expected, sockets.size)
    }

    @Test fun videoControlAndReverseEventsBelongToTheirSessionAndShutdownClosesSockets() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("GET", "/info"))
                assertTrue(listener.logs.any { it.contains("method=GET path=/info bodyBytes=0") })
                assertEquals(404, control.status("GET", "/unknown"))
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\nStart-Position: 0\r\n".toByteArray()))
                assertEquals(1, listener.items.size)
                assertTrue(listener.logs.any { it.contains("video stage=START start=0.0 fraction=true") })
                assertEquals(403, control.status("POST", "/stop", id = "another"))
                assertEquals(0, listener.stopped)
                assertEquals(200, control.status("POST", "/scrub?position=12.5"))
                assertEquals(12.5, listener.sought, 0.0)
                for (rate in listOf(0.0, 0.25, 1.0, 1.5, 4.0)) {
                    assertEquals(200, control.status("POST", "/rate?value=$rate"))
                    assertEquals(rate, listener.speed, 0.0)
                }
                for (rate in listOf("NaN", "Infinity", "-1", "0.24", "4.01")) {
                    assertEquals(400, control.status("POST", "/rate?value=$rate"))
                    assertEquals(4.0, listener.speed, 0.0)
                }
                assertTrue(listener.logs.any { it.contains("exception=IllegalArgumentException") })
                assertFalse(listener.logs.any { it.contains("example.org") || it.contains("value=NaN") })
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: 11223344556677889900aabbccddeeff\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    receiver.playbackEvent("playing")
                    val event = readReceiverRequest(reverse.getInputStream())!!
                    assertEquals("POST", event.method); assertEquals("/event", event.path)
                    assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>playing</string>"))
                    assertEquals(200, control.status("POST", "/stop"))
                    assertEquals(1, listener.stopped)
                    assertTrue(listener.logs.any { it.contains("video stage=FINISH reason=iphone-stop") })
                    assertEquals("listening", listener.states.last())
                    // Shutdown intentionally does not drain the asynchronous event writer.
                    val stopped = requireNotNull(readReceiverRequest(reverse.getInputStream()))
                    assertTrue(stopped.body.toString(Charsets.UTF_8).contains("<string>stopped</string>"))
                    receiver.close()
                    assertNull(readReceiverRequest(reverse.getInputStream()))
                }
            }
        } finally { receiver.close() }
    }

    @Test fun playbackFinishLogsDistinguishBrowserEndsReverseDisconnectAndShutdown() {
        for (reason in listOf(ReceiverServer.PlaybackFinishReason.BROWSER_ENDED,
            ReceiverServer.PlaybackFinishReason.BROWSER_FAILED, ReceiverServer.PlaybackFinishReason.REVERSE_CLOSE,
            ReceiverServer.PlaybackFinishReason.SHUTDOWN)) {
            val listener = Listener()
            val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
            receiver.start()
            try {
                connect(receiver.port).use { control ->
                    assertEquals(200, control.status("POST", "/play",
                        "Content-Location: https://private-host/movie.mp4?token=secret\r\nStart-Position-Seconds: 12.5\r\n".toByteArray()))
                    when (reason) {
                        ReceiverServer.PlaybackFinishReason.REVERSE_CLOSE -> {
                            connect(receiver.port).use { it.upgradeReverse() }
                            assertTrue(listener.ended.await(1, TimeUnit.SECONDS))
                        }
                        ReceiverServer.PlaybackFinishReason.SHUTDOWN -> receiver.close()
                        else -> receiver.finishPlayback(reason)
                    }
                    assertEquals(1, listener.stopped)
                    assertTrue(listener.logs.any { it.contains("video stage=START start=12.5 fraction=false") })
                    val finishes = listener.logs.filter { it.contains("video stage=FINISH") }
                    assertEquals(1, finishes.size)
                    assertTrue(finishes.single().contains("reason=${reason.wire}"))
                    if (reason == ReceiverServer.PlaybackFinishReason.REVERSE_CLOSE) assertFalse(finishes.single().endsWith("reverse=0"))
                    assertFalse(listener.logs.joinToString().contains("private-host"))
                    assertFalse(listener.logs.joinToString().contains("secret"))
                }
            } finally { receiver.close() }
        }
    }

    @Test fun encryptedMirrorUsesIndependentKeyAndGeometryAndControlDisconnectEndsStream() = encryptedMirrorProbe(false)

    @Test fun explicitMirrorTeardownRestoresTheRetainedDisplay() = encryptedMirrorProbe(true)

    @Test fun mirrorDataEofKeepsControlAndTimingUntilTeardownAndAllowsAnotherSetup() = encryptedMirrorProbe(false, true)

    @Test fun combinedAudioAndMirrorSetupHasRealUdpPortsAndAudioTeardownKeepsThePicture() =
        encryptedMirrorProbe(false, audioDrain = true)

    @Test fun mirrorEofWithAudioStillRunningKeepsSessionOwnershipUntilTeardown() =
        encryptedMirrorProbe(false, dataEofRecovery = true, audioDrain = true)

    @Test fun sleepResumeWithRepeatedConfigurationKeepsThePredictionChainAndCipherPosition() =
        encryptedMirrorProbe(false, sleepResume = true)

    @Test fun packetBoundaryReconnectKeepsTheSamePortPredictionChainAndPartialCtrBlock() =
        encryptedMirrorProbe(false, dataSocketResume = true)

    @Test fun partialMirrorHeaderEndsImmediatelyInsteadOfReusingUnknownFraming() =
        encryptedMirrorProbe(false, partialHeader = true)

    private fun encryptedMirrorProbe(teardown: Boolean, dataEofRecovery: Boolean = false, audioDrain: Boolean = false,
                                     sleepResume: Boolean = false, dataSocketResume: Boolean = false,
                                     partialHeader: Boolean = false) {
        val identity = AirPlayIdentity.generate()
        val listener = Listener()
        val rawKey = ByteArray(16) { (it + 1).toByte() }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", identity,
            audioOutputFormats = if (audioDrain) 1L shl 22 else 0L), listener,
            fairPlayReply = { ByteArray(if (it.size == 16) 142 else 32) }, fairPlayDecrypt = { _, _ -> rawKey })
        receiver.start()
        val control = connect(receiver.port)
        try {
            val curve = AirPlayCrypto.x25519Generate()
            val signing = AirPlayCrypto.ed25519Generate()
            val reply = control.send("POST", "/pair-verify", byteArrayOf(1, 0, 0, 0) + curve.publicKey + signing.publicKey).body
            val serverCurve = reply.copyOf(32)
            val secret = AirPlayCrypto.x25519Shared(curve.privateKey, serverCurve)
            val verifyCipher = aesCtr(AirPlayCrypto.sha512("Pair-Verify-AES-Key".toByteArray(), secret).copyOf(16),
                AirPlayCrypto.sha512("Pair-Verify-AES-IV".toByteArray(), secret).copyOf(16))
            verifyCipher.update(reply.copyOfRange(32, 96))
            assertEquals(200, control.status("POST", "/pair-verify", ByteArray(4) + verifyCipher.update(AirPlayCrypto.ed25519Sign(signing.privateKey, curve.publicKey + serverCurve))))
            fun fairPlay(size: Int, sequence: Int) = ByteArray(size).apply {
                byteArrayOf(0x46, 0x50, 0x4c, 0x59, 3, 1, sequence.toByte(), 0).copyInto(this)
                java.nio.ByteBuffer.wrap(this, 8, 4).putInt(size - 12)
            }
            assertEquals(142, control.send("POST", "/fp-setup", fairPlay(16, 1)).body.size)
            assertEquals(32, control.send("POST", "/fp-setup", fairPlay(164, 3)).body.size)
            val setup = mapOf("eiv" to ByteArray(16), "ekey" to ByteArray(72), "timingPort" to 0)
            val initialSetup = control.send("SETUP", "rtsp://receiver/stream", BplistCodec.encode(setup))
            assertEquals("200", initialSetup.path)
            val initialPorts = BplistCodec.decode(initialSetup.body) as Map<*, *>
            assertEquals(0, (initialPorts["eventPort"] as Number).toInt())
            assertTrue((initialPorts["timingPort"] as Number).toInt() > 0)
            connect(receiver.port).use { probe ->
                // Key/timing-only negotiation has no media lease, so another control session is not busy.
                assertEquals(200, probe.status("SETUP", "/", BplistCodec.encode(emptyMap<String, Any?>())))
            }
            assertEquals(200, control.status("GET", "/info"))
            val volume = control.send("GET_PARAMETER", "rtsp://receiver/stream", "volume\r\n".toByteArray(), contentType = "text/parameters")
            assertEquals("200", volume.path)
            assertEquals("text/parameters", volume.headers["content-type"])
            assertEquals("volume: 0.0\r\n", volume.body.toString(Charsets.US_ASCII))
            assertEquals("volume: 0.0\r\n", control.send("GET_PARAMETER", "rtsp://receiver/stream",
                "volume\r\n".toByteArray()).body.toString(Charsets.US_ASCII))
            val requested = listOf(mapOf("type" to 110, "streamConnectionID" to 1234L)) +
                if (audioDrain) listOf(mapOf("type" to 96, "ct" to 4, "audioFormat" to 0x400000L, "spf" to 1024)) else emptyList()
            val stream = BplistCodec.decode(control.send("SETUP", "/", BplistCodec.encode(mapOf("streams" to requested))).body) as Map<*, *>
            val ports = (stream["streams"] as List<*>).map { it as Map<*, *> }
            val port = (ports.single { (it["type"] as Number).toInt() == 110 }["dataPort"] as Number).toInt()
            val audioPorts = ports.find { (it["type"] as Number).toInt() == 96 }?.let {
                listOf((it["dataPort"] as Number).toInt(), (it["controlPort"] as Number).toInt())
            }.orEmpty()
            for (audioPort in audioPorts) {
                try {
                    DatagramSocket(null).use { it.bind(InetSocketAddress(InetAddress.getByName("::"), audioPort)) }
                    fail("Advertised audio port must already be bound")
                } catch (_: BindException) { /* Receiver owns the real UDP port. */ }
            }
            val subscription = listener.hub.subscribe()
            connect(port).use { data ->
                fun packet(op: Int, body: ByteArray, flag: Int = 0): ByteArray {
                    val header = ByteBuffer.allocate(128).order(ByteOrder.LITTLE_ENDIAN)
                    header.putInt(0, body.size); header.put(4, op.toByte()); header.putFloat(56, 720f); header.putFloat(60, 1280f)
                    header.put(6, flag.toByte())
                    return header.array() + body
                }
                val avcc = ReceiverSdrFixtures.avcc()
                data.getOutputStream().write(packet(1, avcc))
                assertNotNull(subscription.take(5000))
                assertEquals(720, listener.hub.info()!!.width)
                assertTrue(listener.logs.any { it.contains("mirror stage=CONFIG codec=H264") })
                val mirrorKey = AirPlayCrypto.sha512(rawKey, secret).copyOf(16)
                val encryption = aesCtr(AirPlayCrypto.sha512("AirPlayStreamKey1234".toByteArray(), mirrorKey).copyOf(16),
                    AirPlayCrypto.sha512("AirPlayStreamIV1234".toByteArray(), mirrorKey).copyOf(16))
                val first = byteArrayOf(0, 0, 0, 3, 0x65, 1, 2)
                val second = byteArrayOf(0, 0, 0, 2, 0x41, 1)
                data.getOutputStream().write(packet(0, encryption.update(first)) + packet(0, encryption.update(second)))
                assertNotNull(subscription.take(5000)); assertNotNull(subscription.take(5000))
                if (sleepResume) {
                    val epoch = listener.hub.info()!!.epoch
                    data.getOutputStream().write(packet(1, avcc, 0x56) +
                        packet(0, encryption.update(second)) + packet(1, avcc, 0x16) +
                        packet(0, encryption.update(second)))
                    assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, subscription.take(5000)!!.kind)
                    assertEquals(epoch, listener.hub.info()!!.epoch)
                }
                if (dataSocketResume) {
                    val epoch = listener.hub.info()!!.epoch
                    data.close()
                    connect(port).use { resumed ->
                        // Seven + six ciphertext bytes before EOF leave a partial CTR block.
                        // Continue that same cipher across the next six bytes without another CONFIG.
                        resumed.getOutputStream().write(packet(0, encryption.update(second)))
                        val frame = requireNotNull(subscription.take(5000))
                        assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, frame.kind)
                        assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0x41, 1), frame.payload)
                        assertEquals(epoch, listener.hub.info()!!.epoch)
                        assertTrue(listener.logs.any { it.contains("stage=RECONNECT") })
                        assertEquals(200, control.status("TEARDOWN", "/"))
                    }
                } else if (partialHeader) {
                    data.getOutputStream().write(byteArrayOf(1, 2, 3))
                    data.close()
                    assertTrue(listener.ended.await(1, TimeUnit.SECONDS))
                    assertFalse(listener.logs.any { it.contains("stage=RECONNECT") })
                    assertNull(listener.hub.info())
                    assertEquals(200, control.status("TEARDOWN", "/"))
                } else if (audioDrain && !dataEofRecovery) {
                    assertEquals(200, control.status("TEARDOWN", "/", BplistCodec.encode(mapOf("streams" to listOf(mapOf("type" to 96))))))
                    assertEquals(200, control.status("OPTIONS", "/"))
                    assertNotNull(listener.hub.info())
                    assertFalse(listener.logs.any { it.contains("Media clock final:") })
                    for (audioPort in audioPorts) {
                        DatagramSocket(null).use { awaitReleasedUdpPort(it, InetSocketAddress(InetAddress.getByName("::"), audioPort)) }
                    }
                    data.getOutputStream().write(packet(0, encryption.update(second)))
                    assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, subscription.take(5000)!!.kind)
                    assertEquals(200, control.status("TEARDOWN", "/"))
                    assertNull(readReceiverRequest(control.getInputStream()))
                } else if (dataEofRecovery) {
                    data.close()
                    if (audioDrain) {
                        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(7)
                        while ((listener.hub.info() != null || listener.states.lastOrNull() != "audio" ||
                                listener.logs.none { it.contains("Media clock snapshot: reason=VIDEO_END") }) &&
                            System.nanoTime() < deadline) Thread.sleep(5)
                        assertNull(listener.hub.info())
                        assertEquals("audio", listener.states.last())
                    } else assertTrue(listener.ended.await(7, TimeUnit.SECONDS))
                    if (audioDrain) connect(receiver.port).use { competing ->
                        // A competing device has a different session. The same approved strong
                        // ID is intentionally allowed to hand off among this sender's connections.
                        assertEquals(453, competing.status("SETUP", "/", BplistCodec.encode(mapOf("streams" to listOf(
                            mapOf("type" to 110, "streamConnectionID" to 999L),
                        ))), id = "ffeeddccbbaa00998877665544332211"))
                    }
                    assertNull(listener.hub.info())
                    assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_IDLE, subscription.take(5000)!!.kind)
                    assertEquals(200, control.status("OPTIONS", "/"))
                    assertEquals(200, control.status("POST", "/feedback"))
                    assertTrue(listener.logs.any { it.contains("Media clock snapshot: reason=VIDEO_END") })
                    assertFalse("Data EOF must not close the session timing clock", listener.logs.any { it.contains("Media clock final:") })
                    val nextSetup = control.send("SETUP", "/", BplistCodec.encode(mapOf("streams" to listOf(
                        mapOf("type" to 110, "streamConnectionID" to 1235L),
                    ))))
                    assertEquals("200", nextSetup.path)
                    val nextPorts = BplistCodec.decode(nextSetup.body) as Map<*, *>
                    val nextPort = (((nextPorts["streams"] as List<*>).single() as Map<*, *>)["dataPort"] as Number).toInt()
                    connect(nextPort).use { nextData ->
                        nextData.getOutputStream().write(packet(1, avcc))
                        assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_CONFIG, subscription.take(5000)!!.kind)
                        assertEquals(720, listener.hub.info()!!.width)
                        val nextEncryption = aesCtr(AirPlayCrypto.sha512("AirPlayStreamKey1235".toByteArray(), mirrorKey).copyOf(16),
                            AirPlayCrypto.sha512("AirPlayStreamIV1235".toByteArray(), mirrorKey).copyOf(16))
                        nextData.getOutputStream().write(packet(0, nextEncryption.update(first)))
                        assertEquals(com.shilapi.xcertplay.web.WebVideoRecords.KIND_FRAME, subscription.take(5000)!!.kind)
                        assertEquals(200, control.status("TEARDOWN", "/"))
                        assertTrue(listener.logs.any { it.contains("Media clock final:") })
                        assertNull(readReceiverRequest(control.getInputStream()))
                    }
                } else if (teardown) assertEquals(200, control.status("TEARDOWN", "/")) else control.close()
                assertTrue(listener.ended.await(5, TimeUnit.SECONDS))
                assertNull(listener.hub.info())
            }
            subscription.close()
        } finally { control.close(); receiver.close() }
    }

    @Test fun parallelIphoneResourceLoadsSendTheNextEventOnlyAfterTheActionResponse() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("POST", "/play", BplistCodec.encode(mapOf("Content-Location" to "mlhls://app/master.m3u8"))))
                connect(receiver.port).use { reverse ->
                    reverse.upgradeReverse()
                    val urls = listOf("mlhls://app/video.m3u8", "mlhls://app/audio.m3u8")
                    val first = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(urls[0]) }
                    val firstXml = readReceiverRequest(reverse.getInputStream())!!.body.toString(Charsets.UTF_8)
                    val idPattern = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>")
                    val firstId = idPattern.find(firstXml)!!.groupValues[1].toLong()
                    val second = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(urls[1]) }
                    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
                    while (listener.logs.count { it.startsWith("resource stage=QUEUED ") } < 2 && System.nanoTime() < deadline) Thread.sleep(1)
                    assertEquals(2, listener.logs.count { it.startsWith("resource stage=QUEUED ") })
                    reverse.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    reverse.soTimeout = 100
                    assertThrows(java.net.SocketTimeoutException::class.java) { readReceiverRequest(reverse.getInputStream()) }
                    reverse.soTimeout = 5000
                    fun answer(id: Long, url: String) = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to id, "FCUP_Response_URL" to url,
                        "FCUP_Response_Data" to byteArrayOf(1), "FCUP_Response_StatusCode" to 0,
                    )))
                    assertEquals(200, control.status("POST", "/action", answer(firstId, urls[0])))
                    assertArrayEquals(byteArrayOf(1), first.get(2, TimeUnit.SECONDS)!!.bytes)
                    val secondXml = readReceiverRequest(reverse.getInputStream())!!.body.toString(Charsets.UTF_8)
                    val secondId = idPattern.find(secondXml)!!.groupValues[1].toLong()
                    assertNotEquals(firstId, secondId)
                    assertTrue(secondXml.contains(urls[1]))
                    assertEquals(200, control.status("POST", "/action", answer(secondId, urls[1])))
                    assertArrayEquals(byteArrayOf(1), second.get(2, TimeUnit.SECONDS)!!.bytes)
                    assertEquals(2, listener.logs.count { it.startsWith("resource stage=REQUEST ") })
                }
            }
        } finally { receiver.close() }
    }

    @Test fun seekCancellationKeepsTheIphoneExchangeForTheReplacementLoader() {
        val replacementAcquired = CountDownLatch(1)
        val listener = Listener { message ->
            if (message.startsWith("resource stage=REUSED ")) replacementAcquired.countDown()
        }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                val url = "mlhls://app/master.m3u8"
                assertEquals(200, control.status("POST", "/play", BplistCodec.encode(mapOf("Content-Location" to url))))
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: 11223344556677889900aabbccddeeff\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    val interrupted = java.util.concurrent.atomic.AtomicBoolean(false)
                    val oldLoader = Thread {
                        assertNull(receiver.loadResource(url))
                        interrupted.set(Thread.currentThread().isInterrupted)
                    }
                    oldLoader.start()
                    val xml = readReceiverRequest(reverse.getInputStream())!!.body.toString(Charsets.UTF_8)
                    val requestId = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>").find(xml)!!.groupValues[1].toLong()
                    oldLoader.interrupt()
                    oldLoader.join(2000)
                    assertFalse(oldLoader.isAlive)
                    assertTrue(interrupted.get())
                    val replacement = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    // A response before the replacement acquires the exchange retires it legitimately.
                    assertTrue("Replacement loader must join the pending request", replacementAcquired.await(2, TimeUnit.SECONDS))
                    val bytes = "#EXTM3U\n#EXT-X-ENDLIST\n".toByteArray()
                    val answer = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to requestId, "FCUP_Response_URL" to url,
                        "FCUP_Response_Data" to bytes, "FCUP_Response_StatusCode" to 0,
                    )))
                    assertEquals(200, control.status("POST", "/action", answer))
                    assertArrayEquals(bytes, replacement.get(2, TimeUnit.SECONDS)!!.bytes)
                    assertEquals(1, listener.logs.count { it.startsWith("resource stage=REQUEST ") })
                    assertTrue(listener.logs.any { it == "resource stage=REUSED request=$requestId" })
                    assertEquals(404, control.status("POST", "/action", answer))
                }
            }
        } finally { receiver.close() }
    }

    @Test fun iphoneResourcesAreCorrelatedAndReverseDisconnectCancelsWaitingLoadsAndRestoresDisplay() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                val url = "mlhls://app/master.m3u8"
                assertEquals(200, control.status("POST", "/play", BplistCodec.encode(mapOf("Content-Location" to url))))
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: 11223344556677889900aabbccddeeff\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    val future = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    val event = readReceiverRequest(reverse.getInputStream())!!
                    val xml = event.body.toString(Charsets.UTF_8)
                    assertTrue(xml.contains("<string>unhandledURLRequest</string>"))
                    val requestId = Regex("<key>FCUP_Response_RequestID</key><integer>([0-9]+)</integer>").find(xml)!!.groupValues[1].toLong()
                    val bytes = "#EXTM3U\n#EXT-X-ENDLIST\n".toByteArray()
                    val answer = BplistCodec.encode(mapOf("type" to "unhandledURLResponse", "params" to mapOf(
                        "FCUP_Response_RequestID" to requestId, "FCUP_Response_URL" to url,
                        "FCUP_Response_Data" to bytes, "FCUP_Response_StatusCode" to 0,
                    )))
                    assertEquals(403, control.status("POST", "/action", answer, "wrong-session"))
                    assertFalse(future.isDone)
                    assertEquals(200, control.status("POST", "/action", answer))
                    assertArrayEquals(bytes, future.get(2, TimeUnit.SECONDS)!!.bytes)
                    assertNull(receiver.loadResource("skd://protected"))
                    val pending = java.util.concurrent.CompletableFuture.supplyAsync { receiver.loadResource(url) }
                    assertNotNull(readReceiverRequest(reverse.getInputStream()))
                    reverse.close()
                    assertNull(pending.get(2, TimeUnit.SECONDS))
                    assertTrue(listener.ended.await(2, TimeUnit.SECONDS))
                    assertEquals("listening", listener.states.last())
                }
            }
        } finally { receiver.close() }
    }
}
