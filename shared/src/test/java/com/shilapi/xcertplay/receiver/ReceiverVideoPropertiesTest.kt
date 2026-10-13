package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.BplistCodec
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList

class ReceiverVideoPropertiesTest {
    private class Listener : ReceiverServer.Listener {
        val actions = CopyOnWriteArrayList<String>()
        override fun mirrorSink() = WebMediaSink(WebVideoHub(), 1920, 1080, 60)
        override fun play(item: ReceiverPlay) { actions.add("play") }
        override fun stopPlayback() { actions.add("stop") }
        override fun seek(seconds: Double) { actions.add("seek") }
        override fun rate(value: Double) { actions.add("rate") }
        override fun playback() = ReceiverPlayback(duration = 120.0, position = 15.0, rate = 1.0, ready = true)
        override fun status(state: String) {}
    }

    private fun Socket.request(method: String, path: String, body: ByteArray = ByteArray(0),
                               session: String = "owner", protocol: String = "HTTP/1.1"): RtspMessage.Request {
        getOutputStream().write(("$method $path $protocol\r\nX-Apple-Session-ID: $session\r\n" +
            "Content-Length: ${body.size}\r\n\r\n").toByteArray() + body)
        return requireNotNull(readReceiverRequest(getInputStream()))
    }

    private fun connect(port: Int, address: String = "127.0.0.1") = Socket(InetAddress.getByName("127.0.0.1"),
        port, InetAddress.getByName(address), 0).apply { soTimeout = 5000 }

    private fun play(control: Socket) {
        assertEquals("200", control.request("POST", "/play",
            BplistCodec.encode(mapOf("Content-Location" to "https://example.org/movie.mp4"))).path)
    }

    @Test fun knownOptionalHintsAreAcknowledgedWithoutChangingPlaybackOrClaimingUnknownValues() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                play(control)
                val hints = listOf("actionAtItemEnd", "selectedMediaArray", "reverseEndTime", "forwardEndTime",
                    "interstitialEvents", "textMarkupArray", "isInterestedInDateRange")
                for (hint in hints) {
                    val reply = control.request("PUT", "/setProperty?$hint", BplistCodec.encode(mapOf("value" to 80)))
                    assertEquals(hint, "200", reply.path)
                    assertEquals("text/x-apple-plist+xml", reply.headers["content-type"])
                    assertTrue(reply.body.toString(Charsets.UTF_8).contains("<key>errorCode</key><integer>0</integer>"))
                }
                assertEquals(listOf("play"), listener.actions.toList())
                for (path in listOf("/getProperty?duration", "/getProperty?unrecognized")) {
                    val reply = control.request("POST", path)
                    assertEquals("200", reply.path)
                    assertEquals(0, reply.body.size)
                    assertFalse(reply.headers.containsKey("content-type"))
                }
                val unknown = control.request("PUT", "/setProperty?unrecognized", BplistCodec.encode(mapOf("value" to 80)))
                assertEquals("200", unknown.path)
                assertEquals(0, unknown.body.size)
                assertFalse(unknown.headers.containsKey("content-type"))
                assertEquals("404", control.request("GET", "/getProperty?duration").path)
                assertEquals("404", control.request("POST", "/setProperty?forwardEndTime").path)
                assertEquals("404", control.request("POST", "/getProperty?duration", protocol = "RTSP/1.0").path)
                assertEquals(listOf("play"), listener.actions.toList())
            }
        } finally { receiver.close() }
    }

    @Test fun absoluteHttpTargetsKeepScrubAndPropertyRequestsOnTheOrdinaryVideoPath() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                play(control)
                val base = "http://127.0.0.1:${receiver.port}"
                assertEquals("200", control.request("POST", "$base/scrub?position=32").path)
                assertEquals(listOf("play", "seek"), listener.actions.toList())
                assertEquals("200", control.request("POST", "$base/getProperty?duration").path)
                val hint = control.request("PUT", "$base/setProperty?forwardEndTime", BplistCodec.encode(mapOf("value" to 80)))
                assertEquals("200", hint.path)
                assertTrue(hint.body.toString(Charsets.UTF_8).contains("<key>errorCode</key><integer>0</integer>"))
                assertEquals("403", control.request("POST", "$base/scrub?position=32", session = "another").path)
                assertEquals(listOf("play", "seek"), listener.actions.toList())
            }
        } finally { receiver.close() }
    }

    @Test fun propertyRequestsRemainBoundToTheActivePlaybackPeerAndSession() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals("403", control.request("POST", "/getProperty?duration").path)
                assertEquals("403", control.request("PUT", "/setProperty?forwardEndTime").path)
                play(control)
                for ((method, path) in listOf("POST" to "/getProperty?duration", "PUT" to "/setProperty?forwardEndTime")) {
                    assertEquals("403", control.request(method, path, session = "another").path)
                    connect(receiver.port, "127.0.0.2").use { foreign ->
                        assertEquals("403", foreign.request(method, path).path)
                    }
                    assertEquals("200", control.request(method, path).path)
                }
                assertEquals(listOf("play"), listener.actions.toList())
                assertEquals("200", control.request("POST", "/stop").path)
                assertEquals("403", control.request("POST", "/getProperty?duration").path)
            }
        } finally { receiver.close() }
    }

    @Test fun alternateFairPlaySetupReturnsItsExplicitUnsupportedStatusWithoutTouchingTheHandshake() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener,
            fairPlayReply = { error("Alternate FairPlay must not use the mirror handshake") })
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                for (body in listOf(ByteArray(0), ByteArray(16), ByteArray(164))) {
                    val reply = control.request("POST", "/fp-setup2", body)
                    assertEquals("421", reply.path)
                    assertEquals("Misdirected Request", reply.protocol)
                    assertEquals("application/x-apple-binary-plist", reply.headers["content-type"])
                    assertEquals(0, reply.body.size)
                }
                assertEquals("404", control.request("GET", "/fp-setup2").path)
                assertEquals("200", control.request("OPTIONS", "/").path)
                assertTrue(listener.actions.isEmpty())
            }
        } finally { receiver.close() }
    }
}
