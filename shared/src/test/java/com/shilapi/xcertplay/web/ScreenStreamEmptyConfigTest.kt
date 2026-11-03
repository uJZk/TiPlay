package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.ScreenStream
import com.shilapi.xcertplay.airplay.VideoCodec
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class ScreenStreamEmptyConfigTest {
    @Test fun emptyMessageBeforeRealConfigurationDoesNotEndReliableVideo() {
        val hub = WebVideoHub(Executor { it.run() })
        val owner = Any()
        hub.beginStream(owner, 1184, 920, 60, {}, {})
        val subscription = hub.subscribe(reliable = true)
        val received = CountDownLatch(1)
        var selectedCodec = VideoCodec.H265
        val screen = ScreenStream(ByteArray(32))
        val port = screen.listen(object : ScreenStream.Listener {
            override fun onCodec(codec: VideoCodec) { selectedCodec = codec }
            override fun onConfig(codecData: ByteArray) { hub.configure(owner, selectedCodec, codecData); received.countDown() }
        })
        val avcc = byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18)
        try {
            Socket("::1", port).use { socket ->
                fun send(body: ByteArray) {
                    val header = ByteArray(128)
                    for (i in 0..3) header[i] = (body.size ushr (8 * i)).toByte()
                    header[4] = 1
                    socket.getOutputStream().apply { write(header); write(body); flush() }
                }
                send(byteArrayOf())
                send(avcc)
                assertTrue(received.await(5, TimeUnit.SECONDS))
                assertEquals(WebVideoRecords.KIND_CONFIG, requireNotNull(subscription.take(1000)).kind)
                assertNull(subscription.endReason)
                send(byteArrayOf())
                assertEquals("video-source-configuration-invalid", String(requireNotNull(subscription.take(5000)).payload))
            }
        } finally {
            screen.close()
            subscription.close()
        }
    }
}
