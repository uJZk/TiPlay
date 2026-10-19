package com.shilapi.xcertplay

import android.os.Looper
import android.view.Surface
import com.shilapi.xcertplay.airplay.AirPlayContact
import com.shilapi.xcertplay.airplay.AirPlayKnobState
import com.shilapi.xcertplay.airplay.CarPlayScreenBorrowState
import com.shilapi.xcertplay.airplay.CarPlayScreenOwner
import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.media.AndroidMediaSink
import com.shilapi.xcertplay.media.BrowserAudioMediaSink
import com.shilapi.xcertplay.media.BrowserOnlyMediaSink
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import com.shilapi.xcertplay.web.BrowserLinkServer
import com.shilapi.xcertplay.web.BrowserLinkStatus
import com.shilapi.xcertplay.web.BrowserAudioCapabilities
import com.shilapi.xcertplay.web.BrowserSize
import com.shilapi.xcertplay.web.BrowserVideoCapabilities
import com.shilapi.xcertplay.web.BrowserViewport
import java.net.BindException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.`when`
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TeslaBrowserLinkTest {
    private val context get() = RuntimeEnvironment.getApplication()

    /** A server whose bind answers from [binds]; it records its callbacks and every start and stop. */
    private inner class FakeServer(val callbacks: BrowserLinkServer.Callbacks) :
        TeslaBrowserLink.Server {
        val stops = AtomicInteger()
        override fun start(): Result<Int> = binds.poll() ?: Result.success(TeslaBrowserLink.PORT)
        override fun stop() { stops.incrementAndGet() }
    }

    private val servers = CopyOnWriteArrayList<FakeServer>()
    private val binds = ConcurrentLinkedQueue<Result<Int>>()
    private val states = CopyOnWriteArrayList<TeslaBrowserLink.State>()
    private val stateListener: (TeslaBrowserLink.State) -> Unit = { states += it }

    @Before fun setUp() {
        TeslaBrowserLink.resetForTest()
        BrowserAppearance.update(mapOf("themeDark" to false))
        context.getSharedPreferences("tiplay_browser_link", 0).edit().clear().commit()
        TeslaBrowserLink.serverFactory = TeslaBrowserLink.ServerFactory { _, callbacks ->
            FakeServer(callbacks).also { servers += it }
        }
        TeslaBrowserLink.backoffMillis = { 20L }
        TeslaBrowserLink.addListener(stateListener)
    }

    @After fun tearDown() {
        DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
        TeslaBrowserLink.resetForTest()
        TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
        TeslaBrowserLink.backoffMillis = { failures -> minOf(30_000L, 1_000L shl minOf(failures, 5)) }
        TeslaBrowserLink.clock = android.os.SystemClock::elapsedRealtime
        CarPlayBackgroundSession.clear()
        listOf("tiplay_browser_link", "xcertplay_airplay", "tiplay_hotspot_address").forEach {
            context.getSharedPreferences(it, 0).edit().clear().commit()
        }
    }

    private fun eventually(what: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!condition()) {
            if (System.nanoTime() > deadline) throw AssertionError("$what; states=$states")
            Thread.sleep(5)
        }
    }

    private fun started(): FakeServer {
        TeslaBrowserLink.start(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        return servers.last()
    }

    @Test fun unitTestsRunWithTheNoSocketApplication() {
        // Without it every activity test in phone + browser mode would listen on port 8080 of every address.
        assertTrue(context is TiPlayTestApplication)
        TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
        assertEquals(Result.success(8080), TiPlayTestApplication.noSocketServers.create(TeslaBrowserLink.hub,
            org.mockito.Mockito.mock(BrowserLinkServer.Callbacks::class.java)).start())
    }

    @Test fun startListensOnceAndStopFreesThePort() {
        val server = started()
        TeslaBrowserLink.start(context)
        TeslaBrowserLink.sync(context) // phone + browser mode is the default
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals("Starting again binds nothing new", 1, servers.size)
        assertEquals(TeslaBrowserLink.State.Listening(8080), TeslaBrowserLink.state)
        assertTrue(TeslaBrowserLink.active)

        TeslaBrowserLink.stop()
        TeslaBrowserLink.stop()
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(1, server.stops.get())
        assertEquals(TeslaBrowserLink.State.Stopped, TeslaBrowserLink.state)
        assertFalse(TeslaBrowserLink.active)
        assertEquals(listOf(TeslaBrowserLink.State.Listening(8080), TeslaBrowserLink.State.Stopped), states)
    }

    @Test fun linksUseTheListeningPortIncludingWhenNoHotspotAddressIsKnown() {
        BrowserEndpointSettings.savePort(context, 8081)
        binds += Result.success(8081)
        started()
        val code = TeslaBrowserLink.pairingCode(context)
        assertEquals(8081, TeslaBrowserLink.listeningPort(context))
        assertEquals("https://ujzk.github.io/TiPlay/webrtc/?t=169.254.111.111:8081#c=$code",
            TeslaBrowserLink.pageLink(context, null))
        assertEquals("https://ujzk.github.io/TiPlay/webrtc/?t=192.168.43.1:8081#c=$code",
            TeslaBrowserLink.pageLink(context, "192.168.43.1"))
    }

    @Test fun aTakenPortIsRetriedUntilItIsFree() {
        binds += Result.failure(BindException("Address already in use"))
        binds += Result.failure(BindException("Address already in use"))
        TeslaBrowserLink.start(context)
        eventually("listening after the port frees") { states.lastOrNull() == TeslaBrowserLink.State.Listening(8080) }
        assertEquals(3, servers.size)
        assertEquals("Each failed attempt is closed", listOf(1, 1, 0), servers.map { it.stops.get() })
        assertEquals(listOf(TeslaBrowserLink.State.PortInUse, TeslaBrowserLink.State.Listening(8080)), states)
    }

    @Test fun anotherBindFailureIsReportedAndRetriedToo() {
        binds += Result.failure(java.io.IOException("no network"))
        TeslaBrowserLink.start(context)
        eventually("listening on the second attempt") { states.lastOrNull() is TeslaBrowserLink.State.Listening }
        assertEquals(listOf(TeslaBrowserLink.State.Failed, TeslaBrowserLink.State.Listening(8080)), states)
    }

    @Test fun stoppingWhileThePortIsTakenCancelsTheRetry() {
        TeslaBrowserLink.backoffMillis = { 300L }
        repeat(5) { binds += Result.failure(BindException("Address already in use")) }
        TeslaBrowserLink.start(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.PortInUse, TeslaBrowserLink.state)
        TeslaBrowserLink.stop()
        assertTrue(TeslaBrowserLink.awaitIdle())
        Thread.sleep(500)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals("No attempt after stop", 1, servers.size)
        assertEquals(TeslaBrowserLink.State.Stopped, TeslaBrowserLink.state)
    }

    @Test fun syncFollowsTheRunModeInEffect() {
        useHeadUnitMode(context)
        TeslaBrowserLink.sync(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertTrue("A head unit starts no browser link", servers.isEmpty())
        assertFalse(TeslaBrowserLink.hasPairingCode(context))

        AirPlayPersistence.saveRunMode(context, CarPlayRunMode.PHONE_BROWSER)
        TeslaBrowserLink.sync(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.Listening(8080), TeslaBrowserLink.state)

        // A running phone session keeps its link after head-unit mode is saved for the next connection.
        val session = storeSession(phoneBrowser = true)
        useHeadUnitMode(context)
        TeslaBrowserLink.sync(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.Listening(8080), TeslaBrowserLink.state)
        CarPlayBackgroundSession.clear(session)
        TeslaBrowserLink.sync(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(TeslaBrowserLink.State.Stopped, TeslaBrowserLink.state)
    }

    @Test fun thePairingCodeIsFourDigitsKeptAcrossRestartsAndReplacedOnRequest() {
        val server = started()
        val code = TeslaBrowserLink.pairingCode(context)
        assertTrue(code, Regex("[0-9]{4}").matches(code))
        assertEquals(code, server.callbacks.code())
        assertEquals(code, context.getSharedPreferences("tiplay_browser_link", 0).getString("pairing_code", null))

        TeslaBrowserLink.resetForTest() // a new process reads the saved code
        assertEquals(code, TeslaBrowserLink.pairingCode(context))

        val restarted = started()
        val codes = (1..20).map { TeslaBrowserLink.newPairingCode(context) }
        (listOf(code) + codes).zipWithNext().forEach { (previous, replacement) ->
            assertNotEquals(previous, replacement)
            assertTrue(Regex("[0-9]{4}").matches(replacement))
        }
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertTrue("SecureRandom codes vary", codes.toSet().size > 1)
        assertEquals(codes.last(), TeslaBrowserLink.pairingCode(context))
        assertEquals(codes.last(), servers.last().callbacks.code())
        assertEquals("A new code ends the old browser session: the server restarts", 1, restarted.stops.get())
        assertEquals(TeslaBrowserLink.State.Listening(8080), TeslaBrowserLink.state)
    }

    @Test fun persistedSixDigitPairingCodeMigratesOnFirstLoad() {
        val prefs = context.getSharedPreferences("tiplay_browser_link", 0)
        prefs.edit().putString("pairing_code", "123456").commit()
        assertFalse(TeslaBrowserLink.hasPairingCode(context))
        val migrated = TeslaBrowserLink.pairingCode(context)
        assertTrue(Regex("[0-9]{4}").matches(migrated))
        assertEquals(migrated, prefs.getString("pairing_code", null))
        TeslaBrowserLink.resetForTest()
        assertEquals(migrated, TeslaBrowserLink.pairingCode(context))
    }

    @Test fun persistedFourDigitPairingCodePreservesLeadingZeros() {
        val prefs = context.getSharedPreferences("tiplay_browser_link", 0)
        prefs.edit().putString("pairing_code", "0042").commit()
        assertTrue(TeslaBrowserLink.hasPairingCode(context))
        assertEquals("0042", TeslaBrowserLink.pairingCode(context))
        assertEquals("0042", started().callbacks.code())
        assertNotEquals("0042", TeslaBrowserLink.newPairingCode(context))
    }

    @Test fun decoderLimitedCanvasDoesNotOfferRepeatedFitReconnects() {
        started().callbacks.onViewport(BrowserViewport(1920, 1080, 960.0, 540.0, 2.0,
            com.shilapi.xcertplay.web.BrowserVideoCapabilities(true, false, 1280, 720)))
        assertNull(TeslaBrowserLink.fitReason(context, BrowserSize(1280, 720)))
        assertEquals(BrowserSize(1280, 720), TeslaBrowserLink.status().viewport)
    }

    @Test fun theLastValidViewportIsSavedForTheNextConnection() {
        val server = started()
        val viewport = BrowserViewport(1182, 920, 773.0, 601.0, 1.53)
        server.callbacks.onViewport(viewport)
        assertEquals(viewport.size, TeslaBrowserLink.lastViewport(context)?.size)
        TeslaBrowserLink.resetForTest()
        val saved = TeslaBrowserLink.lastViewport(context)!!
        assertEquals(BrowserSize(1182, 920), saved.size)
        assertEquals(773.0, saved.cssWidth, 0.01)
        assertEquals(1.53, saved.devicePixelRatio, 0.01)
        // An invalid saved size (an older or edited file) is no viewport.
        context.getSharedPreferences("tiplay_browser_link", 0).edit().putInt("viewport_width", 100).commit()
        TeslaBrowserLink.resetForTest()
        assertNull(TeslaBrowserLink.lastViewport(context))
    }

    @Test fun resizeKeepsTheCurrentBrowsersAudioProbeAndNewMeasurementsReplaceIt() {
        val callbacks = started().callbacks
        val first = BrowserAudioCapabilities((1L shl 2) or (1L shl 25))
        val report = BrowserViewport(1280, 720, 1280.0, 720.0, 1.0,
            BrowserVideoCapabilities(true, false, 1920, 1080), first)
        val seen = mutableListOf<BrowserViewport?>()
        TeslaBrowserLink.listenViewport(context, seen::add).use {
            callbacks.onBrowserSeen("first")
            callbacks.onViewport(report)
            callbacks.onViewport(report.copy(width = 1200, audioCapabilities = null))
            assertEquals(first, TeslaBrowserLink.readyViewport()?.audioCapabilities)
            assertEquals(first, seen.last()?.audioCapabilities)
            val unsupported = BrowserAudioCapabilities(0L)
            callbacks.onViewport(report.copy(width = 1200, audioCapabilities = unsupported))
            assertEquals(unsupported, TeslaBrowserLink.readyViewport()?.audioCapabilities)
            assertEquals(unsupported, seen.last()?.audioCapabilities)
        }
    }

    @Test fun replacementBrowserCannotInheritAudioAndAnOldDisconnectCannotClearItsProbe() {
        val callbacks = started().callbacks
        val report = BrowserViewport(1280, 720, 1280.0, 720.0, 1.0,
            BrowserVideoCapabilities(true, false, 1920, 1080), BrowserAudioCapabilities(1L shl 25))
        val seen = mutableListOf<BrowserViewport?>()
        TeslaBrowserLink.listenViewport(context, seen::add).use {
            callbacks.onBrowserSeen("first")
            callbacks.onViewport(report)
            callbacks.onBrowserSeen("second")
            assertNull(TeslaBrowserLink.readyViewport())
            assertNull(TeslaBrowserLink.lastViewport(context)?.audioCapabilities)
            assertNull(seen.last()?.audioCapabilities)
            callbacks.onViewport(report.copy(audioCapabilities = null))
            assertNull(TeslaBrowserLink.readyViewport()?.audioCapabilities)
            val second = BrowserAudioCapabilities(1L shl 2)
            callbacks.onViewport(report.copy(audioCapabilities = second))
            callbacks.onBrowserGone("first")
            assertEquals(second, TeslaBrowserLink.readyViewport()?.audioCapabilities)
            callbacks.onBrowserGone("second")
            assertNull(TeslaBrowserLink.readyViewport())
            assertNull(seen.last()?.audioCapabilities)
            callbacks.onBrowserSeen("second")
            callbacks.onViewport(report.copy(audioCapabilities = null))
            assertNull(TeslaBrowserLink.readyViewport()?.audioCapabilities)
        }
    }

    @Test fun serverStopClearsAudioAndRestartLoadsOnlySavedGeometry() {
        val callbacks = started().callbacks
        callbacks.onBrowserSeen("first")
        callbacks.onViewport(BrowserViewport(1280, 720, 1280.0, 720.0, 1.0,
            BrowserVideoCapabilities(true, false, 1920, 1080), BrowserAudioCapabilities(1L shl 25)))
        val seen = mutableListOf<BrowserViewport?>()
        TeslaBrowserLink.listenViewport(context, seen::add).use {
            TeslaBrowserLink.stop()
            assertTrue(TeslaBrowserLink.awaitIdle())
            assertNull(TeslaBrowserLink.readyViewport())
            assertNull(TeslaBrowserLink.lastViewport(context)?.audioCapabilities)
            assertNull(seen.last()?.audioCapabilities)
        }
        TeslaBrowserLink.resetForTest()
        assertEquals(BrowserSize(1280, 720), TeslaBrowserLink.lastViewport(context)?.size)
        assertNull(TeslaBrowserLink.lastViewport(context)?.audioCapabilities)
    }

    @Test fun viewportAndFitReachTheCarPlayScreenOnTheMainThread() {
        val server = started()
        val seen = CopyOnWriteArrayList<String>()
        val logs = CopyOnWriteArrayList<String>()
        val host = object : TeslaBrowserLink.Host {
            override fun log(message: String) { logs += message }
            override fun onBrowserFit() { seen += "fit main=${Looper.myLooper() == Looper.getMainLooper()}" }
            override fun onBrowserViewport(viewport: BrowserViewport) { seen += "vp ${viewport.width} main=${Looper.myLooper() == Looper.getMainLooper()}" }
        }
        TeslaBrowserLink.attachHost(host)
        val thread = Thread {
            server.callbacks.onViewport(BrowserViewport(1256, 706, 821.0, 461.0, 1.53))
            server.callbacks.onFit()
        }.apply { start(); join() }
        assertFalse(thread.isAlive)
        assertTrue("Nothing runs on the server thread", seen.isEmpty())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("vp 1256 main=true", "fit main=true"), seen)
        assertTrue(logs.contains("Browser link: viewport 1256x706 css=821x461 dpr=1.53"))

        TeslaBrowserLink.detachHost(host)
        server.callbacks.onFit()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(2, seen.size)
    }

    @Test fun fitReconnectsOnlyARunningSessionOnAnotherCanvas() {
        started().callbacks.onViewport(BrowserViewport(1256, 706, 821.0, 461.0, 1.53))
        assertNull(TeslaBrowserLink.fitReason(context, null))
        assertNull(TeslaBrowserLink.fitReason(context, BrowserSize(1256, 706)))
        assertNull("8 px is close enough", TeslaBrowserLink.fitReason(context, BrowserSize(1262, 710)))
        assertEquals("Browser asked to fit: reconnecting CarPlay at 1256x706 (was 1182x920)",
            TeslaBrowserLink.fitReason(context, BrowserSize(1182, 920)))
    }

    @Test fun touchesAndKeysGoToTheRunningSession() {
        val server = started()
        val contacts = listOf(AirPlayContact(0, 0.25, 0.75, true), AirPlayContact(1, 0.0, 0.0, false))
        assertFalse("No session takes touches", server.callbacks.onTouch(contacts))
        server.callbacks.onKey("home")

        val session = storeSession(phoneBrowser = true)
        `when`(session.sendTouch(contacts)).thenReturn(true)
        assertTrue(server.callbacks.onTouch(contacts))
        server.callbacks.onKey("home")
        server.callbacks.onKey("back")
        server.callbacks.onKey("siri")
        verify(session).sendTouch(contacts)
        verify(session).sendKnob(AirPlayKnobState(home = true))
        verify(session).sendKnob(AirPlayKnobState(back = true))
        verify(session).requestSiri()
    }

    @Test fun airplayPauseKeepsCarPlayButStopsHiddenTouchAndKeyInputUntilResume() {
        val server = started()
        val controller = storeSession(phoneBrowser = true)
        CarPlayBackgroundSession.active = true
        val contacts = listOf(AirPlayContact(0, 0.25, 0.75, true))
        `when`(controller.sendTouch(contacts)).thenReturn(true)
        TeslaBrowserLink.pauseCarPlayDisplay()
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertTrue(CarPlayBackgroundSession.hasSession())
        assertFalse(server.callbacks.status().touchAvailable)
        assertFalse(server.callbacks.onTouch(contacts))
        server.callbacks.onKey("home")
        verify(controller, org.mockito.Mockito.atLeastOnce()).sendTouch(emptyList())
        verify(controller, org.mockito.Mockito.never()).sendTouch(contacts)
        verify(controller, org.mockito.Mockito.never()).sendKnob(AirPlayKnobState(home = true))
        TeslaBrowserLink.resumeCarPlayDisplay()
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertTrue(server.callbacks.status().touchAvailable)
        assertTrue(server.callbacks.onTouch(contacts))
    }

    @Test fun stoppingAirPlayServiceRestoresTheRetainedCarPlayProducerAndKeepsItsSessionAlive() {
        storeSession(phoneBrowser = true)
        val retained = CarPlayBackgroundSession.snapshot()!!
        val carPlay = TeslaBrowserLink.tee(retained.sink, true, 1920, 1080, 60)
        val avcc = byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18)
        carPlay.onScreenStreamActive(110, true)
        carPlay.onVideoCodec(110, VideoCodec.H264); carPlay.onVideoConfig(110, avcc)
        TeslaBrowserLink.pauseCarPlayDisplay()
        assertTrue(TeslaBrowserLink.awaitIdle())
        val borrowed = com.shilapi.xcertplay.web.WebMediaSink(TeslaBrowserLink.hub, 720, 1280, 60)
        borrowed.onScreenStreamActive(110, true)
        val service = org.robolectric.Robolectric.buildService(AirPlayReceiverService::class.java).create()
        service.destroy()
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertEquals(1920, TeslaBrowserLink.hub.info()!!.width)
        assertEquals("avc1.640028", TeslaBrowserLink.hub.info()!!.codec)
        assertTrue(CarPlayBackgroundSession.hasSession())
        borrowed.close()
        assertEquals(1920, TeslaBrowserLink.hub.info()!!.width)
        TeslaBrowserLink.releaseTap(retained.sink)
    }

    @Test fun screenLoanWaitsForOwnershipAndReturnsWithoutPausingCarPlayAudio() {
        started()
        val controller = storeSession(phoneBrowser = true)
        val retained = CarPlayBackgroundSession.snapshot()!!
        val carPlay = TeslaBrowserLink.tee(retained.sink, true, 1920, 1080, 60)
        carPlay.onScreenStreamActive(110, true)
        carPlay.onVideoCodec(110, VideoCodec.H264)
        carPlay.onVideoConfig(110, byteArrayOf(1, 0x64, 0, 0x28, -1, -31, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, -18))
        val audio = audioTapsAtRest().single().second
        val reader = TeslaBrowserLink.audioHub.subscribe()
        val screen = AtomicReference(CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Controller, true))
        val changed = AtomicReference<(() -> Unit)?>(null)
        `when`(controller.screenBorrowState).thenAnswer { screen.get() }
        org.mockito.Mockito.doAnswer { call ->
            changed.set(call.getArgument(0))
            java.io.Closeable { changed.set(null) }
        }.`when`(controller).listenScreenBorrow(org.mockito.ArgumentMatchers.any<() -> Unit>() ?: {})
        val ended = AtomicInteger()
        TeslaBrowserLink.attachHost(object : TeslaBrowserLink.Host {
            override fun log(message: String) {}
            override fun onBrowserFit() {}
            override fun onAirPlayEnded() { ended.incrementAndGet() }
        })
        val availability = CopyOnWriteArrayList<Boolean>()
        val mirror = com.shilapi.xcertplay.web.WebMediaSink(TeslaBrowserLink.hub, 720, 1280, 60,
            com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY)
        fun assertCarPlayAudioContinues() {
            TeslaBrowserLink.audioHub.publish(audio, 0, 48000, 1, byteArrayOf(42, 0))
            assertEquals(42, reader.take(100)!![28].toInt())
        }
        try {
            TeslaBrowserLink.pauseCarPlayDisplay { ready ->
                availability += ready
                if (ready) { mirror.resumeDisplay(); mirror.onScreenStreamActive(110, true) }
                else mirror.pauseDisplay()
            }
            assertTrue(TeslaBrowserLink.awaitIdle())
            verify(controller).setScreenBorrowed(true)
            assertEquals(listOf(false), availability)
            assertEquals("A pending request retains the actual CarPlay owner", 1920, TeslaBrowserLink.hub.info()?.width)
            assertFalse(TeslaBrowserLink.airPlayDisplayReady)
            assertCarPlayAudioContinues()

            screen.set(CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Accessory, false))
            changed.get()!!.invoke()
            assertTrue(TeslaBrowserLink.awaitIdle())
            assertEquals(listOf(false, true), availability)
            assertEquals(720, TeslaBrowserLink.hub.info()?.width)
            assertTrue(TeslaBrowserLink.airPlayDisplayReady)
            assertCarPlayAudioContinues()

            screen.set(CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Controller, false))
            changed.get()!!.invoke()
            assertTrue(TeslaBrowserLink.awaitIdle())
            assertEquals(listOf(false, true, false), availability)
            assertEquals("Revoking the loan releases the mirror before restoring CarPlay", 1920, TeslaBrowserLink.hub.info()?.width)
            assertFalse(TeslaBrowserLink.airPlayDisplayReady)
            assertTrue("AirPlay keeps its request while the iPhone owns the screen", TeslaBrowserLink.airPlayActive)
            assertCarPlayAudioContinues()

            screen.set(CarPlayScreenBorrowState(true, true, CarPlayScreenOwner.Accessory, false))
            changed.get()!!.invoke()
            assertTrue(TeslaBrowserLink.awaitIdle())
            assertEquals(listOf(false, true, false, true), availability)
            assertEquals("A new ownership grant resumes the existing mirror", 720, TeslaBrowserLink.hub.info()?.width)
            assertTrue(TeslaBrowserLink.airPlayDisplayReady)
            assertCarPlayAudioContinues()

            mirror.close()
            screen.set(CarPlayScreenBorrowState(false, false, CarPlayScreenOwner.Accessory, true))
            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            verify(controller).setScreenBorrowed(false)
            shadowOf(Looper.getMainLooper()).idle()
            assertNull("Returning the screen waits for modesChanged", TeslaBrowserLink.hub.info())
            assertTrue(TeslaBrowserLink.airPlayActive)
            assertEquals(0, ended.get())
            assertCarPlayAudioContinues()

            screen.set(CarPlayScreenBorrowState(false, false, CarPlayScreenOwner.Controller, false))
            changed.get()!!.invoke()
            assertTrue(TeslaBrowserLink.awaitIdle())
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1920, TeslaBrowserLink.hub.info()?.width)
            assertEquals("avc1.640028", TeslaBrowserLink.hub.info()?.codec)
            assertFalse(TeslaBrowserLink.airPlayActive)
            assertEquals(1, ended.get())
            assertCarPlayAudioContinues()
        } finally {
            mirror.close()
            reader.close()
            TeslaBrowserLink.releaseTap(retained.sink)
        }
    }

    @Test fun newCarPlayTapAndDelayedResumeCannotStealAMirrorWhileItsConfigIsPending() {
        val server = started()
        storeSession(phoneBrowser = true)
        val retained = CarPlayBackgroundSession.snapshot()!!
        TeslaBrowserLink.pauseCarPlayDisplay()
        assertTrue(TeslaBrowserLink.awaitIdle())
        val mirror = com.shilapi.xcertplay.web.WebMediaSink(TeslaBrowserLink.hub, 498, 1080, 60,
            com.shilapi.xcertplay.web.BrowserDisplaySource.AIRPLAY)
        try {
            mirror.onScreenStreamActive(110, true)
            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            val carPlay = TeslaBrowserLink.tee(retained.sink, true, 1920, 1080, 60)
            carPlay.onScreenStreamActive(110, true)
            assertEquals(498, TeslaBrowserLink.hub.info()!!.width)
            assertFalse(server.callbacks.status().touchAvailable)
            assertFalse(TeslaBrowserLink.audioHub.voiceStatus()["muted"] as Boolean)
            TeslaBrowserLink.releaseTap(retained.sink)
            assertEquals(498, TeslaBrowserLink.hub.info()!!.width)
            assertTrue(TeslaBrowserLink.active)
        } finally {
            mirror.close()
            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            TeslaBrowserLink.releaseTap(retained.sink)
        }
    }

    @Test fun appearanceChangesReachTheMainThreadWithoutTheStatsLogThrottle() {
        val server = started()
        val seen = mutableListOf<Boolean>()
        TeslaBrowserLink.attachHost(object : TeslaBrowserLink.Host {
            override fun log(message: String) = Unit
            override fun onBrowserFit() = Unit
            override fun onBrowserTheme(night: Boolean) {
                assertEquals(Looper.getMainLooper(), Looper.myLooper())
                assertEquals(night, BrowserAppearance.night)
                seen += night
            }
        })
        shadowOf(Looper.getMainLooper()).idle()
        seen.clear()
        Thread {
            server.callbacks.onBrowserStats(mapOf("themeDark" to true))
            server.callbacks.onBrowserStats(mapOf("themeDark" to false))
            server.callbacks.onBrowserStats(mapOf("themeDark" to "true"))
        }.apply { start(); join() }
        assertTrue(seen.isEmpty())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf(true, false), seen)
    }

    @Test fun screenLoanDoesNotWaitForAudioAndConcurrentRetirementRemainsSafe() {
        val sinks = List(3) { mock(MediaSink::class.java) }
        val streams = sinks.map { TeslaBrowserLink.tee(it, true, 1182, 920) }
        streams.last().onScreenStreamActive(110, true)
        val entries = audioTapsAtRest()
        val firstAudio = entries.first().second
        val retiringSink = entries[1].first
        val retiringStream = streams[sinks.indexOf(retiringSink)]
        val locked = CountDownLatch(1)
        val releaseAudio = CountDownLatch(1)
        val displayChanged = CountDownLatch(1)
        val retired = CountDownLatch(1)
        val failures = ConcurrentLinkedQueue<Throwable>()
        val workers = mutableListOf<Thread>()
        fun worker(name: String, action: () -> Unit) = Thread({
            try { action() } catch (error: Throwable) { failures.add(error) }
        }, name).apply { isDaemon = true; workers.add(this); start() }

        try {
            worker("hold-first-audio") {
                synchronized(firstAudio) {
                    locked.countDown()
                    assertTrue("Release the held audio monitor", releaseAudio.await(5, TimeUnit.SECONDS))
                }
            }
            assertTrue(locked.await(5, TimeUnit.SECONDS))
            worker("lend-screen") {
                TeslaBrowserLink.pauseCarPlayDisplay()
                assertTrue(TeslaBrowserLink.awaitIdle())
                displayChanged.countDown()
            }
            worker("retire-another-tap") {
                TeslaBrowserLink.releaseTap(retiringSink)
                retired.countDown()
            }
            assertTrue("Screen borrowing does not acquire an audio sink monitor", displayChanged.await(2, TimeUnit.SECONDS))
            assertTrue("Another tap can retire while audio remains locked", retired.await(2, TimeUnit.SECONDS))
        } finally {
            releaseAudio.countDown()
            workers.forEach { it.join(5_000) }
        }
        assertTrue("No transition deadlocked", workers.none { it.isAlive })
        assertTrue("Pause and retirement must both succeed: $failures", failures.isEmpty())
        assertNull("All remaining displays were paused", TeslaBrowserLink.hub.info())

        storeSession(phoneBrowser = true)
        val retained = CarPlayBackgroundSession.snapshot()!!
        val next = TeslaBrowserLink.tee(retained.sink, true, 1920, 1080)
        try {
            next.onScreenStreamActive(110, true)
            assertNull("A new tap inherits the active AirPlay pause", TeslaBrowserLink.hub.info())
            TeslaBrowserLink.resumeCarPlayDisplay()
            assertTrue(TeslaBrowserLink.awaitIdle())
            assertEquals(1920, TeslaBrowserLink.hub.info()?.width)
            retiringStream.onScreenStreamActive(110, true)
            TeslaBrowserLink.releaseTap(retiringSink)
            assertEquals("A retired tap cannot take or clear the replacement", 1920, TeslaBrowserLink.hub.info()?.width)
        } finally {
            TeslaBrowserLink.releaseTap(retained.sink)
            sinks.forEach(TeslaBrowserLink::releaseTap)
        }
    }

    @Test fun delayedRetiredAudioCloseDoesNotHoldTheTapRegistryOrCloseTheReplacement() {
        val sink = mock(MediaSink::class.java)
        TeslaBrowserLink.tee(sink, true, 1182, 920).onScreenStreamActive(110, true)
        val audio = audioTapsAtRest().single().second
        val nextSink = mock(MediaSink::class.java)
        val failures = ConcurrentLinkedQueue<Throwable>()
        val created = CountDownLatch(1)
        val workers = mutableListOf<Thread>()
        fun worker(name: String, action: () -> Unit) = Thread({
            try { action() } catch (error: Throwable) { failures.add(error) }
        }, name).apply { isDaemon = true; workers.add(this); start() }
        try {
            synchronized(audio) {
                val retiring = worker("retire-blocked-audio") { TeslaBrowserLink.releaseTap(sink) }
                eventually("retirement reached sink teardown") { retiring.state == Thread.State.BLOCKED }
                worker("create-replacement-tap") {
                    TeslaBrowserLink.tee(nextSink, true, 1920, 1080).onScreenStreamActive(110, true)
                    created.countDown()
                }
                assertTrue("New taps do not wait for detached audio teardown", created.await(5, TimeUnit.SECONDS))
                assertEquals(1920, TeslaBrowserLink.hub.info()?.width)
            }
        } finally {
            workers.forEach { it.join(5_000) }
        }
        assertTrue("No transition deadlocked", workers.none { it.isAlive })
        assertTrue("Retirement and replacement must both succeed: $failures", failures.isEmpty())
        assertEquals("Late old video teardown is owner-specific", 1920, TeslaBrowserLink.hub.info()?.width)
        TeslaBrowserLink.releaseTap(nextSink)
        assertNull(TeslaBrowserLink.hub.info())
    }

    /** Obtain actual runtime monitors before starting workers, without a production test hook. */
    @Suppress("UNCHECKED_CAST")
    private fun audioTapsAtRest(): List<Pair<MediaSink, BrowserAudioMediaSink>> {
        val field = TeslaBrowserLink::class.java.getDeclaredField("audioTaps").apply { isAccessible = true }
        val taps = field.get(TeslaBrowserLink) as Map<MediaSink, BrowserAudioMediaSink>
        return taps.entries.map { it.key to it.value }
    }

    @Test fun detachedAppearanceReachesTheRetainedPhoneSessionAndTheNextHost() {
        val server = started()
        val session = storeSession(phoneBrowser = true)
        server.callbacks.onBrowserStats(mapOf("themeDark" to true))
        shadowOf(Looper.getMainLooper()).idle()
        verify(session).sendNightMode(true)
        val seen = mutableListOf<Boolean>()
        TeslaBrowserLink.attachHost(object : TeslaBrowserLink.Host {
            override fun log(message: String) = Unit
            override fun onBrowserFit() = Unit
            override fun onBrowserTheme(night: Boolean) { seen += night }
        })
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf(true), seen)
    }

    @Test fun detachedBrowserAppearanceDoesNotOverrideARetainedHeadUnitSession() {
        val server = started()
        val session = storeSession(phoneBrowser = false)
        server.callbacks.onBrowserStats(mapOf("themeDark" to true))
        shadowOf(Looper.getMainLooper()).idle()
        verify(session, org.mockito.Mockito.never()).sendNightMode(true)
    }

    @Test fun theStatusFollowsTheSessionTheStreamAndTheViewport() {
        val server = started()
        val idle = server.callbacks.status()
        assertEquals(BrowserLinkStatus.State.IDLE, idle.state)
        assertNull(idle.videoSource)
        assertEquals(mapOf("state" to "preparing"), idle.receivers["carplay"])
        assertNull(idle.display)
        assertNull(idle.viewport)
        assertFalse(idle.touchAvailable)
        assertFalse(idle.fit)

        storeSession(phoneBrowser = true, width = 1280, height = 720)
        server.callbacks.onViewport(BrowserViewport(1182, 920, 773.0, 601.0, 1.53))
        val connecting = server.callbacks.status()
        assertEquals(BrowserLinkStatus.State.CONNECTING, connecting.state)
        assertEquals(BrowserSize(1280, 720), connecting.display)
        assertEquals(BrowserSize(1182, 920), connecting.viewport)
        assertTrue(connecting.touchAvailable)
        assertTrue("A session on another canvas offers Apply and reconnect", connecting.fit)

        val owner = Any()
        TeslaBrowserLink.hub.beginStream(owner, 1182, 920, 60, {}, {})
        try {
            val streaming = server.callbacks.status()
            assertEquals(BrowserLinkStatus.State.STREAMING, streaming.state)
            assertEquals("carplay", streaming.videoSource)
            assertEquals(BrowserSize(1182, 920), streaming.display)
            assertFalse(streaming.fit)
            assertEquals("not-needed", streaming.phone["localNetworkPermission"])
        } finally {
            TeslaBrowserLink.hub.endStream(owner)
        }
    }

    @Test fun anOversizedViewportAsksForTheCappedCanvasSoFitSettles() {
        val server = started()
        storeSession(phoneBrowser = true, width = 3840, height = 2160)
        server.callbacks.onViewport(BrowserViewport(4096, 2304, 2048.0, 1152.0, 2.0))
        val status = server.callbacks.status()
        assertEquals(BrowserSize(3840, 2160), status.viewport)
        assertFalse(status.fit)
    }

    @Test fun detailedAudioEvidenceReachesTheExportOnlyWhileDebugIsCurrentlyEnabled() {
        val server = started()
        val logs = CopyOnWriteArrayList<String>()
        TeslaBrowserLink.attachHost(object : TeslaBrowserLink.Host {
            override fun log(message: String) { logs += message }
            override fun onBrowserFit() = Unit
        })
        val directory = java.nio.file.Files.createTempDirectory("browser-audio-export").toFile()
        val raw = com.shilapi.xcertplay.diagnostics.RawTraffic
        val capture = java.io.File(directory, "raw.tsv")
        val detail = mapOf("pageVersion" to "v52", "pcmNonzero" to 400, "renderNonzero" to 0,
            "stream0.headMs" to 1792120000000L, "stream0.capacityPackets" to 117)
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.DEBUG
            raw.configure(capture, true)
            server.callbacks.onBrowserAudioDiagnostics(detail)
            assertTrue(logs.any { it.contains("pcmNonzero=400") && it.contains("renderNonzero=0") })
            assertTrue(logs.any { it.contains("headMs=1792120000000") && it.contains("capacityPackets=117") })
            val count = logs.size
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            raw.configure(capture, false)
            server.callbacks.onBrowserAudioDiagnostics(detail)
            assertEquals(count, logs.size)
        } finally {
            raw.configure(capture, false)
            directory.deleteRecursively()
        }
    }

    @Test fun browserStatsReachTheSessionLogAtMostEvery10Seconds() {
        val server = started()
        DiagnosticLogPolicy.level = DiagnosticLogLevel.DEBUG
        val logs = CopyOnWriteArrayList<String>()
        TeslaBrowserLink.attachHost(object : TeslaBrowserLink.Host {
            override fun log(message: String) { logs += message }
            override fun onBrowserFit() = Unit
        })
        var now = 100_000L
        TeslaBrowserLink.clock = { now }
        val stats = mapOf("link.path" to "worker-stream", "video.codec" to "avc1.640028", "video.decodedFps" to 59.9,
            "video.currentFps" to 58, "video.currentDelta" to -35.25, "video.droppedFrames" to 4L,
            "video.decodeMsP95" to 1.52, "video.gaps" to 0L, "video.dropped" to 3L, "video.decodeErrors" to 0L,
            "video.timingRecords" to 120L, "video.timingRejected" to 2L, "video.clockRttMs" to 4.25,
            "video.presentationOffset90" to -40.25, "video.presentationOffsetHigh5" to -10.5,
            "video.presentationOffsetSamples" to 118L,
            "link.reconnects" to 1L, "link.fallback" to "TypeError at 169.254.111.111", "code" to "123456")
        server.callbacks.onBrowserStats(stats)
        now += 9_999
        server.callbacks.onBrowserStats(stats)
        now += 1
        server.callbacks.onBrowserStats(stats + ("video.codec" to "x".repeat(40)))
        val lines = logs.filter { it.startsWith("Browser:") }
        assertEquals(listOf(
            "Browser: path=worker-stream codec=avc1.640028 fps=59.9 currentFps=58 deltaMs=-35.3 droppedFrames=4 decodeP95Ms=1.5 timingRecords=120 timingRejected=2 clockRttMs=4.3 presentationOffset90=-40.3 presentationOffsetHigh5=-10.5 presentationOffsetSamples=118 gaps=0 dropped=3 errors=0 reconnects=1 audioBluetooth=- audioSound=- audioTimedPackets=- audioFallbackPackets=- audioQueuedBytes=-",
            "Browser: path=worker-stream codec=? fps=59.9 currentFps=58 deltaMs=-35.3 droppedFrames=4 decodeP95Ms=1.5 timingRecords=120 timingRejected=2 clockRttMs=4.3 presentationOffset90=-40.3 presentationOffsetHigh5=-10.5 presentationOffsetSamples=118 gaps=0 dropped=3 errors=0 reconnects=1 audioBluetooth=- audioSound=- audioTimedPackets=- audioFallbackPackets=- audioQueuedBytes=-",
        ), lines)
        for (line in lines) assertEquals(line, DiagnosticRedactor.redact(line))
        assertEquals("Browser: path=- codec=- fps=- currentFps=- deltaMs=- droppedFrames=- decodeP95Ms=- timingRecords=- timingRejected=- clockRttMs=- presentationOffset90=- presentationOffsetHigh5=- presentationOffsetSamples=- gaps=- dropped=- errors=- reconnects=- audioBluetooth=- audioSound=- audioTimedPackets=- audioFallbackPackets=- audioQueuedBytes=-",
            TeslaBrowserLink.statsLine(emptyMap()))
    }

    @Test fun standardBrowserStatsRecordOnlyNewAnomaliesAndKeepThemeDelivery() {
        val server = started()
        DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
        val logs = CopyOnWriteArrayList<String>()
        TeslaBrowserLink.attachHost(object : TeslaBrowserLink.Host {
            override fun log(message: String) { logs += message }
            override fun onBrowserFit() = Unit
        })
        var now = 100_000L
        TeslaBrowserLink.clock = { now }
        fun report(drops: Long) {
            server.callbacks.onBrowserStats(mapOf("video.droppedFrames" to drops, "themeDark" to true))
            now += TeslaBrowserLink.STATS_LOG_INTERVAL_MILLIS
        }
        report(0)
        report(3)
        report(3)
        report(4)
        report(0) // A replacement video stream resets its counters.
        report(0)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("Browser anomaly: dropped=3", "Browser anomaly: dropped=1"),
            logs.filter { it.startsWith("Browser anomaly:") })
        assertFalse(logs.any { it.startsWith("Browser:") })
        assertTrue(BrowserAppearance.night)
    }

    @Test fun theAppDoesNotBundleTheBrowserPage() {
        assertFalse(context.assets.list("")!!.contains("play"))
    }

    @Test fun headUnitSessionsGetTheAndroidSinkItself() {
        val sink = mock(MediaSink::class.java)
        assertSame(sink, TeslaBrowserLink.tee(sink, phoneBrowser = false, 1280, 720))
    }

    @Test fun aPhoneSessionsMainScreenFeedsOnlyTheBrowserUntilItIsRetired() {
        val sink = mock(MediaSink::class.java)
        val tee = TeslaBrowserLink.tee(sink, phoneBrowser = true, 1182, 920)
        assertTrue(tee is BrowserOnlyMediaSink)
        tee.onVideoCodec(110, VideoCodec.H264)
        tee.onScreenStreamActive(110, true)
        verify(sink).onScreenStreamActive(110, true)
        assertEquals(1182, TeslaBrowserLink.hub.info()?.width)
        assertEquals(920, TeslaBrowserLink.hub.info()?.height)
        assertEquals(60, TeslaBrowserLink.hub.info()?.fps)

        TeslaBrowserLink.releaseTap(sink)
        assertNull("A retired session's stream ends at once", TeslaBrowserLink.hub.info())
        // The next session's sink starts its own stream.
        val next = mock(MediaSink::class.java)
        TeslaBrowserLink.tee(next, phoneBrowser = true, 1280, 720).onScreenStreamActive(110, true)
        assertEquals(1280, TeslaBrowserLink.hub.info()?.width)
        TeslaBrowserLink.releaseTap(next)
    }

    @Test fun diagnosticsNameTheStateButNeverTheCodeOrAnAddress() {
        HotspotExtraAddressSettings.setEnabled(context, true)
        val server = started()
        server.callbacks.onViewport(BrowserViewport(1182, 920, 773.0, 601.0, 1.53))
        val code = TeslaBrowserLink.pairingCode(context)
        val lines = TeslaBrowserLink.diagnosticLines(context)
        assertEquals(listOf(
            "Run mode (saved; a running session keeps the mode it connected with): phone-browser",
            "Browser link: state=listening(port=8080) lastViewport=1182x920 pairingCode=yes " +
                "localNetworkPermission=not-needed customPage=false",
        ), lines)
        for (line in lines) {
            assertFalse(line.contains(code))
            assertEquals(line, DiagnosticRedactor.redact(line))
        }
        TeslaBrowserLink.stop()
        assertTrue(TeslaBrowserLink.awaitIdle())
        assertTrue(TeslaBrowserLink.diagnosticLines(context)[1].startsWith("Browser link: state=stopped "))
        assertNotEquals("", code)
    }

    private fun storeSession(phoneBrowser: Boolean, width: Int = 800, height: Int = 480): CarPlayController =
        mock(CarPlayController::class.java).also { session ->
            `when`(session.phoneBrowserMode()).thenReturn(phoneBrowser)
            CarPlayBackgroundSession.store(session, mock(AndroidMediaSink::class.java), width, height, Any(),
                CarPlaySessionDisplay(width, height, Surface.ROTATION_0, false, false, width, height)) { }
            CarPlayBackgroundSession.active = true
        }
}
