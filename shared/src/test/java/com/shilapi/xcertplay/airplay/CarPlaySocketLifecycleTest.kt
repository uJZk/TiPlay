package com.shilapi.xcertplay.airplay

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class CarPlaySocketLifecycleTest {
    @Test fun initialSetupRetriesAreStrictAndPreserveTheEstablishedEventCipherAndAudio() {
        ServerSocket(0, 1, InetAddress.getByName("::1")).use { controlServer ->
            connect(controlServer.localPort).use { peer ->
                val ready = AtomicInteger()
                val audioSetups = AtomicInteger()
                val ended = AtomicInteger()
                val session = authenticatedSession(listener = readyListener(ready), socket = controlServer.accept(),
                    media = object : AirPlayMediaHandler {
                        override fun onAudio(session: AirPlaySession, type: Int, stream: Map<String, Any?>): Map<String, Any?> {
                            audioSetups.incrementAndGet()
                            return mapOf("dataPort" to 32_000, "controlPort" to 32_001)
                        }
                        override fun onSessionClosed(session: AirPlaySession) { ended.incrementAndGet() }
                    })
                val keys = session.pairVerify.controlKeys!!
                session.cipher = ControlCipher(keys.readKey, keys.writeKey)
                val clientCipher = ControlCipher(keys.writeKey, keys.readKey)
                session.start()
                var timing = 0
                var event = 0
                var keepAlive = 0
                try {
                    val body = BplistCodec.encode(mapOf("timingPort" to 0, "keepAliveLowPower" to true))
                    assertEquals("400", setup(peer, clientCipher, null, body).path)
                    val initial = setup(peer, clientCipher, "1", body)
                    assertEquals("200", initial.path)
                    val response = BplistCodec.decode(initial.body) as Map<*, *>
                    timing = (response["timingPort"] as Number).toInt()
                    event = (response["eventPort"] as Number).toInt()
                    keepAlive = (response["keepAlivePort"] as Number).toInt()
                    connect(event).use { eventPeer ->
                        await { ready.get() == 1 }
                        val events = peerCipher(session)
                        assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
                        assertEquals("forceKeyFrame", readCommand(eventPeer, events)["type"])
                        val streamBody = BplistCodec.encode(mapOf("streams" to listOf(mapOf("type" to 100))))
                        assertEquals("200", setup(peer, clientCipher, "2", streamBody).path)
                        assertEquals(1, audioSetups.get())
                        repeat(3) {
                            val replay = setup(peer, clientCipher, "1", body)
                            assertEquals("200", replay.path)
                            assertArrayEquals(initial.body, replay.body)
                            val changed = setup(peer, clientCipher, "1", BplistCodec.encode(mapOf("timingPort" to 1)))
                            assertEquals("455", changed.path)
                            assertEquals("Method Not Valid in This State", changed.protocol)
                            assertEquals("455", setup(peer, clientCipher, "3", body).path)
                            assertEquals("455", setup(peer, clientCipher, "1", body, "/different-session").path)
                            // One peer cipher keeps advancing; neither cache hits nor rejections reset it.
                            assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
                            assertEquals("forceKeyFrame", readCommand(eventPeer, events)["type"])
                            assertEquals(1, ready.get())
                            assertEquals(1, audioSetups.get())
                            assertEquals(0, ended.get())
                            assertFalse(session.isClosed)
                            assertThrows(IOException::class.java) { session.openEvent() }
                        }
                        closeAndJoin(session)
                        assertPeerClosed(eventPeer)
                    }
                    assertUdpPortFree(timing)
                    assertUdpPortFree(keepAlive)
                    assertPeerClosed(peer)
                } finally { closeAndJoin(session) }
            }
        }
    }

    @Test fun repeatedSetupRetiresUnusedListenersAndTheirWorkers() {
        val ready = AtomicInteger()
        val session = authenticatedSession(listener = readyListener(ready))
        try {
            val ports = List(12) { session.openEvent() }
            await { workers(session).size == 1 }
            ports.dropLast(1).forEach(::assertPortClosed)
            connect(ports.last()).use { peer ->
                await { ready.get() == 1 }
                assertPortClosed(ports.last())
                assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
                assertEquals("forceKeyFrame", readCommand(peer, peerCipher(session))["type"])
                assertFalse(session.isClosed)
            }
        } finally { closeAndJoin(session) }
    }

    @Test fun anEstablishedEventEpochRejectsNewListenersWithoutResettingItsCounters() {
        val ready = AtomicInteger()
        val ended = AtomicInteger()
        val session = authenticatedSession(listener = readyListener(ready), media = object : AirPlayMediaHandler {
            override fun onSessionClosed(session: AirPlaySession) { ended.incrementAndGet() }
        })
        try {
            connect(session.openEvent()).use { peer ->
                await { ready.get() == 1 }
                val cipher = peerCipher(session)
                repeat(8) {
                    assertThrows(IOException::class.java) { session.openEvent() }
                    assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
                    assertEquals("forceKeyFrame", readCommand(peer, cipher)["type"])
                    assertEquals(1, ready.get())
                    assertEquals(0, ended.get())
                    assertFalse(session.isClosed)
                }
                val active = workers(session)
                session.close()
                assertPeerClosed(peer)
                active.forEach { it.join(2_000); assertFalse(it.isAlive) }
                assertTrue(workers(session).isEmpty())
                assertEquals(1, ended.get())
            }
        } finally { closeAndJoin(session) }
    }

    @Test fun oldAcceptedSocketCannotPublishAfterTheNextSetupListener() {
        val accepted = CountDownLatch(1)
        val release = CountDownLatch(1)
        val acceptedCount = AtomicInteger()
        val ready = AtomicInteger()
        val session = authenticatedSession(listener = object : AirPlaySessionListener {
            override fun onDebugLog(message: String) {
                if (message.startsWith("airplay event connection accepted") && acceptedCount.incrementAndGet() == 1) {
                    accepted.countDown()
                    awaitGate(release)
                }
                if (message.startsWith("airplay video event ready")) ready.incrementAndGet()
            }
        })
        var old: Socket? = null
        var current: Socket? = null
        try {
            old = connect(session.openEvent())
            assertTrue(accepted.await(2, TimeUnit.SECONDS))
            val nextPort = session.openEvent()
            assertPeerClosed(old)
            current = connect(nextPort)
            await { ready.get() == 1 }
            release.countDown()
            assertPeerClosed(old)
            await { workers(session).size == 1 }
            assertTrue(session.sendCommand(mapOf("type" to "forceKeyFrame")))
            assertEquals("forceKeyFrame", readCommand(current, peerCipher(session))["type"])
            assertFalse(session.isClosed)
        } finally { release.countDown(); closeAndJoin(session); old?.close(); current?.close() }
    }

    @Test fun closingDuringAcceptCannotPublishAnUnownedSocketOrWorker() {
        val accepted = CountDownLatch(1)
        val release = CountDownLatch(1)
        val ended = AtomicInteger()
        val session = authenticatedSession(listener = object : AirPlaySessionListener {
            override fun onDebugLog(message: String) {
                if (message.startsWith("airplay event connection accepted")) {
                    accepted.countDown()
                    awaitGate(release)
                }
            }
            override fun onSessionEnded(session: AirPlaySession) { ended.incrementAndGet() }
        })
        var peer: Socket? = null
        try {
            peer = connect(session.openEvent())
            assertTrue(accepted.await(2, TimeUnit.SECONDS))
            val active = workers(session)
            session.close()
            // Even an observer that temporarily ignores interrupt cannot retain this socket.
            assertPeerClosed(peer)
            release.countDown()
            active.forEach { it.join(2_000); assertFalse(it.isAlive) }
            assertTrue(workers(session).isEmpty())
            assertFalse(session.sendCommand(mapOf("type" to "forceKeyFrame")))
            assertEquals(1, ended.get())
            assertThrows(IOException::class.java) { session.openEvent() }
            assertThrows(IOException::class.java) { session.openKeepAlive() }
        } finally { release.countDown(); closeAndJoin(session); peer?.close() }
    }

    @Test fun keepAliveReplacementFreesEveryOldPortAndStopsItsWorkerWithoutEndingControl() {
        val session = authenticatedSession()
        try {
            var port = session.openKeepAlive()
            repeat(12) {
                val previousThread = field(session, "keepAliveThread") as Thread
                val previousPort = port
                port = session.openKeepAlive()
                previousThread.join(2_000)
                assertFalse("retired UDP receive must exit instead of spinning", previousThread.isAlive)
                assertUdpPortFree(previousPort)
                assertFalse(session.isClosed)
                assertTrue((field(session, "keepAliveThread") as Thread).isAlive)
            }
            val last = field(session, "keepAliveThread") as Thread
            session.close()
            last.join(2_000)
            assertFalse(last.isAlive)
            assertUdpPortFree(port)
        } finally { closeAndJoin(session) }
    }

    @Test fun retainedVideoAvailabilityAdvancesOneEventCipherAndCannotRestartTheEpoch() {
        val ready = AtomicInteger()
        val session = authenticatedSession(listener = readyListener(ready))
        val video = field(session, "videoPlaybackAvailability") as VideoPlaybackAvailability
        video.setFeatureEnabled(true)
        session.setVideoPlaybackAllowed(true)
        try {
            connect(session.openEvent()).use { peer ->
                await { ready.get() == 1 }
                val cipher = peerCipher(session)
                val command = readCommand(peer, cipher)
                assertEquals("setVideoPlaybackAllowed", command["type"])
                assertEquals(true, (command["params"] as Map<*, *>)["videoPlaybackAllowed"])
                assertThrows(IOException::class.java) { session.openEvent() }
                session.setVideoPlaybackAllowed(false)
                assertEquals(false, (readCommand(peer, cipher)["params"] as Map<*, *>)["videoPlaybackAllowed"])
                assertFalse(session.isClosed)
            }
        } finally { closeAndJoin(session) }
    }

    @Test fun closeUnblocksANativeEventWriteWithoutWaitingForTheWriteMonitor() {
        val ready = AtomicInteger()
        val session = authenticatedSession(listener = readyListener(ready))
        var peer: Socket? = null
        var writer: Thread? = null
        var closer: Thread? = null
        val result = AtomicReference<Boolean>()
        val failed = AtomicReference<Throwable>()
        try {
            peer = connect(session.openEvent())
            peer.receiveBufferSize = 1_024
            await { ready.get() == 1 }
            val serverSocket = field(session, "eventSocket") as Socket
            serverSocket.sendBufferSize = 1_024
            val writing = Thread {
                try {
                    result.set(session.sendCommand(mapOf("type" to "slow-peer-probe",
                        "params" to mapOf("data" to ByteArray(4 * 1024 * 1024)))))
                } catch (error: Throwable) { failed.set(error) }
            }.apply { isDaemon = true; start() }
            writer = writing
            await {
                writing.stackTrace.any { frame ->
                    (frame.className.contains("Socket") || frame.className.startsWith("sun.nio.ch.")) &&
                        frame.methodName.contains("write", ignoreCase = true)
                }
            }
            assertTrue(writing.isAlive)
            val closing = Thread { session.close() }.apply { isDaemon = true; start() }
            closer = closing
            closing.join(2_000)
            writing.join(2_000)
            assertFalse("close waited for a writer before closing its native socket", closing.isAlive)
            assertFalse("closing the owned socket must interrupt its blocked write", writing.isAlive)
            assertNull(failed.get())
            assertEquals(false, result.get())
            assertTrue(session.isClosed)
        } finally {
            peer?.close()
            writer?.join(2_000)
            closer?.join(2_000)
            closeAndJoin(session)
        }
    }

    @Test fun usedNonceZeroCannotAuthorizeAgainAndFreshPairVerifyDoesNotAcceptOldCiphertext() {
        val firstReady = AtomicInteger()
        val firstGrants = AtomicInteger()
        val first = authenticatedSession(listener = ownershipListener(firstReady, firstGrants))
        val oldShared = first.sharedSecret!!
        var oldWire = ByteArray(0)
        try {
            connect(first.openEvent()).use { peer ->
                await { firstReady.get() == 1 }
                val cipher = peerCipher(first)
                first.setScreenBorrowed(true)
                assertEquals("changeModes", readCommand(peer, cipher)["type"])
                oldWire = cipher.encrypt(ownerCommand(2, 10))
                peer.getOutputStream().apply { write(oldWire); flush() }
                assertEquals("200", readMessage(peer, cipher).path)
                assertTrue(first.screenBorrowState.confirmedBorrow)
                first.setScreenBorrowed(false)
                assertEquals("changeModes", readCommand(peer, cipher)["type"])
                peer.getOutputStream().apply { write(cipher.encrypt(ownerCommand(1, 11))); flush() }
                assertEquals("200", readMessage(peer, cipher).path)
                assertTrue(first.screenBorrowState.carPlayHasScreen)
                assertEquals(1, firstGrants.get())
                assertThrows(IOException::class.java) { first.openEvent() }
                // The only channel in this epoch has advanced past receive nonce zero.
                val active = workers(first)
                peer.getOutputStream().apply { write(oldWire); flush() }
                await { first.isClosed }
                active.forEach { it.join(2_000); assertFalse(it.isAlive) }
                assertEquals(1, firstGrants.get())
                assertFalse(first.screenBorrowState.confirmedBorrow)
            }
        } finally { closeAndJoin(first) }

        val nextReady = AtomicInteger()
        val nextGrants = AtomicInteger()
        val next = authenticatedSession(listener = ownershipListener(nextReady, nextGrants))
        try {
            assertFalse(oldShared.contentEquals(next.sharedSecret!!))
            connect(next.openEvent()).use { peer ->
                await { nextReady.get() == 1 }
                val cipher = peerCipher(next)
                next.setScreenBorrowed(true)
                readCommand(peer, cipher)
                // A new control session has fresh pair-verify keys, so even its first nonce
                // cannot authenticate the previous control session's captured first command.
                val active = workers(next)
                peer.getOutputStream().apply { write(oldWire); flush() }
                await { next.isClosed }
                active.forEach { it.join(2_000); assertFalse(it.isAlive) }
                assertEquals(0, nextGrants.get())
            }
        } finally { closeAndJoin(next) }

        val freshReady = AtomicInteger()
        val freshGrants = AtomicInteger()
        val fresh = authenticatedSession(listener = ownershipListener(freshReady, freshGrants))
        try {
            connect(fresh.openEvent()).use { peer ->
                await { freshReady.get() == 1 }
                val cipher = peerCipher(fresh)
                fresh.setScreenBorrowed(true)
                readCommand(peer, cipher)
                peer.getOutputStream().apply { write(cipher.encrypt(ownerCommand(2, 1))); flush() }
                assertEquals("200", readMessage(peer, cipher).path)
                assertTrue(fresh.screenBorrowState.confirmedBorrow)
                assertEquals(1, freshGrants.get())
            }
        } finally { closeAndJoin(fresh) }
    }

    private fun authenticatedSession(listener: AirPlaySessionListener = object : AirPlaySessionListener {},
        media: AirPlayMediaHandler = object : AirPlayMediaHandler {}, socket: Socket = Socket()): AirPlaySession {
        val pairings = PairingStore()
        val controller = AirPlayCrypto.ed25519Generate()
        val identifier = "lifecycle-test-controller".asciiBytes()
        pairings.save(identifier.toString(Charsets.US_ASCII), controller.publicKey)
        val session = AirPlaySession(socket, AirPlayConfig("test", "02:00:00:00:00:02",
            "02:00:00:00:00:01", "1.0", main = AirPlayDisplayConfig(800, 480)),
            AirPlayIdentity.generate(), pairings, null, listener, media)
        val ephemeral = AirPlayCrypto.x25519Generate()
        val m2 = Tlv8Codec.decode(session.pairVerify.handle(Tlv8Codec.encode(listOf(
            Tlv8Item(6, byteArrayOf(1)), Tlv8Item(3, ephemeral.publicKey)))))
        val accessoryPublic = m2.getValue(3)
        val shared = AirPlayCrypto.x25519Shared(ephemeral.privateKey, accessoryPublic)
        val encryptionKey = AirPlayCrypto.hkdfSha512(shared, "Pair-Verify-Encrypt-Salt".asciiBytes(),
            "Pair-Verify-Encrypt-Info".asciiBytes())
        val signature = AirPlayCrypto.ed25519Sign(controller.privateKey,
            concatBytes(ephemeral.publicKey, identifier, accessoryPublic))
        val sub = Tlv8Codec.encode(listOf(Tlv8Item(1, identifier), Tlv8Item(10, signature)))
        session.pairVerify.handle(Tlv8Codec.encode(listOf(Tlv8Item(6, byteArrayOf(3)),
            Tlv8Item(5, AirPlayCrypto.chachaSeal(encryptionKey, AirPlayCrypto.nonceLabel("PV-Msg03"), sub)))))
        assertTrue(session.pairVerify.isVerified)
        return session
    }

    private fun readyListener(ready: AtomicInteger) = object : AirPlaySessionListener {
        override fun onDebugLog(message: String) {
            if (message.startsWith("airplay video event ready")) ready.incrementAndGet()
        }
    }

    private fun ownershipListener(ready: AtomicInteger, grants: AtomicInteger) = object : AirPlaySessionListener {
        override fun onDebugLog(message: String) {
            if (message.startsWith("airplay video event ready")) ready.incrementAndGet()
        }
        override fun onScreenBorrowChanged(session: AirPlaySession, state: CarPlayScreenBorrowState) {
            if (state.confirmedBorrow) grants.incrementAndGet()
        }
    }

    private fun setup(socket: Socket, cipher: ControlCipher, cseq: String?, body: ByteArray,
        path: String = "rtsp://localhost/session"): RtspMessage.Request {
        val head = "SETUP $path RTSP/1.0\r\n" + (cseq?.let { "CSeq: $it\r\n" } ?: "") +
            "Content-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.size}\r\n\r\n"
        socket.getOutputStream().apply { write(cipher.encrypt(head.toByteArray(Charsets.US_ASCII) + body)); flush() }
        return readMessage(socket, cipher)
    }

    private fun ownerCommand(entity: Int, cseq: Int): ByteArray {
        val body = BplistCodec.encode(mapOf("type" to "modesChanged", "params" to mapOf(
            "resources" to listOf(mapOf("resourceID" to 1, "entity" to entity)))))
        return ("POST /command RTSP/1.0\r\nCSeq: $cseq\r\n" +
            "Content-Length: ${body.size}\r\n\r\n").toByteArray(Charsets.US_ASCII) + body
    }

    private fun peerCipher(session: AirPlaySession): ControlCipher {
        val shared = session.sharedSecret!!
        return ControlCipher(
            AirPlayCrypto.hkdfSha512(shared, "Events-Salt".asciiBytes(), "Events-Write-Encryption-Key".asciiBytes(), 32),
            AirPlayCrypto.hkdfSha512(shared, "Events-Salt".asciiBytes(), "Events-Read-Encryption-Key".asciiBytes(), 32))
    }

    private fun readCommand(socket: Socket, cipher: ControlCipher): Map<*, *> {
        return BplistCodec.decode(readMessage(socket, cipher).body) as Map<*, *>
    }

    private fun readMessage(socket: Socket, cipher: ControlCipher): RtspMessage.Request {
        val input = socket.getInputStream()
        var encrypted = ByteArray(0)
        val plain = ByteArrayOutputStream()
        val bytes = ByteArray(4096)
        while (true) {
            val count = input.read(bytes)
            check(count >= 0) { "event socket ended before the command" }
            encrypted += bytes.copyOf(count)
            val decoded = cipher.decrypt(encrypted)
            encrypted = decoded.rest
            plain.write(decoded.data)
            val message = RtspMessage.parseMessages(plain.toByteArray()).messages.firstOrNull()
            if (message != null) return message
        }
    }

    private fun connect(port: Int) = Socket().apply {
        connect(InetSocketAddress("::1", port), 1_000)
        soTimeout = 2_000
    }

    private fun assertPortClosed(port: Int) {
        // close() can retire a listener before its native blocked accept releases the endpoint.
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (true) {
            try { connect(port).close() } catch (_: IOException) { return }
            if (System.nanoTime() >= deadline) fail("retired event listener still accepts connections on $port")
            Thread.yield()
        }
    }

    private fun assertPeerClosed(socket: Socket) {
        try { assertEquals(-1, socket.getInputStream().read()) }
        catch (error: java.net.SocketTimeoutException) { throw AssertionError("retired socket is still open", error) }
        catch (_: IOException) { /* TCP reset is also an actual close. */ }
    }

    private fun assertUdpPortFree(port: Int) {
        // A native blocked receive can retain its descriptor until the retired worker returns.
        // Production SETUP stays asynchronous; acceptance waits boundedly for actual release.
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (true) {
            try {
                DatagramSocket(null).use { it.bind(InetSocketAddress(InetAddress.getByName("::"), port)) }
                return
            } catch (error: java.net.BindException) {
                if (System.nanoTime() >= deadline) throw error
                Thread.yield()
            }
        }
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (!condition() && System.nanoTime() < deadline) Thread.yield()
        assertTrue("asynchronous socket lifecycle did not settle", condition())
    }

    private fun awaitGate(gate: CountDownLatch) {
        var interrupted = false
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4)
        try {
            while (gate.count > 0) {
                try {
                    val remaining = deadline - System.nanoTime()
                    assertTrue("test must release the observer", remaining > 0)
                    assertTrue(gate.await(remaining, TimeUnit.NANOSECONDS))
                } catch (_: InterruptedException) { interrupted = true }
            }
        } finally { if (interrupted) Thread.currentThread().interrupt() }
    }

    private fun workers(session: AirPlaySession): List<Thread> =
        (field(session, "eventThreads") as Iterable<*>).filterIsInstance<Thread>()

    private fun field(session: AirPlaySession, name: String): Any? =
        AirPlaySession::class.java.getDeclaredField(name).apply { isAccessible = true }.get(session)

    private fun closeAndJoin(session: AirPlaySession) {
        val workers = workers(session)
        session.close()
        workers.forEach { it.join(2_000); assertFalse(it.isAlive) }
    }
}
