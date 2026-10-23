package com.shilapi.xcertplay.airplay

import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class ScreenReturnRecoveryTest {
    @Test fun returnedOwnershipWithoutDataClaimsRetirementBeforeDeferredCleanup() {
        var ended = 0
        val session = session(listener = object : AirPlaySessionListener {
            override fun onSessionEnded(session: AirPlaySession) { ended++ }
        })
        try {
            assertNull(session.prepareCloseAfterScreenLoan())
            returnScreen(session)
            val cleanup = session.prepareCloseAfterScreenLoan()
            assertNotNull(cleanup)
            assertTrue(session.isClosed)
            assertEquals(0, ended)
            assertNull(session.prepareCloseAfterScreenLoan())
            cleanup!!()
            assertEquals(1, ended)
        } finally { session.close() }
    }

    @Test fun aReturnedMainScreenSetupPreventsAnOldMissingStreamRecovery() {
        val session = session()
        try {
            returnScreen(session)
            assertEquals(1, setup(session).size)
            assertNotNull(session.mainScreenSessionToken())
            assertNull(session.prepareCloseAfterScreenLoan())
            assertFalse(session.isClosed)
        } finally { session.close() }
    }

    @Test fun anInFlightMainScreenSetupWinsWithoutHoldingTheLockAcrossMediaCallbacks() {
        val entered = CountDownLatch(1)
        val finish = CountDownLatch(1)
        val session = session(media = object : AirPlayMediaHandler {
            override fun onScreen(session: AirPlaySession, type: Int, stream: Map<String, Any?>): Int? {
                entered.countDown()
                assertTrue(finish.await(2, TimeUnit.SECONDS))
                return 12345
            }
        })
        returnScreen(session)
        val thread = Thread { setup(session) }.apply { start() }
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            assertNull(session.mainScreenSessionToken())
            assertNull(session.prepareCloseAfterScreenLoan())
            assertFalse(session.isClosed)
            finish.countDown()
            thread.join(2_000)
            assertFalse(thread.isAlive)
            assertNotNull(session.mainScreenSessionToken())
            assertNull(session.prepareCloseAfterScreenLoan())
        } finally { finish.countDown(); thread.join(2_000); session.close() }
    }

    @Test fun aLateSetupCannotReviveARecoveryThatAlreadyClaimedTheOldSession() {
        var offered = 0
        val session = session(media = object : AirPlayMediaHandler {
            override fun onScreen(session: AirPlaySession, type: Int, stream: Map<String, Any?>): Int? {
                offered++
                return 12345
            }
        })
        returnScreen(session)
        val cleanup = session.prepareCloseAfterScreenLoan()
        try {
            assertNotNull(cleanup)
            assertTrue(setup(session).isEmpty())
            assertEquals(0, offered)
            assertNull(session.mainScreenSessionToken())
        } finally { cleanup?.invoke(); session.close() }
    }

    private fun returnScreen(session: AirPlaySession) {
        val borrow = AirPlaySession::class.java.getDeclaredField("screenBorrow").apply { isAccessible = true }
            .get(session) as CarPlayScreenBorrow
        borrow.onModesChanged(mapOf("resources" to listOf(mapOf("resourceID" to 1, "entity" to 1))))
        assertTrue(session.screenBorrowState.carPlayHasScreen)
    }

    private fun setup(session: AirPlaySession): List<*> =
        AirPlaySession::class.java.getDeclaredMethod("handleStreams", List::class.java).apply { isAccessible = true }
            .invoke(session, listOf(mapOf("type" to 110))) as List<*>

    private fun session(listener: AirPlaySessionListener = object : AirPlaySessionListener {},
                        media: AirPlayMediaHandler = object : AirPlayMediaHandler {
                            override fun onScreen(session: AirPlaySession, type: Int, stream: Map<String, Any?>) = 12345
                        }): AirPlaySession = AirPlaySession(Socket(),
        AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
        AirPlayIdentity.generate(), PairingStore(), null, listener, media)
}
