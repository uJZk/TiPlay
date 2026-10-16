package com.shilapi.xcertplay

import android.os.Looper
import com.shilapi.xcertplay.receiver.ReceiverConfig
import com.shilapi.xcertplay.receiver.ReceiverServer
import com.shilapi.xcertplay.web.BrowserAudioCapabilities
import com.shilapi.xcertplay.web.BrowserLinkServer
import com.shilapi.xcertplay.web.BrowserVideoCapabilities
import com.shilapi.xcertplay.web.BrowserViewport
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AirPlayReceiverAudioCapabilitiesTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var callbacks: BrowserLinkServer.Callbacks

    @Before fun reset() {
        TeslaBrowserLink.resetForTest()
        listOf("tiplay_browser_link", "tiplay_airplay_receiver", "xcertplay_airplay").forEach {
            app.getSharedPreferences(it, 0).edit().clear().commit()
        }
        TeslaBrowserLink.serverFactory = TeslaBrowserLink.ServerFactory { _, listener ->
            callbacks = listener
            object : TeslaBrowserLink.Server {
                override fun start() = Result.success(TeslaBrowserLink.PORT)
                override fun stop() = Unit
            }
        }
        TeslaBrowserLink.start(app)
        assertTrue(TeslaBrowserLink.awaitIdle())
    }

    @After fun clear() {
        TeslaBrowserLink.resetForTest()
        TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
    }

    @Test fun receiverUsesLiveAudioSupportAndUpdatesFutureNegotiationsAcrossBrowserChanges() {
        val first = (1L shl 2) or (1L shl 25)
        val report = BrowserViewport(1280, 720, 1280.0, 720.0, 1.0,
            BrowserVideoCapabilities(false, false, 0, 0), BrowserAudioCapabilities(first))
        callbacks.onBrowserSeen("first")
        callbacks.onViewport(report)
        assertNull(TeslaBrowserLink.readyViewport())
        assertEquals(first, TeslaBrowserLink.audioCapabilities()?.formats)
        val service = Robolectric.buildService(AirPlayReceiverService::class.java).create()
        val instance = service.get()
        val worker = AirPlayReceiverService::class.java.getDeclaredField("worker").apply { isAccessible = true }
            .get(instance) as ExecutorService
        fun drain() { worker.submit {}.get(5, TimeUnit.SECONDS) }
        fun identity() = AirPlayReceiverService::class.java.getDeclaredMethod("identity")
            .apply { isAccessible = true }.invoke(instance) as ReceiverConfig
        drain()
        val config = identity()
        assertEquals(first, config.audioOutputFormats)
        val receiver = ReceiverServer(config, mock(ReceiverServer.Listener::class.java))
        AirPlayReceiverService::class.java.getDeclaredField("server").apply { isAccessible = true }
            .set(instance, receiver)
        try {
            callbacks.onViewport(report.copy(audioCapabilities = BrowserAudioCapabilities(1L shl 2)))
            drain()
            assertEquals(1L shl 2, receiver.displayConfig.audioOutputFormats)

            AirPlayPersistence.saveFps(app, 30)
            BrowserSettingsChanges.apply(app)
            shadowOf(Looper.getMainLooper()).idle()
            drain()
            assertEquals(30, receiver.displayConfig.fps)
            assertEquals(1L shl 2, receiver.displayConfig.audioOutputFormats)

            callbacks.onBrowserSeen("second")
            drain()
            assertEquals(0L, receiver.displayConfig.audioOutputFormats)
            callbacks.onViewport(report.copy(audioCapabilities = null))
            drain()
            assertEquals(0L, receiver.displayConfig.audioOutputFormats)
            callbacks.onViewport(report.copy(audioCapabilities = BrowserAudioCapabilities(1L shl 25)))
            drain()
            assertEquals(1L shl 25, receiver.displayConfig.audioOutputFormats)

            // A timed-out authenticated page can leave geometry in memory, but cannot seed a new receiver.
            browserReadiness().clear()
            assertNull(TeslaBrowserLink.readyViewport())
            assertEquals(1L shl 25, TeslaBrowserLink.lastViewport(app)?.audioCapabilities?.formats)
            assertNull(TeslaBrowserLink.audioCapabilities())
            assertEquals(0L, identity().audioOutputFormats)
            worker.submit {
                AirPlayReceiverService::class.java.getDeclaredMethod("refreshDiscovery")
                    .apply { isAccessible = true }.invoke(instance)
            }.get(5, TimeUnit.SECONDS)
            assertEquals(0L, receiver.displayConfig.audioOutputFormats)
            callbacks.onBrowserGone("second")
            drain()
            assertEquals(0L, receiver.displayConfig.audioOutputFormats)
        } finally {
            service.destroy()
            assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS))
        }
    }
}
