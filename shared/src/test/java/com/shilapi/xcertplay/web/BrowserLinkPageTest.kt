package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.AirPlayContact
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.Socket
import java.util.concurrent.Executor

/** The phone serves protocol endpoints only; the browser page comes from a separate HTTPS host. */
class BrowserLinkPageTest {
    private val callbacks = object : BrowserLinkServer.Callbacks {
        override fun code() = "1234"
        override fun status() = BrowserLinkStatus(BrowserLinkStatus.State.IDLE)
        override fun onTouch(contacts: List<AirPlayContact>) = false
        override fun onViewport(viewport: BrowserViewport) = Unit
        override fun onFit() = Unit
        override fun onKey(name: String) = Unit
        override fun onBrowserStats(stats: Map<String, Any?>) = Unit
        override fun log(message: String) = Unit
    }
    private val server = BrowserLinkServer(WebVideoHub(Executor { it.run() }), callbacks, "127.0.0.1", 0)

    @After fun stop() = server.stop()

    private class Response(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
        val text get() = String(body, Charsets.UTF_8)
    }

    private class Client(port: Int) : Closeable {
        private val socket = Socket("127.0.0.1", port).apply { soTimeout = 5_000 }
        private val input = BufferedInputStream(socket.getInputStream())

        fun send(text: String) = socket.getOutputStream().write(text.toByteArray(Charsets.ISO_8859_1))

        fun response(): Response {
            val head = ByteArrayOutputStream()
            while (!head.toString(Charsets.ISO_8859_1.name()).endsWith("\r\n\r\n")) {
                val next = input.read()
                if (next < 0) throw IOException("closed before a response")
                head.write(next)
            }
            val lines = head.toString(Charsets.ISO_8859_1.name()).trimEnd().split("\r\n")
            val headers = lines.drop(1).associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
            val length = headers.getValue("content-length").toInt()
            val body = ByteArray(length)
            var read = 0
            while (read < length) {
                val count = input.read(body, read, length - read)
                if (count < 0) throw IOException("body ended early")
                read += count
            }
            return Response(lines[0].split(' ')[1].toInt(), headers, body)
        }

        override fun close() = socket.close()
    }

    private fun get(port: Int, path: String, host: String = "100.109.220.253:8080"): Response = Client(port).use {
        it.send("GET $path HTTP/1.1\r\nHost: $host\r\n\r\n")
        it.response()
    }

    @Test fun removedPageRoutesReturnNotFoundWhileHelloRemainsAvailable() {
        val port = server.start().getOrThrow()
        for (path in listOf("/", "/play", "/play/", "/play/app.js", "/play/sw.js", "/play/reconnect-wallpaper-blurred.png")) {
            val response = get(port, path)
            assertEquals(path, 404, response.status)
            assertEquals(path, "{\"error\":\"not-found\"}", response.text)
            assertEquals(path, "no-store", response.headers["cache-control"])
            assertNull(path, response.headers["location"])
        }
        assertEquals(200, get(port, "/hello").status)
        assertEquals(421, get(port, "/hello", "tiplay.example").status)
    }

    @Test fun aRemovedPageRouteDoesNotBreakTheNextProtocolRequest() {
        val port = server.start().getOrThrow()
        Client(port).use { client ->
            client.send("GET /play/ HTTP/1.1\r\nHost: localhost:$port\r\n\r\n")
            assertEquals(404, client.response().status)
            client.send("GET /hello HTTP/1.1\r\nHost: localhost:$port\r\n\r\n")
            assertEquals(200, client.response().status)
        }
    }
}
