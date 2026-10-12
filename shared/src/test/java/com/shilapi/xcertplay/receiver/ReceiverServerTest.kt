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
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ReceiverServerTest {
    private class Listener : ReceiverServer.Listener {
        val hub = WebVideoHub()
        val items = CopyOnWriteArrayList<ReceiverPlay>()
        val states = CopyOnWriteArrayList<String>()
        val ended = CountDownLatch(1)
        var stopped = 0
        var sought = 0.0
        var speed = 1.0
        override fun mirrorSink() = WebMediaSink(hub, 1920, 1080, 60)
        override fun play(item: ReceiverPlay) { items.add(item) }
        override fun stopPlayback() { stopped++ }
        override fun seek(seconds: Double) { sought = seconds }
        override fun rate(value: Double) { speed = value }
        override fun playback() = ReceiverPlayback(100.0, sought, speed, true)
        override fun status(state: String) { states.add(state); if (state == "listening") ended.countDown() }
    }

    private fun Socket.send(method: String, path: String, body: ByteArray = ByteArray(0), id: String = "test"):
        com.shilapi.xcertplay.airplay.RtspMessage.Request {
        getOutputStream().write(("$method $path HTTP/1.1\r\nX-Apple-Session-ID: $id\r\nContent-Length: ${body.size}\r\n\r\n").toByteArray() + body)
        return requireNotNull(readReceiverRequest(getInputStream()))
    }
    private fun Socket.status(method: String, path: String, body: ByteArray = ByteArray(0), id: String = "test") = send(method, path, body, id).path.toInt()
    private fun connect(port: Int) = Socket(InetAddress.getLoopbackAddress(), port).apply { soTimeout = 5000 }

    @Test fun videoControlAndReverseEventsBelongToTheirSessionAndShutdownClosesSockets() {
        val listener = Listener()
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate()), listener)
        receiver.start()
        try {
            connect(receiver.port).use { control ->
                assertEquals(200, control.status("GET", "/info"))
                assertEquals(404, control.status("GET", "/unknown"))
                assertEquals(200, control.status("POST", "/play", "Content-Location: https://example.org/movie.mp4\r\nStart-Position: 0\r\n".toByteArray()))
                assertEquals(1, listener.items.size)
                assertEquals(403, control.status("POST", "/stop", id = "another"))
                assertEquals(0, listener.stopped)
                assertEquals(200, control.status("POST", "/scrub?position=12.5"))
                assertEquals(12.5, listener.sought, 0.0)
                assertEquals(200, control.status("POST", "/rate?value=0"))
                assertEquals(0.0, listener.speed, 0.0)
                assertEquals(400, control.status("POST", "/rate?value=NaN"))
                connect(receiver.port).use { reverse ->
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: test\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                    assertEquals("101", readReceiverRequest(reverse.getInputStream())!!.path)
                    receiver.playbackEvent("playing")
                    val event = readReceiverRequest(reverse.getInputStream())!!
                    assertEquals("POST", event.method); assertEquals("/event", event.path)
                    assertTrue(event.body.toString(Charsets.UTF_8).contains("<string>playing</string>"))
                    assertEquals(200, control.status("POST", "/stop"))
                    assertEquals(1, listener.stopped)
                    assertEquals("listening", listener.states.last())
                    receiver.close()
                    // One stopped event may already be buffered before the orderly close.
                    val stopped = readReceiverRequest(reverse.getInputStream())
                    if (stopped != null) assertNull(readReceiverRequest(reverse.getInputStream()))
                }
            }
        } finally { receiver.close() }
    }

    @Test fun encryptedMirrorUsesIndependentKeyAndGeometryAndControlDisconnectEndsStream() {
        val identity = AirPlayIdentity.generate()
        val listener = Listener()
        val rawKey = ByteArray(16) { (it + 1).toByte() }
        val receiver = ReceiverServer(ReceiverConfig("TiPlay", "02:11:22:33:44:55", identity), listener,
            fairPlayReply = { ByteArray(32) }, fairPlayDecrypt = { _, _ -> rawKey })
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
            control.send("POST", "/fp-setup", ByteArray(164))
            val setup = mapOf("eiv" to ByteArray(16), "ekey" to ByteArray(72), "timingPort" to 0)
            assertEquals(200, control.status("SETUP", "/", BplistCodec.encode(setup)))
            val stream = BplistCodec.decode(control.send("SETUP", "/", BplistCodec.encode(mapOf("streams" to listOf(mapOf("type" to 110, "streamConnectionID" to 1234L))))).body) as Map<*, *>
            val port = (((stream["streams"] as List<*>).single() as Map<*, *>)["dataPort"] as Number).toInt()
            val subscription = listener.hub.subscribe()
            connect(port).use { data ->
                fun packet(op: Int, body: ByteArray): ByteArray {
                    val header = ByteBuffer.allocate(128).order(ByteOrder.LITTLE_ENDIAN)
                    header.putInt(0, body.size); header.put(4, op.toByte()); header.putFloat(56, 720f); header.putFloat(60, 1280f)
                    return header.array() + body
                }
                val avcc = byteArrayOf(1, 0x42, 0, 0x1f, -1, -31, 0, 4, 0x67, 0x42, 0, 0x1f, 1, 0, 2, 0x68, 1)
                data.getOutputStream().write(packet(1, avcc))
                assertNotNull(subscription.take(5000))
                assertEquals(720, listener.hub.info()!!.width)
                val mirrorKey = AirPlayCrypto.sha512(rawKey, secret).copyOf(16)
                val encryption = aesCtr(AirPlayCrypto.sha512("AirPlayStreamKey1234".toByteArray(), mirrorKey).copyOf(16),
                    AirPlayCrypto.sha512("AirPlayStreamIV1234".toByteArray(), mirrorKey).copyOf(16))
                val first = byteArrayOf(0, 0, 0, 3, 0x65, 1, 2)
                val second = byteArrayOf(0, 0, 0, 2, 0x41, 1)
                data.getOutputStream().write(packet(0, encryption.update(first)) + packet(0, encryption.update(second)))
                assertNotNull(subscription.take(5000)); assertNotNull(subscription.take(5000))
                control.close()
                assertTrue(listener.ended.await(5, TimeUnit.SECONDS))
                assertNull(listener.hub.info())
            }
            subscription.close()
        } finally { control.close(); receiver.close() }
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
                    reverse.getOutputStream().write("POST /reverse HTTP/1.1\r\nX-Apple-Session-ID: test\r\nUpgrade: PTTH/1.0\r\nContent-Length: 0\r\n\r\n".toByteArray())
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
