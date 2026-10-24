package com.shilapi.xcertplay.orchestration

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayMediaHandler
import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.airplay.AirPlaySessionListener
import com.shilapi.xcertplay.airplay.PairingStore
import com.shilapi.xcertplay.glance.CarPlayGlance
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import com.shilapi.xcertplay.web.BrowserPortalSignal
import java.net.Socket
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class CarPlayControllerScreenOwnershipTest {
    private val airPlay = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480))
    private val identity = AirPlayIdentity(ByteArray(32), ByteArray(32), "test")
    private val controllers = mutableListOf<CarPlayController>()
    private val phones = mutableListOf<AirPlaySession>()
    private var previousGlanceListener: ((CarPlayGlance.Snapshot) -> Unit)? = null

    @Before fun resetGlance() {
        previousGlanceListener = CarPlayGlance.listener
        CarPlayGlance.listener = null
        CarPlayGlance.setConnected(false)
    }

    @After fun cleanUp() {
        CarPlayGlance.listener = null
        controllers.forEach { it.close(); assertTrue(it.awaitClosed(2_000)) }
        phones.forEach { it.close() }
        CarPlayGlance.setConnected(false)
        CarPlayGlance.listener = previousGlanceListener
    }

    @Test fun aLateRecordCannotReviveAClosedController() {
        var activeCallbacks = 0
        val controller = controller(object : AirPlaySessionListener {
            override fun onSessionActive(session: AirPlaySession) { activeCallbacks++ }
        })
        controller.close()
        assertTrue(controller.awaitClosed(2_000))
        listener(controller).onSessionActive(phone())
        assertNull(controller.screenBorrowSnapshot())
        assertFalse(CarPlayGlance.snapshot().connected)
        assertEquals(0, activeCallbacks)
    }

    @Test fun aClosedPhoneCannotBecomeTheCurrentResourceOwner() {
        val controller = controller()
        val ended = phone().also { it.close() }
        listener(controller).onSessionActive(ended)
        assertNull(controller.screenBorrowSnapshot())
        assertFalse(CarPlayGlance.snapshot().connected)
    }

    @Test fun endingAnOldSessionCannotClearAReentrantSuccessor() {
        val controller = controller()
        val first = phone()
        val second = phone()
        val callbacks = listener(controller)
        callbacks.onSessionActive(first)
        val firstSnapshot = controller.screenBorrowSnapshot()!!
        controller.listenScreenBorrow {
            if (controller.screenBorrowSnapshot() == null) callbacks.onSessionActive(second)
        }.use {
            callbacks.onSessionEnded(first)
        }
        assertFalse(controller.isCurrentScreenBorrowSnapshot(firstSnapshot))
        assertSame(second, controller.screenBorrowSnapshot()!!.session)
        assertTrue(CarPlayGlance.snapshot().connected)
    }

    @Test fun ownershipSnapshotsExpireWithStateSessionAndLifetime() {
        val controller = controller()
        val first = phone()
        assertFalse(controller.isCurrentControlSession(first))
        listener(controller).onSessionActive(first)
        assertTrue(controller.isCurrentControlSession(first))
        val initial = controller.screenBorrowSnapshot()!!
        assertTrue(controller.isCurrentScreenBorrowSnapshot(initial))
        first.setScreenBorrowed(true)
        assertFalse(controller.isCurrentScreenBorrowSnapshot(initial))
        val pending = controller.screenBorrowSnapshot()!!
        val next = phone()
        listener(controller).onSessionActive(next)
        assertFalse(controller.isCurrentControlSession(first))
        assertTrue(controller.isCurrentControlSession(next))
        assertFalse(controller.isCurrentScreenBorrowSnapshot(pending))
        val current = controller.screenBorrowSnapshot()!!
        assertTrue(controller.isCurrentScreenBorrowSnapshot(current))
        next.close()
        assertFalse(controller.isCurrentControlSession(next))
        assertFalse(controller.isCurrentScreenBorrowSnapshot(current))
        assertNull(controller.screenBorrowSnapshot())
    }

    @Test fun aGlanceListenerMayCloseTheControllerWithoutRevivingItsConnectedState() {
        val controller = controller()
        val observed = mutableListOf<Boolean>()
        CarPlayGlance.listener = {
            observed += it.connected
            if (it.connected) controller.close()
        }
        listener(controller).onSessionActive(phone())
        assertEquals(listOf(true, false), observed)
        assertFalse(CarPlayGlance.snapshot().connected)
        assertNull(controller.screenBorrowSnapshot())
    }

    @Test fun aGlanceListenerClosingThenThrowingStillPublishesTheDisconnectedState() {
        val controller = controller()
        val observed = mutableListOf<Boolean>()
        CarPlayGlance.listener = {
            observed += it.connected
            if (it.connected) {
                controller.close()
                throw IllegalStateException("observer failed after closing")
            }
        }
        listener(controller).onSessionActive(phone())
        assertEquals(listOf(true, false), observed)
        assertFalse(CarPlayGlance.snapshot().connected)
        assertNull(controller.screenBorrowSnapshot())
        assertTrue(controller.awaitClosed(2_000))
    }

    @Test fun onlyTheCurrentLiveSessionMayOpenTheBrowserPortal() {
        val controller = controller()
        val first = phone()
        val current = phone()
        val callbacks = listener(controller)
        callbacks.onSessionActive(first)
        callbacks.onSessionActive(current)
        val before = BrowserPortalSignal.revision
        callbacks.onHostUiRequested(first)
        assertEquals(before, BrowserPortalSignal.revision)
        callbacks.onHostUiRequested(current)
        assertEquals(before + 1, BrowserPortalSignal.revision)
        controller.close()
        callbacks.onHostUiRequested(current)
        assertEquals(before + 1, BrowserPortalSignal.revision)
    }

    @Test fun aDebugCallbackReplacingTheSessionCannotForwardItsRetiredActiveEvent() {
        val first = phone()
        val next = phone()
        val forwarded = mutableListOf<AirPlaySession>()
        var replace = true
        lateinit var callbacks: AirPlaySessionListener
        val controller = controller(object : AirPlaySessionListener {
            override fun onDebugLog(message: String) {
                if (replace && message.startsWith("AirPlay session active")) {
                    replace = false
                    callbacks.onSessionActive(next)
                }
            }
            override fun onSessionActive(session: AirPlaySession) { forwarded += session }
        })
        callbacks = listener(controller)
        callbacks.onSessionActive(first)
        assertEquals(listOf(next), forwarded)
        assertTrue(controller.isCurrentControlSession(next))
        assertFalse(controller.isCurrentControlSession(first))
    }

    private fun controller(listener: AirPlaySessionListener = object : AirPlaySessionListener {}): CarPlayController =
        CarPlayController(RuntimeEnvironment.getApplication(),
            CarPlayRuntimeConfig(mfiTarget = MfiTarget.LOCAL, headUnitIntegrations = false,
                identification = Iap2IdentificationConfig("test", "test", "test", "test", "1", "1", 3)),
            airPlay, identity, PairingStore(), listener, object : AirPlayMediaHandler {}, {})
            .also { controllers += it }

    private fun phone() = AirPlaySession(Socket(), airPlay, identity, PairingStore(), null,
        object : AirPlaySessionListener {}, object : AirPlayMediaHandler {}).also { phones += it }

    private fun listener(controller: CarPlayController): AirPlaySessionListener =
        ReflectionHelpers.getField(controller, "sessionListener")
}
