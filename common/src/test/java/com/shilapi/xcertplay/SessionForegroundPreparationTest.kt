package com.shilapi.xcertplay

import android.Manifest
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Looper
import android.view.Surface
import androidx.activity.ComponentActivity
import com.shilapi.xcertplay.media.AndroidMediaSink
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import java.time.Duration
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** Lifecycle/ownership checks only. Framework admission is exercised by the device proof. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@LooperMode(LooperMode.Mode.PAUSED)
class SessionForegroundPreparationTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val services = mutableListOf<ServiceController<DiPlaySessionService>>()
    private val screens = mutableListOf<org.robolectric.android.controller.ActivityController<ComponentActivity>>()

    @Before fun setUp() {
        SessionForegroundPreparation.consume()
        CarPlayBackgroundSession.clear()
        TeslaBrowserLink.resetForTest()
        for (name in listOf("xcertplay_airplay", "tiplay_carplay", "tiplay_browser_audio"))
            app.getSharedPreferences(name, 0).edit().clear().commit()
        AirPlayPersistence.saveRunMode(app, CarPlayRunMode.PHONE_BROWSER)
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        TeslaBrowserLink.sync(app)
    }

    @After fun tearDown() {
        SessionForegroundPreparation.consume()
        CarPlayBackgroundSession.clear()
        services.reversed().forEach { it.destroy() }
        screens.forEach {
            if (it.get().lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) it.pause()
            if (it.get().lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) it.stop()
            it.destroy()
        }
        TeslaBrowserLink.resetForTest()
    }

    private fun screen() = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        .also { screens += it }.get()
    private fun prepare(screen: ComponentActivity, owner: SessionForegroundPreparationOwner): Long =
        requireNotNull(DiPlaySessionService.prepareForegroundAccess(screen, owner) {})
    private fun nextStart(): Intent {
        while (true) {
            val intent = shadowOf(app).nextStartedService ?: error("No foreground service dispatch")
            if (intent.component?.className == DiPlaySessionService::class.java.name) return intent
        }
    }
    private fun start(intent: Intent = nextStart()) = Robolectric.buildService(DiPlaySessionService::class.java, intent)
        .create().startCommand(0, 1).also { services += it }
    private fun stopIntent(service: DiPlaySessionService): Intent =
        shadowOf(shadowOf(service).lastForegroundNotification.actions.single().actionIntent).savedIntent
    private fun storeSession() {
        val controller = mock(CarPlayController::class.java)
        `when`(controller.phoneBrowserMode()).thenReturn(true)
        CarPlayBackgroundSession.store(controller, mock(AndroidMediaSink::class.java), 800, 480,
            Any(), CarPlaySessionDisplay(800, 480, Surface.ROTATION_0, false, false, 800, 480)) {
            CarPlayBackgroundSession.clear()
            it()
        }
    }

    @Test fun savedPhoneModeAloneCannotCreateAnIdleForegroundOwner() {
        val service = start(Intent())
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertFalse(CarPlayBackgroundSession.hasSession())
        assertTrue(shadowOf(service.get()).isStoppedBySelf)
        assertEquals(0, service.get().foregroundServiceType)
    }

    @Test fun resumedWaitIsIndependentOfSessionAndAdoptsTheSameForegroundLifetime() {
        val activity = screen()
        val owner = SessionForegroundPreparationOwner()
        prepare(activity, owner)
        val service = start()
        val lifetime = DiPlaySessionService.ownerToken()
        val types = service.get().foregroundServiceType
        assertTrue(types and ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE != 0)
        assertFalse(CarPlayBackgroundSession.hasSession())
        assertNull(CarPlayBackgroundSession.snapshot())
        assertNull(TeslaBrowserLink.readyViewport())

        storeSession()
        DiPlaySessionService.ensureForSession(app)
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertSame(lifetime, DiPlaySessionService.ownerToken())
        assertEquals(types, service.get().foregroundServiceType)
        assertFalse(shadowOf(service.get()).isStoppedBySelf)
        DiPlaySessionService.stopIfIdle(app, lifetime)
        assertFalse("A real session keeps its service", shadowOf(service.get()).isStoppedBySelf)
    }

    @Test fun aLatePreparationCallbackAfterPausePreservesTheAlreadyArmedOwner() {
        val activity = screen()
        val owner = SessionForegroundPreparationOwner()
        val token = prepare(activity, owner)
        val service = start()
        val lifetime = DiPlaySessionService.ownerToken()
        val types = service.get().foregroundServiceType
        screens.single().pause().stop()
        assertNull(DiPlaySessionService.prepareForegroundAccess(activity, owner) {})
        assertEquals(token, SessionForegroundPreparation.snapshot()?.token)
        assertSame(lifetime, DiPlaySessionService.ownerToken())
        assertEquals(types, service.get().foregroundServiceType)
        assertFalse(shadowOf(service.get()).isStoppedBySelf)
    }

    @Test fun aLatePreparationCallbackAfterPauseCannotCreateANewOwner() {
        val activity = screen()
        screens.single().pause().stop()
        assertNull(DiPlaySessionService.prepareForegroundAccess(activity, SessionForegroundPreparationOwner()) {})
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertFalse(CarPlayBackgroundSession.hasSession())
        assertNull(DiPlaySessionService.ownerToken())
    }

    @Test fun permissionLossStopsPendingPurposeAndBackgroundRestoreCannotRearmIt() {
        val activity = screen()
        val owner = SessionForegroundPreparationOwner()
        prepare(activity, owner)
        val service = start()
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        assertFalse(SessionForegroundPreparation.hasPreparation())
        assertTrue(shadowOf(service.get()).isStoppedBySelf)
        assertFalse(owner.cancelled)
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        DiPlaySessionService.refreshForegroundAccess(app)
        assertFalse(SessionForegroundPreparation.hasPreparation())
        prepare(activity, owner)
        assertTrue(SessionForegroundPreparation.hasPreparation())
        assertNotNull(nextStart())
    }

    @Test fun configurationWithdrawalKeepsTheScreenIntentButStopsItsIdleOwner() {
        val activity = screen()
        val owner = SessionForegroundPreparationOwner()
        prepare(activity, owner)
        val service = start()
        BrowserCarPlaySettings.setDisabled(app, true)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(shadowOf(service.get()).isStoppedBySelf)
        assertFalse(owner.cancelled)
        assertFalse(activity.isFinishing)
        assertFalse(SessionForegroundPreparation.hasPreparation())
    }

    @Test fun explicitStopIsRetainedAcrossCallbackReattachment() {
        val activity = screen()
        val owner = SessionForegroundPreparationOwner()
        val first = prepare(activity, owner)
        val service = start()
        service.withIntent(stopIntent(service.get())).startCommand(0, 2)
        var notified = 0L
        owner.attach(activity) { notified = it }
        assertTrue(owner.cancelled)
        assertEquals(first, notified)
        assertNull(DiPlaySessionService.prepareForegroundAccess(activity, owner) {})
        assertFalse(SessionForegroundPreparation.hasPreparation())
    }

    @Test fun aSupersededLeaseCannotReleaseItsSuccessor() {
        val a = Any()
        val b = Any()
        var cancelled = 0L
        val old = SessionForegroundPreparation.claim(a, { cancelled = it })
        val fresh = SessionForegroundPreparation.claim(b, {})
        assertEquals(old.token, cancelled)
        assertNull(SessionForegroundPreparation.release(a))
        assertNull(SessionForegroundPreparation.releaseToken(old.token))
        assertEquals(fresh, SessionForegroundPreparation.snapshot())
        assertFalse(CarPlayBackgroundSession.hasSession())
    }

    @Test fun stopThenNewPrepareOnSameInstanceRequiresANewForegroundLifetime() {
        val activity = screen()
        val owner = SessionForegroundPreparationOwner()
        val first = prepare(activity, owner)
        val service = start()
        val oldLifetime = DiPlaySessionService.ownerToken()
        BrowserCarPlayAudioSettings.saveDisabled(app, true)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(shadowOf(service.get()).isStoppedBySelf)
        BrowserCarPlayAudioSettings.saveDisabled(app, false)
        val second = prepare(activity, owner)
        assertNotEquals(first, second)
        service.withIntent(nextStart()).startCommand(0, 2)
        assertNotSame(oldLifetime, DiPlaySessionService.ownerToken())
        assertTrue(service.get().foregroundServiceType and ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE != 0)
        DiPlaySessionService.stopIfIdle(app, oldLifetime)
        assertEquals(second, SessionForegroundPreparation.snapshot()?.token)
    }

    @Test fun retiredInstanceAndStaleStopCannotCancelNewerPurpose() {
        val activity = screen()
        prepare(activity, SessionForegroundPreparationOwner())
        val old = start()
        val obsoleteStop = stopIntent(old.get())
        val freshToken = prepare(activity, SessionForegroundPreparationOwner())
        val fresh = start(Intent())
        old.get().onTaskRemoved(Intent())
        old.destroy()
        services.remove(old)
        assertEquals(freshToken, SessionForegroundPreparation.snapshot()?.token)
        fresh.withIntent(obsoleteStop).startCommand(0, 2)
        assertFalse(shadowOf(fresh.get()).isStoppedBySelf)
        assertEquals(freshToken, SessionForegroundPreparation.snapshot()?.token)
    }

    @Test fun queuedOldReceiverStopCannotCancelANewerReceivingOwner() {
        val activity = screen()
        prepare(activity, SessionForegroundPreparationOwner())
        start()
        Thread { DiPlaySessionService.receiverStopped() }.apply { start(); join() }
        val replacement = SessionForegroundPreparationOwner()
        val token = prepare(activity, replacement)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(replacement.cancelled)
        assertEquals(token, SessionForegroundPreparation.snapshot()?.token)
    }

    @Test fun staleNotificationCannotLeaveANewEmptyServiceRunning() {
        val activity = screen()
        prepare(activity, SessionForegroundPreparationOwner())
        val old = start()
        val obsoleteStop = stopIntent(old.get())
        SessionForegroundPreparation.consume()
        old.destroy()
        services.remove(old)
        val stale = start(obsoleteStop)
        assertTrue(shadowOf(stale.get()).isStoppedBySelf)
        assertFalse(CarPlayBackgroundSession.hasSession())
    }
}
