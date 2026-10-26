package com.shilapi.xcertplay.airplay

import java.io.IOException
import java.net.InetAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class VideoSettingsChannelTest {
    @Test fun closingAnAcceptedChannelReleasesBothThePeerAndListeningPort() {
        val connected = CountDownLatch(1)
        val channel = VideoSettingsChannel(ByteArray(32), ByteArray(32)) { if (it.contains("connected")) connected.countDown() }
        val port = channel.listen(InetAddress.getLoopbackAddress())
        Socket(InetAddress.getLoopbackAddress(), port).use { peer ->
            peer.soTimeout = 2_000
            assertTrue(connected.await(2, TimeUnit.SECONDS))
            channel.close()
            assertClosed(peer)
            assertThrows(IOException::class.java) { Socket(InetAddress.getLoopbackAddress(), port).close() }
            channel.close()
        }
    }

    @Test fun aRetiredChannelCannotStartANewListener() {
        val channel = VideoSettingsChannel(ByteArray(32), ByteArray(32)) {}
        channel.close()
        assertThrows(IOException::class.java) { channel.listen(InetAddress.getLoopbackAddress()) }
    }

    @Test fun closeConcurrentWithAcceptNeverLeavesAnAcceptedPeerAlive() {
        repeat(20) {
            val channel = VideoSettingsChannel(ByteArray(32), ByteArray(32)) {}
            val port = channel.listen(InetAddress.getLoopbackAddress())
            val peer = Socket(InetAddress.getLoopbackAddress(), port)
            peer.soTimeout = 2_000
            try {
                channel.close()
                assertClosed(peer)
            } finally { peer.close(); channel.close() }
        }
    }

    private fun assertClosed(peer: Socket) {
        try { assertEquals(-1, peer.getInputStream().read()) }
        catch (error: SocketTimeoutException) { throw AssertionError("retired settings peer remained open", error) }
        catch (_: IOException) { /* A peer reset also establishes actual socket retirement. */ }
    }
}
