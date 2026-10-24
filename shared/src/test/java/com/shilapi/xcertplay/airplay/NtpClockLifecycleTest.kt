package com.shilapi.xcertplay.airplay

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

class NtpClockLifecycleTest {
    @Test fun repeatedSetupRetainsOneTimingPortAndOneSenderWhileUpdatingThePeer() {
        peer().use { first ->
            peer().use { second ->
                val clock = NtpClock()
                try {
                    val port = clock.listen()
                    clock.start(InetAddress.getByName("::1"), first.localPort)
                    assertEquals(210, receive(first).data[1].toInt() and 0xff)
                    val sender = worker(clock, "sender")
                    val receiver = worker(clock, "receiver")
                    repeat(12) {
                        assertEquals(port, clock.listen())
                        clock.start(InetAddress.getByName("::1"), second.localPort)
                        assertSame(sender, worker(clock, "sender"))
                        assertSame(receiver, worker(clock, "receiver"))
                    }
                    assertEquals(210, receive(second).data[1].toInt() and 0xff)
                    clock.close()
                    assertFalse(sender.isAlive)
                    assertFalse(receiver.isAlive)
                    assertPortFree(port)
                } finally { clock.close() }
            }
        }
    }

    @Test fun reusedTimingPortStillAnswersAnActualPeerRequest() {
        peer().use { client ->
            val clock = NtpClock()
            try {
                val port = clock.listen()
                repeat(8) { assertEquals(port, clock.listen()) }
                val request = ByteArray(32).apply {
                    this[0] = 0x80.toByte(); this[1] = 210.toByte(); this[3] = 7
                    for (index in 24..31) this[index] = index.toByte()
                }
                client.send(DatagramPacket(request, request.size, InetAddress.getByName("::1"), port))
                val response = receive(client)
                assertEquals(port, response.port)
                assertEquals(211, response.data[1].toInt() and 0xff)
                assertArrayEquals(request.copyOfRange(24, 32), response.data.copyOfRange(8, 16))
            } finally { clock.close() }
        }
    }

    @Test fun concurrentListenAndCloseCannotLeaveAnUnownedTimingSocketOrReviveTheClock() {
        repeat(24) {
            val clock = NtpClock()
            val start = CountDownLatch(1)
            val port = AtomicInteger()
            val failed = AtomicReference<Throwable>()
            val listener = Thread {
                start.await()
                try { port.set(clock.listen()) } catch (_: IllegalStateException) {
                    // Close is terminal if it wins before allocation.
                } catch (error: Throwable) { failed.set(error) }
            }
            val closer = Thread { start.await(); clock.close() }
            listener.start(); closer.start(); start.countDown()
            listener.join(2_000); closer.join(2_000)
            assertFalse(listener.isAlive)
            assertFalse(closer.isAlive)
            assertNull(failed.get())
            clock.close()
            if (port.get() > 0) assertPortFree(port.get())
            assertThrows(IllegalStateException::class.java) { clock.listen() }
            assertThrows(IllegalStateException::class.java) { clock.start(InetAddress.getLoopbackAddress(), 0) }
        }
    }

    private fun peer() = DatagramSocket(null).apply {
        bind(InetSocketAddress(InetAddress.getByName("::1"), 0))
        soTimeout = 2_000
    }

    private fun receive(socket: DatagramSocket): DatagramPacket =
        DatagramPacket(ByteArray(128), 128).also { socket.receive(it) }

    private fun assertPortFree(port: Int) {
        DatagramSocket(null).use { it.bind(InetSocketAddress(InetAddress.getByName("::"), port)) }
    }

    private fun worker(clock: NtpClock, name: String) = NtpClock::class.java.getDeclaredField(name)
        .apply { isAccessible = true }.get(clock) as Thread
}
