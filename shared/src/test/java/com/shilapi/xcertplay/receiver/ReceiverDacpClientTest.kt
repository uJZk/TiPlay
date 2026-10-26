package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class ReceiverDacpClientTest {
    private val peer = InetAddress.getByName("127.0.0.1")

    @Test fun realHttpCommandsUseTheSenderTokenAndExactDacpPaths() {
        PeerServer(3) { "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n" }.use { server ->
            ReceiverDacpClient(peer, server.port, "4294967295").use { client ->
                assertTrue(client.command("next"))
                assertTrue(client.command("previous"))
                assertTrue(client.command("seek", 12_345))
                for (path in listOf("nextitem", "previtem", "setproperty?dacp.playingtime=12345")) {
                    val request = requireNotNull(server.requests.poll(2, TimeUnit.SECONDS))
                    assertTrue(request.startsWith("GET /ctrl-int/1/$path HTTP/1.1\r\n"))
                    assertTrue(request.contains("\r\nActive-Remote: 4294967295\r\n"))
                    assertTrue(request.contains("\r\nHost: 127.0.0.1:${server.port}\r\n"))
                }
            }
        }
    }

    @Test fun nonSuccessRedirectAndInvalidHeadersDoNotAcknowledgeOrFollowAnotherEndpoint() {
        for (response in listOf(
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.2:9/ctrl-int/1/nextitem\r\n\r\n",
            "HTTP/1.1 204 No Content\r\nMalformed header\r\n\r\n",
            "HTTP/1.1 204 Bad\u0000reason\r\n\r\n",
            "HTTP/1.1 204 No Content\r\nX-Large: ${"a".repeat(8192)}\r\n\r\n",
            "HTTP/1.1 204 No Content\r\n",
            "not HTTP\r\n\r\n",
        )) {
            PeerServer { response }.use { server ->
                ReceiverDacpClient(peer, server.port, "1").use { client -> assertFalse(client.command("next")) }
                assertNotNull(server.requests.poll(2, TimeUnit.SECONDS))
                assertTrue(server.requests.isEmpty())
            }
        }
    }

    @Test fun argumentsCannotBecomeArbitraryPathsHeadersOrUnboundedPositions() {
        for (token in listOf("", "-1", "4294967296", "1\r\nX-Injected: yes", "a".repeat(100))) {
            assertFalse(ReceiverDacpClient.validActiveRemote(token))
            assertThrows(IllegalArgumentException::class.java) { ReceiverDacpClient(peer, 1234, token) }
        }
        PeerServer { "HTTP/1.1 204 OK\r\n\r\n" }.use { server ->
            ReceiverDacpClient(peer, server.port, "123").use { client ->
                assertFalse(client.command("http://127.0.0.2/nextitem"))
                assertFalse(client.command("next\r\nX-Injected: yes"))
                assertFalse(client.command("next", 0))
                assertFalse(client.command("seek"))
                assertFalse(client.command("seek", -1))
                assertFalse(client.command("seek", 0x1_0000_0000L))
                assertFalse(client.command("previous", stillCurrent = { false }))
                assertTrue(server.requests.isEmpty())
            }
        }
    }

    @Test fun aRetiredOwnerCannotStartOrFinishAnInFlightCommand() {
        PeerServer { null }.use { server ->
            val client = ReceiverDacpClient(peer, server.port, "123")
            val command = CompletableFuture.supplyAsync { client.command("next") }
            assertNotNull(server.requests.poll(2, TimeUnit.SECONDS))
            client.close()
            assertFalse(command.get(2, TimeUnit.SECONDS))
            assertFalse(client.command("previous"))
        }
    }

    @Test fun aSilentSenderIsBoundedByTheCommandDeadline() {
        PeerServer { null }.use { server ->
            ReceiverDacpClient(peer, server.port, "123", timeoutMillis = 100).use { client ->
                val command = CompletableFuture.supplyAsync { client.command("seek", 10_000) }
                assertNotNull(server.requests.poll(2, TimeUnit.SECONDS))
                assertFalse(command.get(2, TimeUnit.SECONDS))
            }
        }
    }

    /** A real DACP peer; null response intentionally waits until fixture cleanup. */
    private class PeerServer(count: Int = 1, response: (String) -> String?) : Closeable {
        private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val port: Int = server.localPort
        val requests = LinkedBlockingQueue<String>()
        private val release = CountDownLatch(1)
        @Volatile private var socket: Socket? = null
        init {
            Thread({
                try {
                    repeat(count) {
                        server.accept().use { client ->
                            socket = client
                            client.soTimeout = 2000
                            val bytes = ByteArrayOutputStream()
                            var ending = 0
                            while (ending != 0x0d0a0d0a && bytes.size() < 8192) {
                                val value = client.getInputStream().read()
                                if (value < 0) return@use
                                bytes.write(value)
                                ending = (ending shl 8) or value
                            }
                            val request = bytes.toString(Charsets.US_ASCII.name())
                            requests.add(request)
                            val text = response(request)
                            if (text == null) release.await(5, TimeUnit.SECONDS)
                            else client.getOutputStream().write(text.toByteArray(Charsets.US_ASCII))
                        }
                    }
                } catch (_: Exception) {
                    // Fixture close unblocks accept/read and retires the daemon.
                } finally { socket = null }
            }, "dacp-client-test-peer").apply { isDaemon = true; start() }
        }
        override fun close() {
            release.countDown()
            runCatching { socket?.close() }
            server.close()
        }
    }
}
