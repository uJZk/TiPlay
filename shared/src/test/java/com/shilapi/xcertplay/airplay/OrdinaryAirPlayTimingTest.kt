package com.shilapi.xcertplay.airplay

import java.math.BigInteger
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.Assert.*
import org.junit.Test

class OrdinaryAirPlayTimingTest {
    @Test fun largeNegativePeerOffsetPreservesSubMillisecondCorrection() {
        val timeline = NtpWireTimeline()
        val localOffsetNanos = 4_000_000_000_000_000_000L
        timeline.offset(localOffsetNanos)
        val appliedOffsetNanos = -1_790_000_000_123_456_789L
        val sampledOffsetSeconds = appliedOffsetNanos.toDouble() / 1e9 + 0.0005
        assertEquals(0.0005,
            timeline.correction(sampledOffsetSeconds, localOffsetNanos + appliedOffsetNanos),
            0.000001)
    }

    @Test fun wireClockStaysLocalAcrossRepeatedPeerMediaClockCorrections() {
        val address = InetAddress.getByName("127.0.0.1")
        DatagramSocket(0, address).use { phone ->
            phone.soTimeout = 4000
            val logs = CopyOnWriteArrayList<String>()
            NtpClock(log = logs::add, wireTimeline = NtpWireTimeline()).use { clock ->
                // Keep this reference fixed: later syncedNtp() includes the correction under test.
                val initialLocalNtp = clock.syncedNtp()
                val initialMonotonic = System.nanoTime()
                val peerOffset = BigInteger.valueOf(120).shiftLeft(32)
                fun peerNow(): BigInteger = initialLocalNtp.add(peerOffset).add(
                    BigInteger.valueOf(System.nanoTime() - initialMonotonic).shiftLeft(32)
                        .divide(BigInteger.valueOf(1_000_000_000)),
                )
                fun assertMediaMapping() {
                    val before = System.nanoTime()
                    val sender = peerNow().multiply(BigInteger.valueOf(1_000_000_000)).shiftRight(32)
                        .toLong() - VideoMediaClockMapping.NTP_EPOCH_NANOS
                    val mapped = clock.mediaTimeNanos(sender)
                    assertNotNull("Ordinary AirPlay must synchronize its media clock", mapped)
                    assertTrue("Media correction must not accumulate the peer's 120-second offset",
                        mapped!! >= before - 100_000_000 && mapped <= System.nanoTime() + 100_000_000)
                }

                clock.listen()
                clock.start(address, phone.localPort)
                var previousT1: BigInteger? = null
                // The fifth request lets the receiver finish processing the fourth response.
                repeat(5) { exchange ->
                    val request = DatagramPacket(ByteArray(32), 32)
                    phone.receive(request)
                    assertEquals(210, request.data[1].toInt() and 0xff)
                    val t1 = BigInteger(1, request.data.copyOfRange(24, 32))
                    previousT1?.let { previous ->
                        val elapsedSeconds = t1.subtract(previous).toDouble() / 0x1_0000_0000L.toDouble()
                        assertTrue("Wire T1 must advance about one second without following the peer offset: $elapsedSeconds",
                            elapsedSeconds in 0.5..3.0)
                    }
                    previousT1 = t1
                    if (exchange == 2 || exchange == 4) assertMediaMapping()
                    if (exchange < 4) {
                        val response = ByteArray(32).apply {
                            this[0] = 0x80.toByte()
                            this[1] = 211.toByte()
                            this[3] = 7
                        }
                        request.data.copyInto(response, 8, 24, 32)
                        val remoteNow = peerNow()
                        stamp(response, 16, remoteNow)
                        stamp(response, 24, remoteNow)
                        phone.send(DatagramPacket(response, response.size, request.address, request.port))
                    }
                }
                clock.reportVideoEnd()
                val snapshot = logs.single { it.startsWith("Media clock snapshot:") }
                assertTrue(snapshot.contains("rxResponse=4 unmatched=0"))
                val rttMicros = Regex("rttUs=(-?\\d+)").find(snapshot)!!.groupValues[1].toLong()
                assertTrue("Later responses must still use the local wire T4", rttMicros in 0..100_000)
            }
        }
    }

    private fun stamp(target: ByteArray, offset: Int, value: BigInteger) {
        for (index in 0..7) target[offset + index] = value.shiftRight((7 - index) * 8).toByte()
    }
}
