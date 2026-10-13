package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import com.shilapi.xcertplay.airplay.MicrophoneCounters
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserMicrophoneTest {
    @Test fun resumingTheSameBluetoothDemandKeepsRtpCountersAndNeverReusesAnEncryptionNonce() {
        val host = InetAddress.getLoopbackAddress()
        DatagramSocket(0, host).use { receiver ->
            receiver.soTimeout = 1000
            val key = ByteArray(32) { it.toByte() }
            val config = MicrophoneConfig("telephony", 16000, 1, 100, 20, host, receiver.localPort, key)
            val counters = MicrophoneCounters()
            repeat(2) { number ->
                BrowserMicrophone(config, counters).use { it.accept(ByteArray(config.frameBytes)) }
                val packet = DatagramPacket(ByteArray(4096), 4096)
                receiver.receive(packet)
                val wire = packet.data.copyOf(packet.length)
                assertEquals(number, wire[3].toInt())
                assertEquals(number.toLong(), java.nio.ByteBuffer.wrap(wire, wire.size - 8, 8).order(java.nio.ByteOrder.LITTLE_ENDIAN).long)
                assertEquals(number * 320, java.nio.ByteBuffer.wrap(wire, 4, 4).int)
                val nonce = ByteArray(12).also { wire.copyInto(it, 4, wire.size - 8, wire.size) }
                assertEquals(config.frameBytes, AirPlayCrypto.chachaOpen(key, nonce,
                    wire.copyOfRange(12, wire.size - 8), wire.copyOfRange(4, 12)).size)
            }
        }
    }
    @Test fun partialBluetoothCaptureReadsBecomeAuthenticatedOrderedMicrophoneDatagrams() {
        val host = InetAddress.getLoopbackAddress()
        DatagramSocket(0, host).use { receiver ->
            receiver.soTimeout = 1000
            val key = ByteArray(32) { it.toByte() }
            val config = MicrophoneConfig("speechrecognition", 16000, 1, 100, 20, host, receiver.localPort, key)
            val pcm = ByteArray(config.frameBytes * 2) { (it % 251).toByte() }
            BrowserMicrophone(config).use { mic ->
                mic.accept(pcm.copyOfRange(0, 200))
                mic.accept(pcm.copyOfRange(200, pcm.size))
                repeat(2) { number ->
                    val datagram = DatagramPacket(ByteArray(4096), 4096)
                    receiver.receive(datagram)
                    val packet = datagram.data.copyOf(datagram.length)
                    assertEquals(0x80, packet[0].toInt() and 255)
                    assertEquals(100, packet[1].toInt() and 127)
                    assertEquals(number, packet[3].toInt() and 255)
                    val timestamp = ((packet[4].toInt() and 255) shl 24) or
                        ((packet[5].toInt() and 255) shl 16) or
                        ((packet[6].toInt() and 255) shl 8) or (packet[7].toInt() and 255)
                    assertEquals(number * 320, timestamp)
                    val nonce = ByteArray(12)
                    packet.copyInto(nonce, 4, packet.size - 8, packet.size)
                    val decoded = AirPlayCrypto.chachaOpen(key, nonce,
                        packet.copyOfRange(12, packet.size - 8), packet.copyOfRange(4, 12))
                    val expected = pcm.copyOfRange(number * config.frameBytes, (number + 1) * config.frameBytes)
                    for (i in expected.indices step 2) {
                        assertEquals(expected[i], decoded[i + 1])
                        assertEquals(expected[i + 1], decoded[i])
                    }
                    assertEquals(number.toByte(), nonce[4])
                }
            }
        }
    }
}
