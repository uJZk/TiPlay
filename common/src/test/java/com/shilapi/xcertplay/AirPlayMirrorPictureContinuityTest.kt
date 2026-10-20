package com.shilapi.xcertplay

import android.os.Looper
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverMirrorAudioFormat
import com.shilapi.xcertplay.web.WebAudioHub
import com.shilapi.xcertplay.web.WebMediaSink
import java.nio.ByteBuffer
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@LooperMode(LooperMode.Mode.PAUSED)
class AirPlayMirrorPictureContinuityTest {
    private fun withService(test: (AirPlayReceiverService, () -> WebMediaSink) -> Unit) {
        TeslaBrowserLink.resetForTest()
        RuntimeEnvironment.getApplication().getSharedPreferences("tiplay_airplay_receiver", 0).edit().clear().commit()
        val controller = Robolectric.buildService(AirPlayReceiverService::class.java).create()
        val service = controller.get()
        val worker = field(service, "worker") as ExecutorService
        val config = ReceiverConfig("TiPlay", "02:11:22:33:44:55", AirPlayIdentity.generate())
        val open = AirPlayReceiverService::class.java.getDeclaredMethod("openMirrorSink", ReceiverConfig::class.java)
            .apply { isAccessible = true }
        try {
            test(service) { open.invoke(service, config) as WebMediaSink }
        } finally {
            controller.destroy()
            shadowOf(Looper.getMainLooper()).idle()
            assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS))
            TeslaBrowserLink.resetForTest()
        }
    }

    @Test fun pictureSetupAndRetryKeepTheSoundtrackProducerEpochAndSamplesContinuous() = withService { service, open ->
        val format = ReceiverMirrorAudioFormat(8, 48000, 2, 512)
        val audio = AirPlayMirrorAudio(format, TeslaBrowserLink.audioHub)
        field(service, "mirrorAudio", audio)
        field(service, "mirrorAudioFormat", format)
        TeslaBrowserLink.audioHub.subscribe().use { reader ->
            fun nextMirror(): ByteArray {
                repeat(32) {
                    val packet = requireNotNull(reader.take(100))
                    if ((packet[5].toInt() and 255) == WebAudioHub.AIRPLAY_MIRROR_STREAM) return packet
                }
                error("No mirror audio record")
            }
            val initial = nextMirror()
            assertEquals(6, initial[4].toInt())
            val epoch = ByteBuffer.wrap(initial).getInt(16)
            audio.offer(byteArrayOf(1), 0, 1_000_000_000)
            assertEquals(7, nextMirror()[4].toInt())
            repeat(2) { index ->
                val picture = open()
                shadowOf(Looper.getMainLooper()).idle()
                assertSame(audio, field(service, "mirrorAudio"))
                assertEquals(format, field(service, "mirrorAudioFormat"))
                audio.offer(byteArrayOf((index + 2).toByte()), (index + 1) * 512L, null)
                val packet = nextMirror()
                assertEquals("Picture setup must not send an audio ended/config reset", 7, packet[4].toInt())
                assertEquals(epoch, ByteBuffer.wrap(packet).getInt(16))
                assertEquals((index + 1) * 512.0 * 1_000_000 / 48000, ByteBuffer.wrap(packet).getDouble(28), 0.001)
                assertArrayEquals(byteArrayOf((index + 2).toByte()), packet.copyOfRange(36, packet.size))
                picture.close()
            }
            assertNull(reader.take(1))
        }
    }

    @Test fun pictureSetupCannotClearAnAudioFailureGateWithoutAFlushOrAudioSetup() = withService { service, open ->
        val failedFormat = ReceiverMirrorAudioFormat(8, 48000, 2, 512)
        field(service, "mirrorAudioFailedFormat", failedFormat)
        repeat(2) {
            open().close()
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(failedFormat, field(service, "mirrorAudioFailedFormat"))
            assertNull(field(service, "mirrorAudio"))
        }
    }

    private fun field(service: AirPlayReceiverService, name: String): Any? =
        AirPlayReceiverService::class.java.getDeclaredField(name).apply { isAccessible = true }.get(service)

    private fun field(service: AirPlayReceiverService, name: String, value: Any?) {
        AirPlayReceiverService::class.java.getDeclaredField(name).apply { isAccessible = true }.set(service, value)
    }
}
