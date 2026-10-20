package com.shilapi.xcertplay.receiver

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class ReceiverAudioDrainTest {
    @Test fun retransmissionRequestsUseTheControlSocketAndNegotiatedPeerPort() {
        val peer = InetAddress.getByName("127.0.0.1")
        DatagramSocket(0, peer).use { sender ->
            sender.soTimeout = 1000
            ReceiverAudioDrain(peer).use { drain ->
                val ports = drain.start()
                val request = byteArrayOf(0x80.toByte(), 0xd5.toByte(), 0, 1, 0, 9, 0, 2)
                drain.sendControl(request, sender.localPort)
                val received = DatagramPacket(ByteArray(64), 64)
                sender.receive(received)
                assertArrayEquals(request, received.data.copyOf(received.length))
                assertEquals(ports.second, received.port)
                drain.sendControl(request, -1)
                drain.sendControl(ByteArray(65), sender.localPort)
            }
        }
    }
    @Test fun drainsBothChannelsWithoutPayloadLoggingAndReleasesBothPortsOnRepeatedClose() {
        val peer = InetAddress.getByName("127.0.0.1")
        val logs = CopyOnWriteArrayList<String>()
        val drain = ReceiverAudioDrain(peer, logs::add)
        val ports = drain.start()
        try {
            assertTrue(ports.first > 0 && ports.second > 0 && ports.first != ports.second)
            DatagramSocket(0, peer).use { sender ->
                val payload = "secret encrypted audio https://private.example".toByteArray()
                send(sender, peer, ports.first, payload)
                send(sender, peer, ports.second, payload)
                awaitLogs(logs, "stage=DRAINED channel=DATA packets=1 bytes=${payload.size}",
                    "stage=DRAINED channel=CONTROL packets=1 bytes=${payload.size}")
                drain.close()
                drain.close()
                assertEquals(1, logs.count { it.contains("stage=END") })
                assertTrue(logs.last().contains("dataPackets=1 dataBytes=${payload.size} dataRejected=0 dataFailures=0"))
                assertTrue(logs.last().contains("controlPackets=1 controlBytes=${payload.size} controlRejected=0 controlFailures=0"))
                assertFalse(logs.any { it.contains("secret") || it.contains("private.example") || it.contains(requireNotNull(peer.hostAddress)) })
            }
            for (port in listOf(ports.first, ports.second)) {
                DatagramSocket(null).use { rebound ->
                    awaitReleasedUdpPort(rebound, InetSocketAddress(InetAddress.getByName("::"), port))
                    assertEquals(port, rebound.localPort)
                }
            }
        } finally { drain.close() }
    }

    @Test fun rejectsPacketsFromOtherPeersAndReceivesIpv6() {
        val peer = InetAddress.getByName("::1")
        val wrongPeer = InetAddress.getByName("127.0.0.1")
        val logs = CopyOnWriteArrayList<String>()
        ReceiverAudioDrain(peer, logs::add).use { drain ->
            val ports = drain.start()
            DatagramSocket(0, wrongPeer).use { sender ->
                for (port in listOf(ports.first, ports.second)) send(sender, wrongPeer, port, ByteArray(7))
            }
            awaitLogs(logs, "stage=REJECTED channel=DATA rejected=1", "stage=REJECTED channel=CONTROL rejected=1")
            assertFalse(logs.any { it.contains("stage=DRAINED") })
            DatagramSocket(0, peer).use { sender ->
                for (port in listOf(ports.first, ports.second)) send(sender, peer, port, ByteArray(9))
            }
            awaitLogs(logs, "stage=DRAINED channel=DATA packets=1 bytes=9", "stage=DRAINED channel=CONTROL packets=1 bytes=9")
            drain.close()
            assertTrue(logs.last().contains("dataPackets=1 dataBytes=9 dataRejected=1"))
            assertTrue(logs.last().contains("controlPackets=1 controlBytes=9 controlRejected=1"))
        }
    }

    @Test fun closeBeforeStartIsIdempotentAndPreventsOpeningPorts() {
        val logs = CopyOnWriteArrayList<String>()
        val drain = ReceiverAudioDrain(InetAddress.getLoopbackAddress(), logs::add)
        drain.close()
        drain.close()
        assertEquals(1, logs.size)
        try {
            drain.start()
            fail("A closed drain must not open sockets")
        } catch (_: IllegalStateException) { }
    }

    @Test fun receiveAndIdleCallbackFailuresRetireBothPortsOnceAndExplainTheFailure() {
        val peer = InetAddress.getByName("127.0.0.1")
        for (source in listOf("DATA", "CONTROL", "IDLE")) {
            val logs = CopyOnWriteArrayList<String>()
            val failures = CopyOnWriteArrayList<String>()
            val retired = CountDownLatch(1)
            val callback: () -> Unit = { throw IOException("decode failed https://private.example/audio?token=secret") }
            ReceiverAudioDrain(peer, logs::add,
                packetReceived = { if (source == "DATA") callback() },
                controlReceived = { if (source == "CONTROL") callback() },
                idle = if (source == "IDLE") callback else null,
                failed = { channel, error ->
                    assertTrue(error is IOException)
                    failures += channel
                    retired.countDown()
                }).use { drain ->
                val ports = drain.start()
                if (source != "IDLE") DatagramSocket(0, peer).use { sender ->
                    send(sender, peer, if (source == "DATA") ports.first else ports.second, byteArrayOf(1))
                }
                assertTrue("$source failure must notify its owner", retired.await(2, TimeUnit.SECONDS))
                assertEquals(listOf(if (source == "CONTROL") "CONTROL" else "DATA"), failures)
                assertEquals(1, logs.count { it.contains("stage=FAILED") })
                assertEquals(1, logs.count { it.contains("stage=END") })
                assertTrue(logs.any { it.contains("exception=IOException") && it.contains("decode failed") })
                assertFalse(logs.any { it.contains("private.example") || it.contains("token=secret") })
                for (port in listOf(ports.first, ports.second)) DatagramSocket(null).use { rebound ->
                    awaitReleasedUdpPort(rebound, InetSocketAddress(InetAddress.getByName("::"), port))
                }
                drain.close()
                assertEquals(1, logs.count { it.contains("stage=END") })
            }
        }
    }

    private fun send(sender: DatagramSocket, address: InetAddress, port: Int, payload: ByteArray) {
        sender.send(DatagramPacket(payload, payload.size, address, port))
    }

    private fun awaitLogs(logs: List<String>, vararg expected: String) {
        val deadline = System.nanoTime() + 2_000_000_000L
        while (!expected.all { text -> logs.any { it.contains(text) } } && System.nanoTime() < deadline) {
            Thread.sleep(5)
        }
        for (text in expected) assertTrue("Missing drain counter: $text", logs.any { it.contains(text) })
    }
}
