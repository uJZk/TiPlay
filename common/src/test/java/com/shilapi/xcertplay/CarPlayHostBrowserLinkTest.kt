package com.shilapi.xcertplay

import android.os.Handler
import android.os.Looper
import android.view.Surface
import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.airplay.MediaSink
import com.shilapi.xcertplay.airplay.SafeAreaRect
import com.shilapi.xcertplay.airplay.VideoCodec
import com.shilapi.xcertplay.media.AndroidMediaSink
import com.shilapi.xcertplay.media.BrowserOnlyMediaSink
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import com.shilapi.xcertplay.orchestration.MfiTarget
import com.shilapi.xcertplay.web.BrowserViewport
import com.shilapi.xcertplay.web.WebVideoHub
import java.util.concurrent.ExecutorService
import java.time.Duration
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.MockedConstruction
import org.mockito.Mockito.mockConstruction
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.util.concurrent.PausedExecutorService
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** Integration E2: the CarPlay screen's hooks for the car's browser (phone + browser mode) and none on a head unit. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class CarPlayHostBrowserLinkTest {
    private lateinit var activity: CarPlayHostActivity
    private lateinit var controllerConstruction: MockedConstruction<CarPlayController>
    private val sizeClass = Class.forName("com.shilapi.xcertplay.CarPlayHostActivity\$DisplaySize")
    private val sinks = mutableListOf<AndroidMediaSink>()

    @Before fun setUp() {
        TeslaBrowserLink.resetForTest()
        activity = Robolectric.buildActivity(CarPlayHostActivity::class.java).get()
        AirPlayPersistence.saveRunMode(activity, CarPlayRunMode.PHONE_BROWSER)
        AirPlayPersistence.saveMfiTarget(activity, MfiTarget.USB_CH341)
        set("airPlayIdentity", AirPlayIdentity.generate())
        set("hevcEnabled", false)
        controllerConstruction = mockConstruction(CarPlayController::class.java)
        (get("teardownExecutor") as ExecutorService).shutdownNow()
        set("teardownExecutor", PausedExecutorService())
        CarPlayBackgroundSession::class.java.getDeclaredField("owner").apply { isAccessible = true }
            .set(CarPlayBackgroundSession, activity)
    }

    @After fun tearDown() {
        (get("shuttingDown") as AtomicBoolean).set(true)
        (get("mainHandler") as Handler).removeCallbacksAndMessages(null)
        AirPlayPersistence.overlaySettingsListener = null
        com.shilapi.xcertplay.hud.BydNavigationOutputs.setTurnOverlayListener(null)
        (get("teardownExecutor") as ExecutorService).shutdownNow()
        (get("airPlayCommandExecutor") as ExecutorService).shutdownNow()
        sinks.forEach { TeslaBrowserLink.releaseTap(it); it.close() }
        CarPlayBackgroundSession.clear()
        controllerConstruction.close()
        TeslaBrowserLink.resetForTest()
        listOf("xcertplay_airplay", "tiplay_browser_link", "tiplay_browser_audio", "diplay_carplay_dock").forEach {
            activity.getSharedPreferences(it, 0).edit().clear().commit()
        }
    }

    @Test fun phoneModeNegotiatesTheBrowsersCanvasWithoutTheHeadUnitsDisplayOptions() {
        saveViewport(BrowserViewport(1182, 920, 773.0, 601.0, 1.53))
        // Head-unit options saved earlier must not reach the car's browser.
        set("displayScalePercent", 160)
        set("uiScalePercent", 75)
        AirPlayPersistence.saveDisplayScalePercent(activity, 160)
        AirPlayPersistence.saveUiScalePercent(activity, 75)
        AirPlayPersistence.saveClusterMapEnabled(activity, true)
        AirPlayPersistence.saveSafeAreaRect(activity, 1080, 2200, SafeAreaRect(0, 100, 1080, 2100), commit = true)
        CarPlayDock.save(activity, CarPlayDock.BOTTOM)
        SidePanelSettings.setEnabled(activity, true)

        val config = config(1080, 2200) // a phone in portrait

        assertEquals(1182, config.main.widthPixels)
        assertEquals(920, config.main.heightPixels)
        assertEquals(60, config.main.fps)
        assertEquals(205, config.main.widthPhysicalMm)
        assertEquals(160, config.main.heightPhysicalMm)
        assertNull(config.main.safeArea)
        assertNull(config.main.viewAreas)
        assertNull(config.cluster)
        assertFalse(config.videoInCar)
        assertNull(get("pendingViewAreas"))
        assertEquals("TiPlay", config.oemLabel)
        assertEquals("The head-unit settings stay as saved", 160, AirPlayPersistence.loadDisplayScalePercent(activity))
        assertTrue(DisplayDiagnosticSnapshot.report(activity).contains("Phone + browser canvas=1182x920"))
    }

    @Test fun phoneModePlaysAudioWithoutMicrophonePermissionAndOffersCaptureOnlyAfterGrant() {
        AirPlayPersistence.saveCarBluetoothAudio(activity, CarBluetoothAudio.OFF)
        AirPlayPersistence.saveMainBufferedAudio(activity, true)
        BrowserCarPlayAudioSettings.saveDisabled(activity, false)
        set("microphoneAvailable", false)
        val config = config(1080, 2200)
        assertFalse(config.audioViaCarBluetooth)
        assertTrue(config.receivesAudio)
        assertFalse(config.microphone)
        assertTrue(config.mainBufferedAudio)
        set("microphoneAvailable", true)
        assertTrue(config(1080, 2200).microphone)
    }

    @Test fun disabledAudioAlsoDeclinesBufferedMusicAndBluetoothMicrophone() {
        BrowserCarPlayAudioSettings.saveDisabled(activity, true)
        AirPlayPersistence.saveMainBufferedAudio(activity, true)
        val config = config(1080, 2200)
        assertTrue(config.audioViaCarBluetooth)
        assertFalse(config.receivesAudio)
        assertFalse(config.microphone)
        assertFalse(config.mainBufferedAudio)
    }

    @Test fun beforeAnyBrowserSizeThePhoneNegotiates720p() {
        val config = config(1080, 2200)
        assertEquals(1280, config.main.widthPixels)
        assertEquals(720, config.main.heightPixels)
        assertEquals(60, config.main.fps)
    }

    @Test fun rotatingThePhoneDoesNotResizeARunningBrowserSession() {
        val controller = org.mockito.Mockito.mock(CarPlayController::class.java)
        org.mockito.Mockito.`when`(controller.phoneBrowserMode()).thenReturn(true)
        set("controller", controller)
        val original = size(1080, 2200)
        set("activeDisplaySize", original)
        activity.javaClass.getDeclaredMethod("scheduleDisplaySize", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(activity, 2200, 1080)
        assertSame(original, get("activeDisplaySize"))
        assertNull(get("pendingDisplaySize"))
    }

    @Test fun selectedFrameRateReachesTheIphoneAndBrowserStream() {
        set("fps", 30)
        assertEquals(30, config(1080, 2200).main.fps)
        val sink = sink(1280, 720)
        val teed = engineSink(sink)
        teed.onVideoCodec(110, VideoCodec.H264)
        teed.onScreenStreamActive(110, true)
        assertEquals(30, TeslaBrowserLink.hub.info()?.fps)
        assertTrue(DisplayDiagnosticSnapshot.report(activity).contains("fps=30"))
        set("fps", 60)
        assertEquals("Editing a draft keeps the active stream unchanged", 30, TeslaBrowserLink.hub.info()?.fps)
    }

    @Test fun aHeadUnitKeepsItsOwnWindowAsTheCanvas() {
        useHeadUnitMode(activity)
        saveViewport(BrowserViewport(1182, 920, 773.0, 601.0, 1.53))
        val config = config(1920, 990)
        assertEquals(1920, config.main.widthPixels)
        assertEquals(990, config.main.heightPixels)
    }

    @Test fun phoneModeRoutesVideoOnlyToTheBrowserAndAHeadUnitKeepsItsRenderer() {
        val sink = sink(1182, 920)
        val teed = engineSink(sink)
        assertTrue(teed is BrowserOnlyMediaSink)
        teed.onVideoCodec(110, VideoCodec.H264)
        teed.onScreenStreamActive(110, true)
        assertEquals(WebVideoHub.StreamInfo(1182, 920, 60, null, null), TeslaBrowserLink.hub.info())
        TeslaBrowserLink.releaseTap(sink)
        assertNull(TeslaBrowserLink.hub.info())

        useHeadUnitMode(activity)
        val headUnit = sink(1920, 990)
        assertSame(headUnit, engineSink(headUnit))
    }

    @Test fun aRestartEndsTheBrowsersStreamAtOnce() {
        set("activeDisplaySize", size(1080, 2200))
        val sink = sink(1280, 720)
        val teed = engineSink(sink)
        teed.onVideoCodec(110, VideoCodec.H264)
        teed.onScreenStreamActive(110, true)
        set("sink", sink)
        set("controller", org.mockito.Mockito.mock(CarPlayController::class.java))
        assertTrue(TeslaBrowserLink.hub.info() != null)

        invoke("restartCarPlay", "test restart")

        assertNull("The page waits for the next session instead of a frozen picture", TeslaBrowserLink.hub.info())
    }

    @Test fun thePhonesOwnScreenSizeNeverReconnectsInPhoneMode() {
        startSession(canvasWidth = 1182, canvasHeight = 920, windowWidth = 1080, windowHeight = 2200)
        applySize(2200, 1080) // the phone turns
        applySize(1080, 1900) // its keyboard or a split screen
        assertEquals(0, get("restartGeneration"))
        assertTrue(get("sessionDisplay") != null)
    }

    @Test fun applyAndReconnectDoesNotRebuildWhenRetainedTransportIsUnavailable() {
        startSession(canvasWidth = 1280, canvasHeight = 720, windowWidth = 1080, windowHeight = 2200)
        set("controller", org.mockito.Mockito.mock(CarPlayController::class.java).also {
            org.mockito.Mockito.`when`(it.phoneBrowserMode()).thenReturn(true)
        })
        val host = get("browserLinkHost") as TeslaBrowserLink.Host

        saveViewport(BrowserViewport(1284, 722, 839.0, 472.0, 1.53))
        host.onBrowserFit()
        assertEquals("Within 8 px and 1 %: nothing to apply", 0, get("restartGeneration"))

        saveViewport(BrowserViewport(1182, 920, 773.0, 601.0, 1.53))
        host.onBrowserFit()
        assertEquals("An unavailable retained request does not fall back to full teardown", 0, get("restartGeneration"))
        assertFalse(get("handshakeResetInProgress") as Boolean)
        assertEquals(1280, (get("sessionDisplay") as CarPlaySessionDisplay).width)
    }

    @Test fun applyAndReconnectDoesNothingWithoutASession() {
        set("activeDisplaySize", size(1080, 2200))
        saveViewport(BrowserViewport(1182, 920, 773.0, 601.0, 1.53))
        (get("browserLinkHost") as TeslaBrowserLink.Host).onBrowserFit()
        assertEquals(0, get("restartGeneration"))
    }

    @Test fun browserResizeRequestsRetainedTransportImmediatelyAndCoalescesTheLatestCanvas() {
        startSession(1280, 720, 1080, 2200)
        val current = org.mockito.Mockito.mock(CarPlayController::class.java)
        org.mockito.Mockito.`when`(current.phoneBrowserMode()).thenReturn(true)
        set("controller", current)
        val host = get("browserLinkHost") as TeslaBrowserLink.Host
        val first = BrowserViewport(1182, 920, 773.0, 601.0, 1.53)
        saveViewport(first)
        val firstConfig = config(1080, 2200).main
        org.mockito.Mockito.`when`(current.reconnectBrowserDisplay(firstConfig)).thenReturn(true)
        host.onBrowserViewport(first)
        org.mockito.Mockito.verify(current).reconnectBrowserDisplay(firstConfig)
        assertEquals("The already-main callback requests a replacement without full teardown", 0, get("restartGeneration"))
        assertFalse(get("handshakeResetInProgress") as Boolean)
        val latest = BrowserViewport(1600, 900, 1046.0, 588.0, 1.53)
        saveViewport(latest)
        org.mockito.Mockito.`when`(current.reconnectBrowserDisplay(config(1080, 2200).main)).thenReturn(true)
        host.onBrowserViewport(latest)
        assertEquals("Coalescing retains the existing controller", 0, get("restartGeneration"))
        assertEquals(1600, (get("sessionDisplay") as CarPlaySessionDisplay).width)
        val nextConfig = config(1080, 2200)
        assertEquals("The replacement session uses the latest saved viewport", 1600, nextConfig.main.widthPixels)
        assertEquals(900, nextConfig.main.heightPixels)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(0, get("restartGeneration"))
        assertFalse(get("handshakeResetInProgress") as Boolean)
    }

    @Test fun browserResizeRespectsShutdownMenuAndHandshakeGuards() {
        val host = get("browserLinkHost") as TeslaBrowserLink.Host
        val viewport = BrowserViewport(1600, 900, 1046.0, 588.0, 1.53)
        for (blockedBy in listOf("shuttingDown", "menuOpen", "handshakeResetInProgress")) {
            startSession(1280, 720, 1080, 2200)
            set("controller", org.mockito.Mockito.mock(CarPlayController::class.java).also {
                org.mockito.Mockito.`when`(it.phoneBrowserMode()).thenReturn(true)
            })
            saveViewport(viewport)
            if (blockedBy == "shuttingDown") (get(blockedBy) as AtomicBoolean).set(true) else set(blockedBy, true)
            host.onBrowserViewport(viewport)
            assertEquals("Resize cannot bypass $blockedBy", 0, get("restartGeneration"))
            if (blockedBy == "shuttingDown") (get(blockedBy) as AtomicBoolean).set(false) else set(blockedBy, false)
        }
    }

    @Test fun browserResizeDoesNotReconnectAHeadUnitOrAnUnownedSession() {
        val host = get("browserLinkHost") as TeslaBrowserLink.Host
        val viewport = BrowserViewport(1600, 900, 1046.0, 588.0, 1.53)
        startSession(1280, 720, 1080, 2200)
        saveViewport(viewport)
        useHeadUnitMode(activity)
        set("controller", org.mockito.Mockito.mock(CarPlayController::class.java))
        host.onBrowserViewport(viewport)
        assertEquals("Head-unit mode keeps its own canvas", 0, get("restartGeneration"))

        AirPlayPersistence.saveRunMode(activity, CarPlayRunMode.PHONE_BROWSER)
        set("controller", org.mockito.Mockito.mock(CarPlayController::class.java).also {
            org.mockito.Mockito.`when`(it.phoneBrowserMode()).thenReturn(true)
        })
        CarPlayBackgroundSession::class.java.getDeclaredField("owner").apply { isAccessible = true }
            .set(CarPlayBackgroundSession, null)
        host.onBrowserViewport(viewport)
        assertEquals("Only the session owner can rebuild it", 0, get("restartGeneration"))
    }

    @Test fun browserResizeRetainsTheControllerAndUpdatesTheNextBrowserStreamCanvas() {
        startSession(1280, 720, 1080, 2200)
        val current = org.mockito.Mockito.mock(CarPlayController::class.java)
        org.mockito.Mockito.`when`(current.phoneBrowserMode()).thenReturn(true)
        set("controller", current)
        val renderer = sink(1280, 720)
        set("sink", renderer)
        val viewport = BrowserViewport(1600, 900, 1046.0, 588.0, 1.53)
        saveViewport(viewport)
        val retained = engineSink(renderer)
        retained.onVideoCodec(110, VideoCodec.H264)
        retained.onScreenStreamActive(110, true)
        org.mockito.Mockito.`when`(current.reconnectBrowserDisplay(config(1080, 2200).main)).thenReturn(true)

        (get("browserLinkHost") as TeslaBrowserLink.Host).onBrowserViewport(viewport)

        assertEquals(0, get("restartGeneration"))
        assertSame(current, get("controller"))
        val display = get("sessionDisplay") as CarPlaySessionDisplay
        assertEquals(1600, display.width)
        assertEquals(900, display.height)
        assertEquals("The old stream keeps its old dimensions until it ends", 1280, TeslaBrowserLink.hub.info()?.width)
        retained.onScreenStreamActive(110, false)
        retained.onScreenStreamActive(110, true)
        assertEquals(WebVideoHub.StreamInfo(1600, 900, 60, null, null), TeslaBrowserLink.hub.info())
    }

    @Test fun retainedBrowserDisplayDoesNotRestartOrCancelAfterTwoSeconds() {
        startSession(1280, 720, 1080, 2200)
        val current = org.mockito.Mockito.mock(CarPlayController::class.java)
        org.mockito.Mockito.`when`(current.phoneBrowserMode()).thenReturn(true)
        set("controller", current)
        val viewport = BrowserViewport(1600, 900, 1046.0, 588.0, 1.53)
        saveViewport(viewport)
        org.mockito.Mockito.`when`(current.reconnectBrowserDisplay(config(1080, 2200).main)).thenReturn(true)
        (get("browserLinkHost") as TeslaBrowserLink.Host).onBrowserViewport(viewport)
        set("menuOpen", true)

        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))

        assertEquals(0, get("restartGeneration"))
        assertFalse(get("recoveryPendingAfterMenu") as Boolean)
        org.mockito.Mockito.verify(current, org.mockito.Mockito.never()).cancelBrowserDisplayReconnect()
    }

    @Test fun retainedBrowserDisplayCoalescesTargetsAndWaitsForAReplacementFrame() {
        val current = org.mockito.Mockito.mock(CarPlayController::class.java)
        val source = org.mockito.Mockito.mock(AirPlaySession::class.java)
        val replacement = org.mockito.Mockito.mock(AirPlaySession::class.java)
        val first = com.shilapi.xcertplay.airplay.AirPlayDisplayConfig(1600, 900)
        val last = first.copy(widthPixels = 1920, heightPixels = 1080)
        val accepted = mutableListOf<com.shilapi.xcertplay.airplay.AirPlayDisplayConfig>()
        val host = BrowserDisplayReconnectHost { accepted += it }
        org.mockito.Mockito.`when`(current.reconnectBrowserDisplay(first)).thenReturn(true)
        assertTrue(host.request(current, source, first))
        assertTrue(host.expectedEnd(current, source))
        assertFalse(host.firstFrame(current, source))
        // /info was accepted already; the final target waits for a proven replacement.
        assertTrue(host.request(current, source, last))
        assertEquals(listOf(first), accepted)
        host.sessionActive(current, replacement)
        assertTrue(host.firstFrame(current, replacement))
        assertFalse(host.pending)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        org.mockito.Mockito.verify(current, org.mockito.Mockito.never()).cancelBrowserDisplayReconnect()
    }

    @Test fun anAdoptedPendingDisplaySuppressesTheUnknownOldEndButNotTheReplacementEnd() {
        val current = org.mockito.Mockito.mock(CarPlayController::class.java)
        val old = org.mockito.Mockito.mock(AirPlaySession::class.java)
        val next = org.mockito.Mockito.mock(AirPlaySession::class.java)
        val host = BrowserDisplayReconnectHost {}
        host.adopt(current)
        assertTrue(host.expectedEnd(current, old))
        assertFalse(host.firstFrame(current, old))
        host.sessionActive(current, next)
        assertTrue(host.expectedEnd(current, old))
        assertFalse(host.expectedEnd(current, next))
        org.mockito.Mockito.`when`(current.isBrowserDisplayReconnectPending()).thenReturn(true)
        assertFalse("The controller must confirm this is a replacement frame", host.firstFrame(current, next))
        org.mockito.Mockito.`when`(current.isBrowserDisplayReconnectPending()).thenReturn(false)
        assertTrue("The adopted replacement rechecks any last viewport saved by the old host", host.firstFrame(current, next))
        assertFalse(host.pending)
    }

    @Test fun queuedOldHostSessionCallbacksCannotChangeTheSuccessorOwnersLiveState() {
        val old = org.mockito.Mockito.mock(AirPlaySession::class.java)
        val replacement = org.mockito.Mockito.mock(AirPlaySession::class.java)
        set("activeAirPlaySession", old)
        CarPlayBackgroundSession.active = true
        val listener = activity.javaClass.getDeclaredMethod("createSessionListener", Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(activity, 0) as com.shilapi.xcertplay.airplay.AirPlaySessionListener
        CarPlayBackgroundSession::class.java.getDeclaredField("owner").apply { isAccessible = true }
            .set(CarPlayBackgroundSession, Any())
        listener.onSessionEnded(old)
        listener.onSessionActive(replacement)
        listener.onTransportError("old connection error")
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(CarPlayBackgroundSession.active)
        assertSame(old, get("activeAirPlaySession"))
        assertEquals(0, get("restartGeneration"))
    }

    @Test fun anAdoptedReplacementFirstFrameCompletesWithoutAReplayedActiveCallback() {
        val current = org.mockito.Mockito.mock(CarPlayController::class.java)
        val replacement = org.mockito.Mockito.mock(AirPlaySession::class.java)
        set("controller", current)
        val host = activity.javaClass.getDeclaredMethod("getBrowserDisplayReconnectHost")
            .apply { isAccessible = true }.invoke(activity) as BrowserDisplayReconnectHost
        host.adopt(current)
        val listener = activity.javaClass.getDeclaredMethod("createSessionListener", Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(activity, 0) as com.shilapi.xcertplay.airplay.AirPlaySessionListener
        assertNull(get("activeAirPlaySession"))
        listener.onVideoFrameRendered(replacement)
        shadowOf(Looper.getMainLooper()).idle()
        assertSame(replacement, get("activeAirPlaySession"))
        assertFalse(host.pending)
        assertTrue(CarPlayBackgroundSession.active)
    }

    private fun saveViewport(viewport: BrowserViewport) {
        TeslaBrowserLink.resetForTest()
        activity.getSharedPreferences("tiplay_browser_link", 0).edit()
            .putInt("viewport_width", viewport.width).putInt("viewport_height", viewport.height)
            .putFloat("viewport_css_width", viewport.cssWidth.toFloat())
            .putFloat("viewport_css_height", viewport.cssHeight.toFloat())
            .putFloat("viewport_dpr", viewport.devicePixelRatio.toFloat()).commit()
    }

    private fun startSession(canvasWidth: Int, canvasHeight: Int, windowWidth: Int, windowHeight: Int) {
        set("activeDisplaySize", size(windowWidth, windowHeight))
        set("sessionDisplay", CarPlaySessionDisplay(canvasWidth, canvasHeight, Surface.ROTATION_0, true, true,
            windowWidth, windowHeight))
    }

    private fun sink(width: Int, height: Int): AndroidMediaSink {
        val sink = activity.javaClass.getDeclaredMethod("createMediaSink", Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(activity, width, height, 0, false) as AndroidMediaSink
        sinks += sink
        return sink
    }

    private fun engineSink(sink: AndroidMediaSink): MediaSink {
        val engine = activity.javaClass.getDeclaredMethod("createMediaEngine", AndroidMediaSink::class.java,
            Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(activity, sink, false)!!
        return engine.javaClass.getDeclaredField("sink").apply { isAccessible = true }.get(engine) as MediaSink
    }

    private fun config(width: Int, height: Int): AirPlayConfig =
        activity.javaClass.getDeclaredMethod("createAirPlayConfig", sizeClass)
            .apply { isAccessible = true }.invoke(activity, size(width, height)) as AirPlayConfig

    private fun applySize(width: Int, height: Int) {
        activity.javaClass.getDeclaredMethod("applyDisplaySize", sizeClass)
            .apply { isAccessible = true }.invoke(activity, size(width, height))
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun size(width: Int, height: Int): Any = sizeClass
        .getDeclaredConstructor(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        .apply { isAccessible = true }.newInstance(width, height)

    private fun invoke(name: String, argument: String) {
        activity.javaClass.getDeclaredMethod(name, String::class.java).apply { isAccessible = true }.invoke(activity, argument)
    }

    private fun get(name: String): Any? = activity.javaClass.getDeclaredField(name)
        .apply { isAccessible = true }.get(activity)

    private fun set(name: String, value: Any?) {
        activity.javaClass.getDeclaredField(name).apply { isAccessible = true }.set(activity, value)
    }
}
