package com.shilapi.xcertplay.airplay

import java.math.BigInteger
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test

class PeerInitiatedTimingTest {
    @Test fun peerWithoutAdvertisedPortCanEstablishTheMediaClockThroughReciprocalTiming() {
        val address = InetAddress.getByName("127.0.0.1")
        DatagramSocket(0, address).use { phone ->
            phone.soTimeout = 4000
            NtpClock().use { clock ->
                val port = clock.listen()
                clock.start(address, 0)
                val request = ByteArray(32).apply { this[0] = 0x80.toByte(); this[1] = 210.toByte() }
                stamp(request, 24, clock.syncedNtp())
                phone.send(DatagramPacket(request, request.size, address, port))
                var exchanges = 0
                while (exchanges < 2) {
                    val packet = DatagramPacket(ByteArray(32), 32)
                    phone.receive(packet)
                    if (packet.data[1].toInt() and 0xff != 210) continue // Reply to the phone's initial request.
                    val response = ByteArray(32).apply { this[0] = 0x80.toByte(); this[1] = 211.toByte() }
                    packet.data.copyInto(response, 8, 24, 32)
                    // A phone clock deliberately in a different domain, not Android frame arrival time.
                    val remoteNow = clock.syncedNtp().add(BigInteger.ONE.shiftLeft(32).multiply(BigInteger.valueOf(120)))
                    stamp(response, 16, remoteNow)
                    stamp(response, 24, remoteNow)
                    phone.send(DatagramPacket(response, response.size, packet.address, packet.port))
                    exchanges++
                }
                val deadline = System.nanoTime() + 1_000_000_000
                while (clock.mediaTimeNanos(1) == null && System.nanoTime() < deadline) Thread.yield()
                val before = System.nanoTime()
                val sender = clock.syncedNtp().multiply(BigInteger.valueOf(1_000_000_000)).shiftRight(32).toLong()
                val mapped = clock.mediaTimeNanos(sender)
                assertNotNull("Peer-initiated timing must establish a synchronized media clock", mapped)
                assertTrue(mapped!! >= before - 1 && mapped <= System.nanoTime())
            }
        }
    }

    private fun stamp(target: ByteArray, offset: Int, value: BigInteger) {
        for (index in 0..7) target[offset + index] = value.shiftRight((7 - index) * 8).toByte()
    }
}
