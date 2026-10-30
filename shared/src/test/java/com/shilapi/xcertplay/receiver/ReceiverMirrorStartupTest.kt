package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.NtpClock
import com.shilapi.xcertplay.airplay.AirPlayCrypto
import com.shilapi.xcertplay.web.WebMediaSink
import com.shilapi.xcertplay.web.WebVideoHub
import java.net.InetAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class ReceiverMirrorStartupTest {
    @Test fun noDataConnectionEndsTheMirror() {
        val ended = CountDownLatch(1)
        val stream = stream(ended)
        try {
            stream.start()
            assertTrue("missing data connection must release the mirror", ended.await(3, TimeUnit.SECONDS))
        } finally { stream.close() }
    }

    @Test fun connectedButSilentSenderAlsoEndsTheMirror() {
        val ended = CountDownLatch(1)
        val stream = stream(ended)
        try {
            val port = stream.start()
            Socket(InetAddress.getByName("127.0.0.1"), port).use {
                assertTrue("connection without a frame must release the mirror", ended.await(3, TimeUnit.SECONDS))
            }
        } finally { stream.close() }
    }

    @Test fun firstFrameCancelsOnlyItsOwnDeadlineAndDoesNotImposeAnIdleTimeout() {
        val oldTimeout = CountDownLatch(1)
        val newTimeout = CountDownLatch(1)
        val old = ReceiverMirrorStartupDeadline(150) { oldTimeout.countDown() }
        val next = ReceiverMirrorStartupDeadline(150) { newTimeout.countDown() }
        old.start()
        old.complete()
        next.start()
        assertTrue(newTimeout.await(3, TimeUnit.SECONDS))
        assertFalse("a completed stream must not time out on a static picture", oldTimeout.await(250, TimeUnit.MILLISECONDS))
        next.complete()
    }

    @Test fun realFirstFrameCancelsStartupDeadlineForStaticPicture() {
        val ended = CountDownLatch(1)
        val forwarded = CountDownLatch(1)
        val address = InetAddress.getByName("127.0.0.1")
        val stream = ReceiverMirrorStream(ByteArray(16), 1, address,
            WebMediaSink(WebVideoHub(Executor { it.run() }), 1280, 720, 60), NtpClock(),
            log = { if (it.contains("stage=FORWARDED")) forwarded.countDown() },
            startupTimeoutMillis = 1000, listenAddress = address) { ended.countDown() }
        try {
            Socket(address, stream.start()).use { socket ->
                val key = ByteArray(16)
                val cipher = aesCtr(
                    AirPlayCrypto.sha512("AirPlayStreamKey1".toByteArray(), key).copyOf(16),
                    AirPlayCrypto.sha512("AirPlayStreamIV1".toByteArray(), key).copyOf(16))
                val payload = cipher.update(byteArrayOf(0, 0, 0, 2, 0x65, 1))
                val header = ByteArray(128)
                ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).putInt(payload.size)
                socket.getOutputStream().apply { write(header); write(payload); flush() }
                assertTrue("test frame must reach the sink", forwarded.await(3, TimeUnit.SECONDS))
                assertFalse("no later frame is required for a static picture", ended.await(1300, TimeUnit.MILLISECONDS))
            }
        } finally { stream.close() }
    }

    private fun stream(ended: CountDownLatch) = ReceiverMirrorStream(
        ByteArray(16), 1, InetAddress.getByName("127.0.0.1"),
        WebMediaSink(WebVideoHub(Executor { it.run() }), 1280, 720, 60), NtpClock(),
        startupTimeoutMillis = 200, listenAddress = InetAddress.getByName("127.0.0.1"),
    ) { ended.countDown() }
}
